import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { runsRoot } from '../lib/config';
import { readJson, recordRevision, versionFile, writeJson } from '../lib/files';
import { requirePreviewApproval, requireSceneApprovals } from '../lib/gates';
import { tryCodexImage, validMaster, verifyMaster } from '../lib/image-worker';
import { appendImageFeedback, importAndPreview, prepareJobs, preparePlan, renderFinal, replaceMaster, type ImageJob, type RendererScene } from '../lib/renderer';
import { draftSchema, validateDraft, type Draft } from '../lib/story';
import { storyboardAgent } from '../agents/storyboard-agent';
import { artifactUrl } from '../artifact-route';

const inputSchema = z.object({
  storyText: z.string().trim().min(1),
  title: z.string().trim().min(1).default('手绘故事'),
  style: z.string().default('colored-pencil-diary'),
  transition: z.enum(['cut', 'page-flip']).default('cut'),
  runKey: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
});
const jobSchema = z.object({
  id: z.string(), role: z.enum(['reference', 'scene']), prompt_file: z.string(),
  output_master: z.string(), references: z.array(z.string()),
});
const baseSchema = z.object({ runDir: z.string(), sourceScenes: z.array(z.object({id: z.string(), narration: z.string(), duration_sec: z.number()})), draftPath: z.string() });
const jobContextSchema = z.object({ runDir: z.string(), jobs: z.array(jobSchema) });
const sceneJobSchema = z.object({ runDir: z.string(), job: jobSchema });
const approvedSceneSchema = z.object({ runDir: z.string(), sceneId: z.string(), master: z.string() });
const previewSchema = z.object({ runDir: z.string(), previewPath: z.string() });
const finalSchema = z.object({ runDir: z.string(), previewPath: z.string(), finalPath: z.string() });

const draftDecisionSchema = z.object({
  action: z.enum(['approve', 'regenerate', 'replace', 'pause']),
  feedback: z.string().optional(),
  replacementPath: z.string().optional(),
  replacement: draftSchema.optional(),
});
const imageDecisionSchema = z.object({
  action: z.enum(['ready', 'approve', 'regenerate', 'replace', 'pause']),
  feedback: z.string().optional(), replacementPath: z.string().optional(),
});
const previewDecisionSchema = z.object({ action: z.enum(['approve', 'pause']) });

const directionSchema = z.object({
  characterLock: z.string().min(1),
  directions: z.array(z.object({id: z.string(), direction: z.string().min(1)})),
});

async function makeDraft(scenes: RendererScene[], feedback = ''): Promise<Draft> {
  const prompt = [
    '请为这些中文故事场景写视觉方案。不要改变 ID、原句、顺序或场景数量。',
    'characterLock 具体说明反复出现角色的脸、发型、衣着、年龄和体型；directions 每项只写该场景要画的瞬间。',
    feedback ? `上一版修改意见：${feedback}` : '',
    JSON.stringify(scenes.map(scene => ({id: scene.id, narration: scene.narration}))),
  ].filter(Boolean).join('\n');
  const response = await storyboardAgent.generate(prompt, { structuredOutput: { schema: directionSchema } });
  const generated = directionSchema.parse(response.object);
  const byId = new Map(generated.directions.map(item => [item.id, item.direction]));
  const draft: Draft = {
    characterLock: generated.characterLock,
    scenes: scenes.map(scene => ({
      id: scene.id, narration: scene.narration,
      durationSec: scene.duration_sec,
      direction: byId.get(scene.id) || '',
    })),
  };
  return validateDraft(draft, scenes);
}

const draftStep = createStep({
  id: 'draft-storyboard', inputSchema, outputSchema: baseSchema,
  execute: async ({ inputData, runId }) => {
    const runDir = resolve(runsRoot, inputData.runKey || runId || randomUUID());
    mkdirSync(runDir, { recursive: true });
    const sourceScenes = await preparePlan(runDir, inputData.storyText, inputData.title, inputData.style, inputData.transition);
    const draftPath = resolve(runDir, 'draft.json');
    writeJson(draftPath, await makeDraft(sourceScenes));
    return { runDir, sourceScenes, draftPath };
  },
});

const reviewDraftStep = createStep({
  id: 'review-storyboard', inputSchema: baseSchema, outputSchema: baseSchema,
  resumeSchema: draftDecisionSchema,
  suspendSchema: z.object({stage: z.string(), draftPath: z.string(), draft: draftSchema}),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { draftPath, sourceScenes } = inputData;
    if (resumeData?.action === 'regenerate') {
      if (!resumeData.feedback?.trim()) throw new Error('重新生成分镜需要修改意见');
      versionFile(draftPath);
      writeJson(draftPath, await makeDraft(sourceScenes, resumeData.feedback));
      recordRevision(inputData.runDir, 'storyboard', 'regenerate', resumeData.feedback);
    } else if (resumeData?.action === 'replace') {
      const replacement = resumeData.replacement ?? (resumeData.replacementPath ? readJson<unknown>(resumeData.replacementPath) : null);
      versionFile(draftPath);
      writeJson(draftPath, validateDraft(replacement, sourceScenes));
      recordRevision(inputData.runDir, 'storyboard', 'replace', resumeData.feedback);
    } else if (resumeData?.action === 'approve') {
      validateDraft(readJson(draftPath), sourceScenes);
      writeJson(resolve(inputData.runDir, 'draft-approved.json'), { approvedAt: new Date().toISOString(), draftPath });
      return inputData;
    }
    const draft = validateDraft(readJson(draftPath), sourceScenes);
    return await suspend({ stage: '分镜审核：approve / regenerate / replace / pause', draftPath, draft });
  },
});

const prepareJobsStep = createStep({
  id: 'prepare-codex-jobs', inputSchema: baseSchema, outputSchema: jobContextSchema,
  execute: async ({ inputData }) => {
    const draft = validateDraft(readJson(inputData.draftPath), inputData.sourceScenes);
    const manifest = await prepareJobs(inputData.runDir, draft);
    return { runDir: inputData.runDir, jobs: manifest.jobs };
  },
});

async function reviewImage(
  runDir: string, job: ImageJob, decision: z.infer<typeof imageDecisionSchema> | undefined,
  suspend: (payload: {stage: string; jobId: string; promptFile: string; outputMaster: string; references: string[]; artifactUrl: string; bridgeError?: string}) => unknown,
): Promise<unknown | null> {
  const asset = job.role === 'reference' ? 'character' : `scene-${job.id}`;
  const url = artifactUrl(runDir, asset);
  if (decision?.action === 'approve') {
    await verifyMaster(job);
    writeJson(resolve(runDir, 'approvals', `${job.id}.json`), { approvedAt: new Date().toISOString(), master: job.output_master });
    return null;
  }
  if (decision?.action === 'pause') {
    writeFileSync(resolve(runDir, 'pause.flag'), new Date().toISOString());
  }
  if (decision?.action === 'replace') {
    if (!decision.replacementPath) throw new Error('替换图片需要 replacementPath');
    versionFile(job.output_master);
    replaceMaster(decision.replacementPath, job.output_master);
    recordRevision(runDir, job.id, 'replace', decision.feedback);
  }
  if (decision?.action === 'regenerate') {
    if (!decision.feedback?.trim()) throw new Error('重画需要修改意见');
    versionFile(job.output_master);
    if (existsSync(job.output_master)) unlinkSync(job.output_master);
    appendImageFeedback(job, decision.feedback);
    recordRevision(runDir, job.id, 'regenerate', decision.feedback);
  }
  if (validMaster(job.output_master)) {
    return await suspend({stage: '图片审核：approve / regenerate / replace / pause', jobId: job.id, promptFile: job.prompt_file, outputMaster: job.output_master, references: job.references, artifactUrl: url});
  }
  const bridgeError = await tryCodexImage(runDir, job);
  return await suspend({
    stage: validMaster(job.output_master) ? '图片审核：approve / regenerate / replace / pause' : '等待本机 Codex 生图；完成后选择 ready',
    jobId: job.id, promptFile: job.prompt_file, outputMaster: job.output_master,
    references: job.references, artifactUrl: url, ...(bridgeError ? {bridgeError} : {}),
  });
}

const characterStep = createStep({
  id: 'review-character', inputSchema: jobContextSchema, outputSchema: z.array(sceneJobSchema),
  resumeSchema: imageDecisionSchema,
  suspendSchema: z.object({stage: z.string(), jobId: z.string(), promptFile: z.string(), outputMaster: z.string(), references: z.array(z.string()), artifactUrl: z.string(), bridgeError: z.string().optional()}),
  execute: async ({ inputData, resumeData, suspend }) => {
    const job = inputData.jobs.find(item => item.role === 'reference');
    if (!job) throw new Error('清单缺少角色参考图');
    const suspension = await reviewImage(inputData.runDir, job, resumeData, suspend);
    if (suspension) return suspension as never;
    return inputData.jobs.filter(item => item.role === 'scene').map(job => ({runDir: inputData.runDir, job}));
  },
});

const sceneStep = createStep({
  id: 'review-scene', inputSchema: sceneJobSchema, outputSchema: approvedSceneSchema,
  resumeSchema: imageDecisionSchema,
  suspendSchema: z.object({stage: z.string(), jobId: z.string(), promptFile: z.string(), outputMaster: z.string(), references: z.array(z.string()), artifactUrl: z.string(), bridgeError: z.string().optional()}),
  execute: async ({ inputData, resumeData, suspend }) => {
    const suspension = await reviewImage(inputData.runDir, inputData.job, resumeData, suspend);
    if (suspension) return suspension as never;
    return { runDir: inputData.runDir, sceneId: inputData.job.id, master: inputData.job.output_master };
  },
});

const previewStep = createStep({
  id: 'import-and-preview', inputSchema: z.array(approvedSceneSchema), outputSchema: previewSchema,
  execute: async ({ inputData }) => {
    const runDir = requireSceneApprovals(inputData);
    return {runDir, previewPath: await importAndPreview(runDir)};
  },
});

const reviewPreviewStep = createStep({
  id: 'review-preview', inputSchema: previewSchema, outputSchema: previewSchema,
  resumeSchema: previewDecisionSchema,
  suspendSchema: z.object({stage: z.string(), previewPath: z.string(), artifactUrl: z.string()}),
  execute: async ({inputData, resumeData, suspend}) => {
    if (resumeData?.action === 'approve') {
      if (!existsSync(inputData.previewPath)) throw new Error('预览视频不存在');
      writeJson(resolve(inputData.runDir, 'preview-approved.json'), {approvedAt: new Date().toISOString()});
      return inputData;
    }
    return await suspend({stage: '预览审核：approve / pause', previewPath: inputData.previewPath, artifactUrl: artifactUrl(inputData.runDir, 'preview')});
  },
});

const finalStep = createStep({
  id: 'render-final', inputSchema: previewSchema, outputSchema: finalSchema,
  execute: async ({inputData}) => {
    requirePreviewApproval(inputData.runDir);
    return {...inputData, finalPath: await renderFinal(inputData.runDir)};
  },
});

export const storyMakeWorkflow = createWorkflow({
  id: 'story-make-workflow',
  description: 'DeepSeek 分镜、Codex 生图、逐关审核、预览和正式渲染',
  inputSchema, outputSchema: finalSchema,
})
  .then(draftStep)
  .then(reviewDraftStep)
  .then(prepareJobsStep)
  .then(characterStep)
  .foreach(sceneStep, { concurrency: 2 })
  .then(previewStep)
  .then(reviewPreviewStep)
  .then(finalStep)
  .commit();
