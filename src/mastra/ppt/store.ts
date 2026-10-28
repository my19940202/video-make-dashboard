import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appRoot } from '../lib/config';
import { styleIdSchema, type StyleId } from './styles';
import { narrativeModeSchema, type NarrativeMode } from './narratives';

export const root = resolve(appRoot, 'data/ppt');
export const pageSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(32),
  body: z.string().trim().min(1).max(180), prompt: z.string().trim().min(1).max(2500),
  duration: z.number().min(4).max(30),
  entrance: z.enum(['fade','blur','float']).default('fade'),
});
export const editSchema = z.object({
  revision: z.number().int(), title: z.string().trim().min(1).max(60),
  styleId: styleIdSchema,
  narrativeMode: narrativeModeSchema,
  pages: z.array(pageSchema).min(1).max(12),
  musicId: z.string().uuid().nullable(), volume: z.number().min(0).max(1),
});
export type Page = z.infer<typeof pageSchema> & {
  imageVersion: number; image?: string;
  status: 'idle'|'running'|'done'|'failed'; error?: string;
  generationMs?: number;
};
export type Project = {
  id: string; title: string; source: string; styleId: StyleId; narrativeMode: NarrativeMode; pages: Page[]; revision: number;
  state: 'drafting'|'script'|'sample-generating'|'sample'|'producing'|'rendering'|'done'|'failed';
  phase: 'draft'|'sample'|'produce'; scriptApproved: boolean; sampleApproved: boolean;
  musicId: string|null; volume: number; error?: string; final?: string; silent?: string;
  createdAt: number; updatedAt: number; phaseStartedAt?: number; renderMs?: number;
};
export function projectDir(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error('任务 ID 无效');
  return resolve(root, id);
}
export function save(project: Project): Project {
  const dir = projectDir(project.id); mkdirSync(dir, { recursive: true });
  project.updatedAt = Date.now();
  const file = resolve(dir, 'project.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(project, null, 2)); renameSync(`${file}.tmp`, file);
  return project;
}
export function read(id: string): Project {
  const project=JSON.parse(readFileSync(resolve(projectDir(id), 'project.json'), 'utf8')) as Project;
  project.styleId ||= 'legacy-blue';
  project.narrativeMode ||= 'legal-case';
  for(const page of project.pages) {
    const legacy=page as Page & {jobId?:string;queueMs?:number};
    delete legacy.jobId; delete legacy.queueMs;
    if((page.status as string)==='pending') page.status=page.image?'done':'idle';
  }
  return project;
}
export function list(): Project[] {
  mkdirSync(root, { recursive: true });
  return readdirSync(root).filter(id => z.string().uuid().safeParse(id).success)
    .flatMap(id => { try { return [read(id)]; } catch { return []; } }).sort((a,b) => b.updatedAt-a.updatedAt);
}
export function create(title: string, source: string, styleId: StyleId = 'colored-pencil-diary', narrativeMode: NarrativeMode = 'legal-case'): Project {
  return save({id: randomUUID(), title, source, styleId, narrativeMode, pages: [], revision: 1, state: 'drafting', phase:'draft',
    scriptApproved:false, sampleApproved:false, musicId:null, volume:0.18, createdAt:Date.now(), updatedAt:Date.now()});
}
export function update(id: string, input: unknown): Project {
  const value = editSchema.parse(input); const project = read(id);
  if (project.revision !== value.revision) throw new Error('内容已有更新，请刷新后重试');
  if (project.narrativeMode !== value.narrativeMode) throw new Error('口吻在创建后不可更改，请新建项目');
  if (!['script','sample','done','failed'].includes(project.state)) throw new Error('制作中暂不可编辑，请等待当前步骤完成');
  if (new Set(value.pages.map(p=>p.id)).size !== value.pages.length) throw new Error('页面 ID 重复');
  const styleChanged=project.styleId!==value.styleId;
  const previous = new Map(project.pages.map(p=>[p.id,p]));
  const first = project.pages[0];
  project.pages = value.pages.map(p => {
    const old = previous.get(p.id);
    return old && old.prompt === p.prompt && !styleChanged ? {...old, ...p} : {...p, imageVersion:(old?.imageVersion || 0)+1, image:undefined, error:undefined, generationMs:undefined, status:'idle'};
  });
  const changedSample = styleChanged || (first && (first.id !== project.pages[0]?.id || first.prompt !== project.pages[0]?.prompt));
  if (changedSample) {
    project.sampleApproved = false;
    if(!styleChanged) for (const page of project.pages.slice(1)) { page.imageVersion++; delete page.image; page.status='idle'; }
  }
  Object.assign(project, {title:value.title, styleId:value.styleId, musicId:value.musicId, volume:value.volume});
  project.revision++; delete project.final; delete project.error;
  if (project.scriptApproved) project.state = project.sampleApproved ? 'done' : (project.pages[0]?.image ? 'sample' : 'script');
  else project.state='script';
  return save(project);
}
export function musicDir() { const dir=resolve(root,'music'); mkdirSync(dir,{recursive:true}); return dir; }
export function musicList(): Array<{id:string;name:string;file:string}> {
  return readdirSync(musicDir()).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(resolve(musicDir(),n),'utf8')));
}
export function musicFile(id: string|null): string|undefined {
  if (!id) return undefined;
  const entry = musicList().find(m=>m.id===id);
  if (!entry || !existsSync(resolve(musicDir(),entry.file))) throw new Error('背景音乐不存在，请重新选择');
  return resolve(musicDir(), entry.file);
}
