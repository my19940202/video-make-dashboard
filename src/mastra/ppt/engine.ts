import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { appRoot, rendererRoot } from '../lib/config';
import { runCommand } from '../lib/process';
import { pageSchema, projectDir, read, save, musicFile, type Project, type Page, type ReferenceAsset } from './store';
import { generateImage } from './draw-things';
import { generateCodexImage, type ImageReference } from './codex-image';
import { generateCloudflareImage } from './cloudflare-image';
import { putObject, putFile } from './r2';
import { reserveImage } from './auth';
import { imageSettings } from './settings';
import { imagePrompt } from './styles';
import { planningPrompt } from './narratives';

const generatedPage = pageSchema.omit({id:true,characterIds:true,locationId:true}).extend({
  characterKeys:z.array(z.string()).default([]), locationKey:z.string().nullable().default(null),
});
const generatedSchema = z.object({
  pages:z.array(generatedPage).min(6).max(8),
  characters:z.array(z.object({key:z.string(),name:z.string(),description:z.string()})).max(3).default([]),
  locations:z.array(z.object({key:z.string(),name:z.string(),description:z.string()})).max(2).default([]),
});
const legalGeneratedSchema=generatedSchema.extend({pages:z.array(generatedPage.extend({
  title:z.string().trim().min(1).max(12).refine(v=>!v.includes('\n')),
  body:z.string().trim().min(1).max(42).refine(v=>!v.includes('\n')&&(v.match(/[。！？!?]/g)||[]).length<=2),
})).min(6).max(8)});
const agent = new Agent({id:'ppt-planner', name:'视频分页', model:'deepseek/deepseek-flash',
  instructions:'根据调用方指定的口吻整理用户材料，遵守事实边界和输出结构。不要把一种口吻的结构套用到另一种口吻。'});
function current(id: string, revision: number) { const p=read(id); if(p.revision!==revision) throw new Error('版本已变更，停止旧任务'); return p; }
function mutatePage(id:string, revision:number, pageId:string, fields:Partial<Page>) {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId); if(!page) throw new Error('页面已移除'); Object.assign(page,fields); save(p);
}
function mutateReference(id:string, revision:number, referenceId:string, fields:Partial<ReferenceAsset>) {
  const p=current(id,revision); const ref=p.references?.find(x=>x.id===referenceId); if(!ref) throw new Error('参考图已移除');
  Object.assign(ref,fields); save(p);
}
function imageSize(p:Project) {
  return ['title-full-image','legal-carousel-v2'].includes(p.layoutTemplate) ? {width:576,height:768} :
    {width:p.styleId==='legacy-blue'?768:960,height:p.styleId==='legacy-blue'?768:960};
}
function styleReference(p:Project): ImageReference[] {
  if(p.styleId==='legacy-blue') return [];
  const file=resolve(appRoot,'assets/style-references',...(['title-full-image','legal-carousel-v2'].includes(p.layoutTemplate)?['portrait']:[]),`${p.styleId}.png`);
  return [{bytes:readFileSync(file)}];
}
function pageReferences(p:Project,page:Page):ImageReference[] {
  const refs=p.referencesApproved ? p.references||[] : [];
  const selected=[...(page.characterIds||[]),...(page.locationId?[page.locationId]:[])];
  const result:ImageReference[]=selected.flatMap(id=>{
    const ref=refs.find(item=>item.id===id);
    return ref?.image ? [{bytes:readFileSync(resolve(projectDir(p.id),ref.image)),jobId:ref.provider==='codex'?ref.codexJobId:undefined}] : [];
  });
  return [...result,...styleReference(p)].slice(0,3);
}
function referencePrompt(p:Project,ref:ReferenceAsset):string {
  const content=ref.kind==='character'
    ? `同一位角色的三视图设定图：${ref.name}，${ref.description}。白底，左中右分别是正面、侧面、背面全身像，年龄、脸型、发型、服饰保持一致。`
    : `不含人物的地点设定图：${ref.name}，${ref.description}。画出可在不同页面重复使用的环境特征，不添加故事中未出现的物品。`;
  return imagePrompt(p.styleId,content,p.narrativeMode);
}
async function imageReference(id:string,revision:number,referenceId:string):Promise<void> {
  const p=current(id,revision); const ref=p.references?.find(x=>x.id===referenceId);
  if(!ref) throw new Error('参考图不存在');
  if(ref.image && existsSync(resolve(projectDir(id),ref.image))) return;
  if(imageSettings().provider==='draw-things' && !ref.codexJobId) throw new Error('本机 Draw Things 不支持参考拼板');
  try {
    if(process.env.SAAS_MODE==='1')reserveImage(id);
    mutateReference(id,revision,referenceId,{status:'running',provider:'codex'});
    const result=imageSettings().provider==='cloudflare'
      ? await generateCloudflareImage({prompt:referencePrompt(p,ref),width:960,height:960,references:styleReference({...p,layoutTemplate:'text-illustration'}).map(r=>r.bytes)})
      : await generateCodexImage({prompt:referencePrompt(p,ref),width:960,height:960,
      references:styleReference({...p,layoutTemplate:'text-illustration'}),key:`story-ppt:${id}:ref:${ref.id}:${ref.imageVersion}`,
      existingJobId:ref.codexJobId,onJob:jobId=>mutateReference(id,revision,referenceId,{codexJobId:jobId})});
    current(id,revision);
    const file=`reference-${ref.id}-${ref.imageVersion}.png`; writeFileSync(resolve(projectDir(id),file),result.bytes);
    if(process.env.SAAS_MODE==='1')await putObject(`projects/${id}/${file}`,result.bytes,'image/png');
    mutateReference(id,revision,referenceId,{image:file,status:'done',generationMs:result.durationMs,codexJobId:'jobId' in result?result.jobId as string:undefined,error:undefined});
  } catch(error) { mutateReference(id,revision,referenceId,{status:'failed',error:error instanceof Error?error.message:String(error)}); throw error; }
}
export async function imagePage(id:string, revision:number, pageId:string):Promise<void> {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId)!;
  if(page.image && existsSync(resolve(projectDir(id),page.image))) return;
  try {
    if(process.env.SAAS_MODE==='1')reserveImage(id);
    const provider=page.codexJobId?'codex':imageSettings().provider;
    mutatePage(id,revision,pageId,{status:'running',provider});
    const prompt=imagePrompt(p.styleId,page.prompt,p.narrativeMode);
    const {bytes,durationMs}=provider==='cloudflare'
      ? await generateCloudflareImage({prompt,width:imageSize(p).width,height:imageSize(p).height,references:pageReferences(p,page).map(r=>r.bytes)})
      : provider==='codex'
      ? await generateCodexImage({prompt,width:imageSize(p).width,height:imageSize(p).height,
        references:pageReferences(p,page),key:`story-ppt:${id}:page:${page.id}:${page.imageVersion}`,
        existingJobId:page.codexJobId,onJob:jobId=>mutatePage(id,revision,pageId,{codexJobId:jobId})})
      : await generateImage(prompt,p.styleId,p.layoutTemplate);
    current(id,revision);
    const file=`${pageId}-${page.imageVersion}.png`; writeFileSync(resolve(projectDir(id),file),bytes);
    if(process.env.SAAS_MODE==='1')await putObject(`projects/${id}/${file}`,bytes,'image/png');
    mutatePage(id,revision,pageId,{image:file,status:'done',generationMs:durationMs,error:undefined}); return;
  } catch(error) { mutatePage(id,revision,pageId,{status:'failed',error:error instanceof Error?error.message:String(error)}); throw error; }
}
export async function executePhase(id:string):Promise<void> {
  let p=read(id); const revision=p.revision;
  p.phaseStartedAt=Date.now(); delete p.error; save(p);
  try {
    if(p.phase==='draft') {
      const referenceInstructions='\n同时提取视频中重复出现的人物（最多3位）和关键地点（最多2处），给每项稳定的 key、名称和可画的外观描述；法律稿件如需重复出现的人物可用匿名通用人物，不暗示其真实身份。每页用 characterKeys 和 locationKey 关联确实出现的人物与地点；不得凭空补充案情或回忆。';
      const schema=p.layoutTemplate==='legal-carousel-v2'?legalGeneratedSchema:generatedSchema;
      const response=await agent.generate(planningPrompt(p.narrativeMode,p.title,p.source)+referenceInstructions,{structuredOutput:{schema}});
      const generated=schema.parse(response.object);
      if(p.layoutTemplate==='legal-carousel-v2'){
        const last=generated.pages[generated.pages.length-1];
        last.title='还有疑问？';last.body='点小程序问，结合你的情况继续了解。';
        last.prompt='一部手机放在桌上，旁边是整齐的法律材料，温和可信的咨询氛围，不出现文字或二维码';
      }
      p=current(id,revision);
      const raw=generated.pages.map(page=>Math.max(3,Math.min(12,Math.ceil(page.body.length/8))));
      const characters=new Map<string,string>(), locations=new Map<string,string>();
      p.references=[...generated.characters.map(item=>{const id=randomUUID();characters.set(item.key,id);return {id,kind:'character' as const,name:item.name.slice(0,40),description:item.description.slice(0,500),imageVersion:1,status:'idle' as const};}),
        ...generated.locations.map(item=>{const id=randomUUID();locations.set(item.key,id);return {id,kind:'location' as const,name:item.name.slice(0,40),description:item.description.slice(0,500),imageVersion:1,status:'idle' as const};})];
      p.pages=generated.pages.map((page,i)=>{
        const {characterKeys,locationKey,...content}=page;
        return {...content,id:randomUUID(),characterIds:[...new Set(characterKeys.map(key=>characters.get(key)).filter((id):id is string=>!!id))],
          locationId:locationKey?locations.get(locationKey)||null:null,
          duration:raw[i],imageVersion:1,status:'idle'};
      });
      p.state='script'; save(p); return;
    }
    if(p.phase==='references') {
      const results:PromiseSettledResult<void>[]=[];
      for(const ref of p.references||[]) results.push((await Promise.allSettled([imageReference(id,revision,ref.id)]))[0]);
      const failures=results.filter(result=>result.status==='rejected');
      if(failures.length) throw new Error(`${failures.length} 张参考图生成失败；已完成的图片保留，请单张重试`);
      p=current(id,revision); p.state='references'; save(p); return;
    }
    if(p.phase==='sample') {
      await imagePage(id,revision,p.pages[0].id); p=current(id,revision); p.state='sample'; save(p); return;
    }
    const results: PromiseSettledResult<void>[]=[];
    for(const page of p.pages) results.push((await Promise.allSettled([imagePage(id,revision,page.id)]))[0]);
    const failures=results.filter(r=>r.status==='rejected');
    if(failures.length) throw new Error(`${failures.length} 页生图失败；成功页面已保留，请查看页面错误后重试`);
    p=current(id,revision); p.state='rendering'; save(p);
    const started=Date.now();
    const props={...p,musicPath:musicFile(p.musicId),rendererRoot,projectDir:projectDir(id)};
    const propsPath=resolve(projectDir(id),`render-${revision}.json`); writeFileSync(propsPath,JSON.stringify(props));
    await runCommand(process.execPath,[resolve(appRoot,'scripts/render-ppt.cjs'),propsPath],appRoot,1_800_000);
    if(process.env.SAAS_MODE==='1')await putFile(`projects/${id}/final-${revision}.mp4`,resolve(projectDir(id),`final-${revision}.mp4`),'video/mp4');
    p=current(id,revision); p.final=`final-${revision}.mp4`; p.silent='silent.mp4'; p.renderMs=Date.now()-started; p.state='done'; save(p);
  } catch(error) {
    p=read(id); if(p.revision!==revision) return;
    p.state='failed'; p.error=error instanceof Error?error.message:String(error); save(p); throw error;
  }
}
export function approve(id:string, action:string, revision:number, pageId?:string, referenceId?:string):Project {
  const p=read(id); if(p.revision!==revision) throw new Error('内容已有更新，请刷新后重试');
  if(['drafting','references-generating','sample-generating','producing','rendering'].includes(p.state)) return p;
  if(action==='script') {
    if(p.state!=='script') throw new Error('当前不在脚本确认阶段');
    p.scriptApproved=true;
    p.referenceWorkflowEnabled=!!(p.referenceWorkflowVersion && p.references?.length && imageSettings().provider!=='draw-things');
    if(p.referenceWorkflowEnabled) {
      p.referencesApproved=false; p.phase='references'; p.state='references-generating';
    } else { p.referencesApproved=true; p.phase='sample'; p.state='sample-generating'; }
  } else if(action==='references') {
    if(p.state!=='references' || p.references?.some(r=>!r.image || r.status!=='done')) throw new Error('请先完成全部参考图');
    p.referencesApproved=true;
    p.phase=p.sampleApproved?'produce':'sample'; p.state=p.sampleApproved?'producing':'sample-generating';
  } else if(action==='generate-references') {
    if(p.state!=='references' || !p.referenceWorkflowEnabled) throw new Error('当前不在参考图审核阶段');
    if(imageSettings().provider==='draw-things') throw new Error('当前生图引擎不支持参考图');
    p.phase='references'; p.state='references-generating';
  } else if(action==='redraw-reference') {
    const ref=p.references?.find(r=>r.id===referenceId); if(!ref) throw new Error('参考图不存在');
    if(!p.scriptApproved) throw new Error('请先确认脚本');
    if(imageSettings().provider==='draw-things') throw new Error('当前生图引擎不支持参考图');
    ref.imageVersion++; delete ref.image; delete ref.error; delete ref.codexJobId; ref.status='idle';
    p.referencesApproved=false;
    for(const page of p.pages) if((page.characterIds||[]).includes(ref.id) || page.locationId===ref.id) {
      page.imageVersion++; delete page.image; delete page.codexJobId; page.status='idle';
      if(page===p.pages[0]) p.sampleApproved=false;
    }
    p.phase='references'; p.state='references-generating';
  } else if(action==='sample') {
    if(p.state!=='sample' || !p.pages[0]?.image) throw new Error('样稿尚未就绪');
    p.sampleApproved=true; p.phase='produce'; p.state='producing';
  } else if(action==='redraw') {
    const page=p.pages.find(s=>s.id===pageId); if(!page) throw new Error('页面不存在');
    if(!p.scriptApproved) throw new Error('请先确认脚本');
    const affected=page===p.pages[0] ? p.pages : [page];
    for(const item of affected) { item.imageVersion++; delete item.image; delete item.codexJobId; delete item.error; item.status='idle'; }
    if(page===p.pages[0]) p.sampleApproved=false;
    p.phase=p.sampleApproved?'produce':'sample'; p.state=p.sampleApproved?'producing':'sample-generating';
  } else if(action==='retry' || action==='render') {
    if(action==='render' && !p.sampleApproved) throw new Error('请先确认样稿');
    for(const page of p.pages) if(page.status==='failed') {
      page.imageVersion++; delete page.codexJobId; delete page.error; page.status='idle';
    }
    for(const ref of p.references||[]) if(ref.status==='failed') {
      delete ref.error; ref.status='idle';
    }
    p.phase=action==='render'?'produce':p.phase;
    p.state=p.phase==='draft'?'drafting':p.phase==='references'?'references-generating':p.phase==='sample'?'sample-generating':'producing';
  } else throw new Error('未知操作');
  p.revision++; delete p.final; delete p.error; return save(p);
}
export async function reconcileFailed(id:string) {
  const p=read(id);
  for(const page of p.pages) if(!page.image && page.status==='running') page.status='idle';
  for(const ref of p.references||[]) if(!ref.image && ref.status==='running') ref.status='idle';
  save(p);
}
