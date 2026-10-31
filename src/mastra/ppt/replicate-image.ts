import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommand } from '../lib/process';

type Prediction = { id?: string; status?: string; output?: unknown; error?: unknown };
const endpoint = 'https://api.replicate.com/v1';

async function request(url: string, token: string, init: RequestInit = {}): Promise<Prediction> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(70_000) });
  } catch (error) {
    throw new Error(`无法连接 Replicate：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(`Replicate 请求失败 (${response.status})：${message}`);
  }
  return await response.json() as Prediction;
}

async function inputImage(bytes: Buffer): Promise<string> {
  const dir = mkdtempSync(resolve(tmpdir(), 'story-replicate-ref-'));
  try {
    const source = resolve(dir, 'source.png'), target = resolve(dir, 'reference.jpg');
    writeFileSync(source, bytes);
    await runCommand('ffmpeg', ['-y', '-v', 'error', '-i', source, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease', '-q:v', '5', '-frames:v', '1', target], dir, 60_000);
    const image = readFileSync(target);
    if (image.length > 1_000_000) throw new Error('Replicate 参考图压缩后仍超过 1 MB');
    return `data:image/jpeg;base64,${image.toString('base64')}`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function outputUrl(output: unknown): URL {
  const value = Array.isArray(output) ? output[0] : output;
  if (typeof value !== 'string') throw new Error('Replicate 未返回图片地址');
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.hostname !== 'replicate.delivery' && !url.hostname.endsWith('.replicate.delivery')))
    throw new Error('Replicate 返回的图片地址无效');
  return url;
}

export async function generateReplicateImage(options: {
  prompt: string; width: number; height: number; references?: Buffer[];
  existingPredictionId?: string; onPrediction: (id: string) => void;
}): Promise<{ bytes: Buffer; durationMs: number }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN 未配置');
  const started = Date.now();
  let prediction: Prediction;
  if (options.existingPredictionId) {
    if (!/^[a-z0-9]{10,64}$/.test(options.existingPredictionId)) throw new Error('Replicate 任务 ID 无效');
    prediction = await request(`${endpoint}/predictions/${options.existingPredictionId}`, token);
  } else {
    const references = await Promise.all((options.references || []).slice(0, 3).map(inputImage));
    prediction = await request(`${endpoint}/models/openai/gpt-image-2/predictions`, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: { prompt: options.prompt, quality: 'low', background: 'auto', moderation: 'auto',
        aspect_ratio: options.width === options.height ? '1:1' : '3:4',
        ...(references.length ? { input_images: references } : {}), output_format: 'png', number_of_images: 1 } }),
    });
    if (!prediction.id || !/^[a-z0-9]{10,64}$/.test(prediction.id)) throw new Error('Replicate 未返回有效任务 ID');
    options.onPrediction(prediction.id);
  }
  const deadline = Date.now() + 10 * 60_000;
  while (prediction.status !== 'succeeded') {
    if (prediction.status === 'failed' || prediction.status === 'canceled')
      throw new Error(`Replicate 生图${prediction.status === 'failed' ? '失败' : '已取消'}：${String(prediction.error || '未知原因').slice(0, 300)}`);
    if (!prediction.id || Date.now() >= deadline) throw new Error('等待 Replicate 生图超过 10 分钟');
    await new Promise(done => setTimeout(done, 2000));
    prediction = await request(`${endpoint}/predictions/${prediction.id}`, token);
  }
  const url = outputUrl(prediction.output);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`无法下载 Replicate 图片 (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Replicate 未返回有效 PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (options.width === options.height ? width !== height : Math.abs(width * options.height - height * options.width) > Math.max(width, height))
    throw new Error(`Replicate 图片比例不符：收到 ${width}×${height}`);
  return { bytes, durationMs: Date.now() - started };
}
