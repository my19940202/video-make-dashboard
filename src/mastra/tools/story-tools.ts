import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runsRoot } from '../lib/config';
import { storyMakeWorkflow } from '../workflows/story-make-workflow';

export const startStoryTool = createTool({
  id: 'start-story',
  description: '启动一篇中文故事的可审核视频制作工作流；返回 Mastra run ID 和任务目录。',
  inputSchema: z.object({
    storyText: z.string().min(1),
    title: z.string().min(1).default('手绘故事'),
    style: z.string().default('colored-pencil-diary'),
    transition: z.enum(['cut', 'page-flip']).default('cut'),
  }),
  outputSchema: z.object({runId: z.string(), runDir: z.string()}),
  execute: async input => {
    const run = await storyMakeWorkflow.createRun();
    const runDir = resolve(runsRoot, run.runId);
    await run.startAsync({inputData: {...input, runKey: run.runId}});
    return {runId: run.runId, runDir};
  },
});

const runIdSchema = z.string().regex(/^[A-Za-z0-9-]+$/);

export const pauseStoryTool = createTool({
  id: 'pause-story',
  description: '停止派发后续生图任务；已在执行的任务允许完成并保存。',
  inputSchema: z.object({runId: runIdSchema}),
  outputSchema: z.object({runId: z.string(), paused: z.boolean()}),
  execute: async ({runId}) => {
    const dir = resolve(runsRoot, runId);
    mkdirSync(dir, {recursive: true});
    writeFileSync(resolve(dir, 'pause.flag'), new Date().toISOString());
    return {runId, paused: true};
  },
});

export const unpauseStoryTool = createTool({
  id: 'unpause-story',
  description: '允许继续派发生图任务；若工作流正等待审核，还需在 Studio 审核并恢复该步骤。',
  inputSchema: z.object({runId: runIdSchema}),
  outputSchema: z.object({runId: z.string(), paused: z.boolean()}),
  execute: async ({runId}) => {
    const dir = resolve(runsRoot, runId);
    if (!existsSync(dir)) throw new Error(`找不到任务：${runId}`);
    const flag = resolve(dir, 'pause.flag');
    if (existsSync(flag)) unlinkSync(flag);
    return {runId, paused: false};
  },
});

export const listStoryRunsTool = createTool({
  id: 'list-story-runs',
  description: '列出本机视频任务目录及暂停状态。',
  inputSchema: z.object({}),
  outputSchema: z.object({runs: z.array(z.object({runId: z.string(), runDir: z.string(), paused: z.boolean()}))}),
  execute: async () => {
    mkdirSync(runsRoot, {recursive: true});
    return {runs: readdirSync(runsRoot, {withFileTypes: true}).filter(item => item.isDirectory()).map(item => ({
      runId: item.name, runDir: resolve(runsRoot, item.name), paused: existsSync(resolve(runsRoot, item.name, 'pause.flag')),
    }))};
  },
});
