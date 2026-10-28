import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ImageJob } from './renderer';
import { runCommand } from './process';

export function validMaster(path: string): boolean {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 10_000;
}

export async function verifyMaster(job: ImageJob): Promise<void> {
  if (!validMaster(job.output_master)) throw new Error(`母图不存在或太小：${job.output_master}`);
  const output = await runCommand('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', job.output_master,
  ], resolve(job.output_master, '..'), 30_000);
  const [width, height] = output.trim().split(',').map(Number);
  if (!width || !height || width < 512 || height < 512) throw new Error(`图片尺寸不合要求：${job.output_master} ${output.trim()}`);
}

export function paused(runDir: string): boolean {
  return existsSync(resolve(runDir, 'pause.flag'));
}

export async function tryCodexImage(runDir: string, job: ImageJob): Promise<string | null> {
  if (validMaster(job.output_master)) return null;
  if (paused(runDir)) return '已暂停派发新生图任务';
  if (process.env.CODEX_AUTO_IMAGEGEN === '0') return '自动桥接已关闭';
  const instruction = [
    'Use the built-in image_gen tool to create exactly one image for this story-video job.',
    `Read prompt file: ${job.prompt_file}`,
    `Reference images in order: ${JSON.stringify(job.references)}`,
    `Copy the selected image to: ${job.output_master}`,
    'Do not use an OpenAI API key or the image_gen.py CLI. Do not edit other files.',
    'If the built-in image tool is unavailable, say so and stop.',
  ].join('\n');
  try {
    await runCommand(process.env.CODEX_BIN || 'codex', [
      'exec', '--ephemeral', '--skip-git-repo-check', '-C', runDir,
      '-s', 'workspace-write', '-'
    ], runDir, 900_000, instruction);
    return validMaster(job.output_master) ? null : 'Codex 未写出目标母图';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
