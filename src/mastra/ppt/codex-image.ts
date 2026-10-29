import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommand } from '../lib/process';

const base = () => (process.env.CODEX_IMAGE_URL || 'http://127.0.0.1:3099').replace(/\/$/, '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ImageReference = { bytes: Buffer; jobId?: string };

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(30_000) }); }
  catch (error) { throw new Error(`无法连接 Codex 生图服务：${error instanceof Error ? error.message : String(error)}`); }
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try { message = JSON.parse(body).error || body; } catch { /* plain response */ }
    throw new Error(`Codex 生图服务 ${response.status}：${message.slice(0, 300)}`);
  }
  return response;
}

export async function importReference(reference: ImageReference): Promise<string> {
  if (reference.jobId) return reference.jobId;
  const response = await request('/api/references', { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(reference.bytes) });
  const job = await response.json() as { id?: string };
  if (!job.id || !uuid.test(job.id)) throw new Error('Codex 参考图导入未返回有效 ID');
  return job.id;
}

async function normalize(bytes: Buffer, width: number, height: number): Promise<Buffer> {
  const dir = mkdtempSync(resolve(tmpdir(), 'story-ppt-codex-'));
  try {
    const input = resolve(dir, 'input.png'), output = resolve(dir, 'output.png');
    writeFileSync(input, bytes);
    await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-frames:v', '1', output], dir, 60_000);
    return readFileSync(output);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function generateCodexImage(options: {
  prompt: string; width: number; height: number; references?: ImageReference[];
  key: string; existingJobId?: string; onJob: (jobId: string) => void;
}): Promise<{ bytes: Buffer; durationMs: number; jobId: string }> {
  const started = Date.now();
  const referenceIds: string[] = [];
  for (const reference of options.references || []) referenceIds.push(await importReference(reference));
  let jobId = options.existingJobId;
  if (!jobId) {
    const response = await request('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: options.prompt, aspect_ratio: options.width === options.height ? '1:1' : '3:4',
        reference_ids: referenceIds, idempotency_key: options.key }) });
    const job = await response.json() as { id?: string; job?: { id?: string }; data?: { id?: string }; task_id?: string; jobId?: string };
    const returnedId=job.id||job.job?.id||job.data?.id||job.task_id||job.jobId;
    if (typeof returnedId==='string' && returnedId.length>0 && returnedId.length<128) jobId=returnedId;
    else {
      const history=await (await request('/api/jobs')).json() as {jobs?:Array<{id:string;idempotency_key?:string}>};
      jobId=history.jobs?.find(item=>item.idempotency_key===options.key)?.id;
      if(!jobId) throw new Error(`Codex 生图服务未返回任务 ID（响应字段：${Object.keys(job).join(', ')||'空'}；幂等键：${options.key}）`);
    }
    options.onJob(jobId);
  }
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const job = await (await request(`/api/jobs/${encodeURIComponent(jobId)}`)).json() as { status: string; error?: string; image_url?: string; duration_ms?: number };
    if (job.status === 'failed') throw new Error(`Codex 生图失败：${job.error || '未知错误'}`);
    if (job.status === 'done') {
      if (job.image_url !== `/api/jobs/${jobId}/image`) throw new Error('Codex 生图服务返回了无效图片地址');
      const raw = Buffer.from(await (await request(job.image_url)).arrayBuffer());
      if (raw.length < 33 || raw.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Codex 未返回有效 PNG');
      return { bytes: await normalize(raw, options.width, options.height), durationMs: Date.now() - started, jobId };
    }
    await new Promise(done => setTimeout(done, 2000));
  }
  throw new Error('等待 Codex 生图超过 30 分钟，请检查 3099 服务状态');
}
