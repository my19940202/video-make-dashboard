import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appRoot } from '../lib/config';
import { styleIdSchema, type StyleId } from './styles';
import { narrativeModeSchema, type NarrativeMode } from './narratives';

export const root = resolve(appRoot, 'data/ppt');
export const layoutTemplateSchema = z.enum(['text-illustration', 'title-full-image']);
export type LayoutTemplate = z.infer<typeof layoutTemplateSchema>;
export const pageSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(32),
  body: z.string().trim().min(1).max(105), prompt: z.string().trim().min(1).max(2500),
  duration: z.number().min(1).max(30),
  entrance: z.enum(['fade','blur','float']).default('fade'),
  characterIds: z.array(z.string().uuid()).max(3).optional(),
  locationId: z.string().uuid().nullable().optional(),
});
export const referenceEditSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['character', 'location']),
  name: z.string().trim().min(1).max(40), description: z.string().trim().min(5).max(500),
});
export const editSchema = z.object({
  revision: z.number().int(), title: z.string().trim().min(1).max(60),
  styleId: styleIdSchema,
  narrativeMode: narrativeModeSchema,
  layoutTemplate: layoutTemplateSchema.default('text-illustration'),
  hideHeaderFooter: z.boolean().default(false),
  pages: z.array(pageSchema).min(1).max(12),
  references: z.array(referenceEditSchema).max(5).optional(),
  musicId: z.string().uuid().nullable(), volume: z.number().min(0).max(1),
});
export type Page = z.infer<typeof pageSchema> & {
  imageVersion: number; image?: string;
  status: 'idle'|'running'|'done'|'failed'; error?: string;
  generationMs?: number;
  provider?: 'draw-things'|'codex'; codexJobId?: string;
};
export type ReferenceAsset = z.infer<typeof referenceEditSchema> & {
  imageVersion: number; image?: string; status: 'idle'|'running'|'done'|'failed';
  error?: string; generationMs?: number; provider?: 'draw-things'|'codex'; codexJobId?: string;
};
export type Project = {
  id: string; title: string; source: string; styleId: StyleId; narrativeMode: NarrativeMode; layoutTemplate: LayoutTemplate; hideHeaderFooter: boolean; pages: Page[]; revision: number;
  state: 'drafting'|'script'|'references-generating'|'references'|'sample-generating'|'sample'|'producing'|'rendering'|'done'|'failed';
  phase: 'draft'|'references'|'sample'|'produce'; scriptApproved: boolean; sampleApproved: boolean;
  referenceWorkflowVersion?: 1; referenceWorkflowEnabled?: boolean; references?: ReferenceAsset[]; referencesApproved?: boolean;
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
  project.layoutTemplate ||= 'text-illustration';
  project.hideHeaderFooter ??= false;
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
export function create(title: string, source: string, styleId: StyleId = 'colored-pencil-diary', narrativeMode: NarrativeMode = 'legal-case', layoutTemplate: LayoutTemplate = 'text-illustration'): Project {
  return save({id: randomUUID(), title, source, styleId, narrativeMode, layoutTemplate, hideHeaderFooter:false, pages: [], revision: 1, state: 'drafting', phase:'draft',
    scriptApproved:false, sampleApproved:false, referenceWorkflowVersion:1, references:[], referencesApproved:false,
    musicId:null, volume:0.18, createdAt:Date.now(), updatedAt:Date.now()});
}
function invalidate(page: Page) {
  page.imageVersion++; delete page.image; delete page.error; delete page.generationMs;
  delete page.codexJobId; delete page.provider; page.status='idle';
}
export function update(id: string, input: unknown): Project {
  const value = editSchema.parse(input); const project = read(id);
  if (project.revision !== value.revision) throw new Error('内容已有更新，请刷新后重试');
  if (project.narrativeMode !== value.narrativeMode) throw new Error('口吻在创建后不可更改，请新建项目');
  if (project.layoutTemplate !== value.layoutTemplate) throw new Error('画面模板在创建后不可更改，请新建项目');
  if (!['script','references','sample','done','failed'].includes(project.state)) throw new Error('制作中暂不可编辑，请等待当前步骤完成');
  if (new Set(value.pages.map(p=>p.id)).size !== value.pages.length) throw new Error('页面 ID 重复');
  if (project.referenceWorkflowVersion && value.references) {
    const characters=value.references.filter(r=>r.kind==='character'), locations=value.references.filter(r=>r.kind==='location');
    if(characters.length>3 || locations.length>2 || new Set(value.references.map(r=>r.id)).size!==value.references.length) throw new Error('参考图最多3位角色和2个地点，且 ID 不可重复');
    const ids=new Map(value.references.map(r=>[r.id,r.kind]));
    for(const page of value.pages) {
      if((page.characterIds||[]).some(id=>ids.get(id)!=='character') || (page.locationId && ids.get(page.locationId)!=='location')) throw new Error('页面关联了不存在的角色或地点');
    }
    const old=new Map((project.references||[]).map(r=>[r.id,r]));
    const changed=new Set<string>();
    project.references=value.references.map(r=>{
      const previous=old.get(r.id);
      if(!previous || previous.kind!==r.kind || previous.name!==r.name || previous.description!==r.description || project.styleId!==value.styleId) {
        changed.add(r.id);
        return {...r,imageVersion:(previous?.imageVersion||0)+1,status:'idle' as const};
      }
      return {...previous,...r};
    });
    for(const id of old.keys()) if(!ids.has(id)) changed.add(id);
    if(changed.size) {
      if(project.referenceWorkflowVersion && project.scriptApproved && project.references?.length) project.referenceWorkflowEnabled=true;
      if(project.referenceWorkflowEnabled) project.referencesApproved=false;
      for(const page of project.pages) if((page.characterIds||[]).some(id=>changed.has(id)) || (page.locationId && changed.has(page.locationId))) invalidate(page);
    }
  }
  const styleChanged=project.styleId!==value.styleId;
  const previous = new Map(project.pages.map(p=>[p.id,p]));
  const first = project.pages[0];
  project.pages = value.pages.map(p => {
    const old = previous.get(p.id);
    const linksChanged=JSON.stringify(old?.characterIds||[])!==JSON.stringify(p.characterIds||[]) || (old?.locationId||null)!==(p.locationId||null);
    return old && old.prompt === p.prompt && !styleChanged && !linksChanged ? {...old, ...p} : {...p, imageVersion:(old?.imageVersion || 0)+1, status:'idle'};
  });
  for(const page of project.pages) if(page.status==='idle') { delete page.image; delete page.codexJobId; delete page.provider; }
  const changedSample = styleChanged || (first && (first.id !== project.pages[0]?.id || first.prompt !== project.pages[0]?.prompt));
  if (changedSample) {
    project.sampleApproved = false;
    if(!styleChanged) for (const page of project.pages.slice(1)) invalidate(page);
  }
  if(project.referenceWorkflowEnabled && project.references?.some(r=>r.status==='idle')) project.referencesApproved=false;
  if(project.pages[0] && !project.pages[0].image) project.sampleApproved=false;
  Object.assign(project, {title:value.title, styleId:value.styleId, hideHeaderFooter:value.hideHeaderFooter, musicId:value.musicId, volume:value.volume});
  project.revision++; delete project.final; delete project.error;
  if (project.scriptApproved) project.state = project.referenceWorkflowEnabled && project.references?.length && !project.referencesApproved ? 'references' : project.sampleApproved ? 'done' : (project.pages[0]?.image ? 'sample' : 'script');
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
