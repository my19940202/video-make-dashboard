import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireRenderer } from './config';
import { runCommand } from './process';
import { readJson, writeJson } from './files';
import type { Draft } from './story';
import { visualPlan } from './story';

export type RendererScene = { id: string; narration: string; duration_sec: number };
export type ImageJob = {
  id: string;
  role: 'reference' | 'scene';
  prompt_file: string;
  output_master: string;
  references: string[];
};
export type Manifest = { jobs: ImageJob[] };

export async function preparePlan(runDir: string, story: string, title: string, style: string, transition: string): Promise<RendererScene[]> {
  mkdirSync(runDir, { recursive: true });
  const storyPath = resolve(runDir, 'story.txt');
  writeFileSync(storyPath, story);
  writeJson(resolve(runDir, 'request.json'), { title, style, transition });
  await renderer(runDir, ['--input', storyPath, '--title', title, '--style', style, '--transition', transition, '--mode', 'plan']);
  const board = readJson<{scenes: RendererScene[]}>(resolve(runDir, 'storyboard.generated.json'));
  return board.scenes;
}

export async function prepareJobs(runDir: string, draft: Draft): Promise<Manifest> {
  const request = readJson<{title: string; style: string; transition: string}>(resolve(runDir, 'request.json'));
  const planPath = resolve(runDir, 'visual-plan.json');
  writeJson(planPath, visualPlan(draft));
  await renderer(runDir, [
    '--input', resolve(runDir, 'story.txt'), '--title', request.title,
    '--style', request.style, '--transition', request.transition,
    '--character-lock', draft.characterLock, '--visual-plan', planPath,
    '--mode', 'generate',
  ]);
  const boardPath = resolve(runDir, 'storyboard.generated.json');
  const board = readJson<{scenes: Array<{id: string; duration_sec: number}>} & Record<string, unknown>>(boardPath);
  const durations = new Map(draft.scenes.map(scene => [scene.id, scene.durationSec]));
  board.scenes = board.scenes.map(scene => ({...scene, duration_sec: durations.get(scene.id) ?? scene.duration_sec}));
  writeJson(boardPath, board);
  return readJson<Manifest>(resolve(runDir, 'codex-image-jobs.json'));
}

export async function renderer(runDir: string, flags: string[]): Promise<string> {
  const project = requireRenderer();
  return runCommand(process.env.PYTHON || 'python3', [
    resolve(project, 'scripts/run_story_video.py'), '--project-dir', project,
    '--story-dir', runDir, ...flags,
  ], project, 1_800_000);
}

export async function importAndPreview(runDir: string): Promise<string> {
  await renderer(runDir, ['--mode', 'import']);
  await renderer(runDir, ['--mode', 'preview']);
  const path = resolve(runDir, 'out/picture_silent-preview.mp4');
  if (!existsSync(path)) throw new Error('预览渲染没有生成 MP4');
  return path;
}

export async function renderFinal(runDir: string): Promise<string> {
  await renderer(runDir, ['--mode', 'render']);
  const path = resolve(runDir, 'out/picture_silent.mp4');
  if (!existsSync(path)) throw new Error('正式渲染没有生成 MP4');
  return path;
}

export function replaceMaster(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`找不到替换图片：${from}`);
  mkdirSync(resolve(to, '..'), { recursive: true });
  if (resolve(from) !== resolve(to)) copyFileSync(from, to);
}

export function appendImageFeedback(job: ImageJob, feedback: string): void {
  const current = readFileSync(job.prompt_file, 'utf8');
  writeFileSync(job.prompt_file, `${current.trim()}\n\nRevision request: ${feedback.trim()}\n`);
}
