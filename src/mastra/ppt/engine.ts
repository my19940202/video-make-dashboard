import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { appRoot, rendererRoot } from '../lib/config';
import { runCommand } from '../lib/process';
import { pageSchema, projectDir, read, save, musicFile, type Project, type Page } from './store';
import { generateImage } from './draw-things';
import { imagePrompt } from './styles';
import { planningPrompt } from './narratives';

const generatedSchema = z.object({pages:z.array(pageSchema.omit({id:true})).min(6).max(8)});
const agent = new Agent({id:'ppt-planner', name:'视频分页', model:'deepseek/deepseek-flash',
  instructions:'根据调用方指定的口吻整理用户材料，遵守事实边界和输出结构。不要把一种口吻的结构套用到另一种口吻。'});
function current(id: string, revision: number) { const p=read(id); if(p.revision!==revision) throw new Error('版本已变更，停止旧任务'); return p; }
function mutatePage(id:string, revision:number, pageId:string, fields:Partial<Page>) {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId); if(!page) throw new Error('页面已移除'); Object.assign(page,fields); save(p);
}
export async function imagePage(id:string, revision:number, pageId:string):Promise<void> {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId)!;
  if(page.image && existsSync(resolve(projectDir(id),page.image))) return;
  try {
    mutatePage(id,revision,pageId,{status:'running'});
    const {bytes,durationMs}=await generateImage(imagePrompt(p.styleId,page.prompt,p.narrativeMode),p.styleId,p.layoutTemplate);
    current(id,revision);
    const file=`${pageId}-${page.imageVersion}.png`; writeFileSync(resolve(projectDir(id),file),bytes);
    mutatePage(id,revision,pageId,{image:file,status:'done',generationMs:durationMs,error:undefined}); return;
  } catch(error) { mutatePage(id,revision,pageId,{status:'failed',error:error instanceof Error?error.message:String(error)}); throw error; }
}
export async function executePhase(id:string):Promise<void> {
  let p=read(id); const revision=p.revision;
  p.phaseStartedAt=Date.now(); delete p.error; save(p);
  try {
    if(p.phase==='draft') {
      const response=await agent.generate(planningPrompt(p.narrativeMode,p.title,p.source),{structuredOutput:{schema:generatedSchema}});
      const generated=generatedSchema.parse(response.object);
      p=current(id,revision);
      const raw=generated.pages.map(page=>Math.max(7,Math.min(15,Math.ceil(page.body.length/5))));
      const total=raw.reduce((a,b)=>a+b,0); const target=Math.max(60,Math.min(90,total));
      p.pages=generated.pages.map((page,i)=>({...page,id:randomUUID(),duration:Math.round(raw[i]*target/total*10)/10,imageVersion:1,status:'idle'}));
      p.state='script'; save(p); return;
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
    p=current(id,revision); p.final=`final-${revision}.mp4`; p.silent='silent.mp4'; p.renderMs=Date.now()-started; p.state='done'; save(p);
  } catch(error) {
    p=read(id); if(p.revision!==revision) return;
    p.state='failed'; p.error=error instanceof Error?error.message:String(error); save(p); throw error;
  }
}
export function approve(id:string, action:string, revision:number, pageId?:string):Project {
  const p=read(id); if(p.revision!==revision) throw new Error('内容已有更新，请刷新后重试');
  if(['drafting','sample-generating','producing','rendering'].includes(p.state)) return p;
  if(action==='script') {
    if(p.state!=='script') throw new Error('当前不在脚本确认阶段');
    const total=p.pages.reduce((n,s)=>n+s.duration,0);
    if(total<60 || total>90.5) throw new Error('总时长须为60–90秒，请调整页面时长');
    p.scriptApproved=true; p.phase='sample'; p.state='sample-generating';
  } else if(action==='sample') {
    if(p.state!=='sample' || !p.pages[0]?.image) throw new Error('样稿尚未就绪');
    p.sampleApproved=true; p.phase='produce'; p.state='producing';
  } else if(action==='redraw') {
    const page=p.pages.find(s=>s.id===pageId); if(!page) throw new Error('页面不存在');
    if(!p.scriptApproved) throw new Error('请先确认脚本');
    const affected=page===p.pages[0] ? p.pages : [page];
    for(const item of affected) { item.imageVersion++; delete item.image; delete item.error; item.status='idle'; }
    if(page===p.pages[0]) p.sampleApproved=false;
    p.phase=p.sampleApproved?'produce':'sample'; p.state=p.sampleApproved?'producing':'sample-generating';
  } else if(action==='retry' || action==='render') {
    if(action==='render' && !p.sampleApproved) throw new Error('请先确认样稿');
    for(const page of p.pages) if(page.status==='failed') {
      delete page.error; page.status='idle';
    }
    p.phase=action==='render'?'produce':p.phase;
    p.state=p.phase==='draft'?'drafting':p.phase==='sample'?'sample-generating':'producing';
  } else throw new Error('未知操作');
  p.revision++; delete p.final; delete p.error; return save(p);
}
export async function reconcileFailed(id:string) {
  const p=read(id);
  for(const page of p.pages) if(!page.image && page.status==='running') page.status='idle';
  save(p);
}
