import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { appRoot, rendererRoot } from '../lib/config';
import { runCommand } from '../lib/process';
import { pageSchema, projectDir, read, save, musicFile, type Project, type Page } from './store';

const generatedSchema = z.object({pages:z.array(pageSchema.omit({id:true})).min(6).max(8)});
const agent = new Agent({id:'ppt-planner', name:'案例视频分页', model:'deepseek/deepseek-flash',
  instructions:'把用户材料整理为无配音的竖屏案例解读PPT，按要点组织6至8页，不逐句拆图。只使用提供的事实，不编造法律依据或案件结论。每页标题不超过32字，正文不超过180字且必须独立可读，配图提示词不包含文字排版要求。默认极简编辑插画、深蓝与浅蓝、白底。内容包括问题、经过、争议、结论、行动建议；材料不足时明确表达不确定性。单页4至30秒，总时长60至90秒。'});
const apiBase = () => (process.env.IMAGE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
async function request(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${apiBase()}${path}`, {method:body?'POST':'GET',
    headers:body?{'content-type':'application/json'}:undefined, body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(15_000)});
  if (!response.ok) throw new Error(`生图服务 ${response.status}：${(await response.text()).slice(0,250)}`);
  return response.json();
}
function current(id: string, revision: number) { const p=read(id); if(p.revision!==revision) throw new Error('版本已变更，停止旧任务'); return p; }
function mutatePage(id:string, revision:number, pageId:string, fields:Partial<Page>) {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId); if(!page) throw new Error('页面已移除'); Object.assign(page,fields); save(p);
}
export async function imagePage(id:string, revision:number, pageId:string):Promise<void> {
  const p=current(id,revision); const page=p.pages.find(x=>x.id===pageId)!;
  if(page.image && existsSync(resolve(projectDir(id),page.image))) return;
  try {
    let jobId=page.jobId;
    if(!jobId) {
      const sample=p.pages[0];
      const job=await request('/api/jobs',{
        prompt:`为竖屏法律案例知识卡绘制一张不含任何文字的插画。白底，深蓝与浅蓝配色，简洁清晰。人物设定与参考图保持一致。画面内容：${page.prompt}`,
        aspect_ratio:'16:9', reference_ids:pageId!==sample.id && sample.jobId ? [sample.jobId] : [],
        idempotency_key:`ppt-${id}-${pageId}-${page.imageVersion}`,
      });
      jobId=job.id; mutatePage(id,revision,pageId,{jobId,status:job.status});
    }
    const start=Date.now();
    for(;;) {
      const job=await request(`/api/jobs/${jobId}`);
      mutatePage(id,revision,pageId,{status:job.status, queueMs:job.queue_ms ?? undefined, generationMs:job.duration_ms ?? undefined});
      if(job.status==='failed') throw new Error(job.error || '生图失败');
      if(job.status==='done') {
        const res=await fetch(`${apiBase()}/api/jobs/${jobId}/image`,{signal:AbortSignal.timeout(30_000)});
        if(!res.ok) throw new Error('下载图片失败');
        const bytes=Buffer.from(await res.arrayBuffer());
        if(bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(16)<512 || bytes.readUInt32BE(20)<512) throw new Error('图片不是有效的至少512像素PNG');
        current(id,revision);
        const file=`${pageId}-${page.imageVersion}.png`; writeFileSync(resolve(projectDir(id),file),bytes);
        mutatePage(id,revision,pageId,{image:file,status:'done',error:undefined}); return;
      }
      if(Date.now()-start>45*60_000) throw new Error('等待生图超时，可重试继续查询');
      await new Promise(r=>setTimeout(r,1500));
    }
  } catch(error) { mutatePage(id,revision,pageId,{status:'failed',error:error instanceof Error?error.message:String(error)}); throw error; }
}
export async function executePhase(id:string):Promise<void> {
  let p=read(id); const revision=p.revision;
  p.phaseStartedAt=Date.now(); delete p.error; save(p);
  try {
    if(p.phase==='draft') {
      const response=await agent.generate(`标题：${p.title}\n材料：\n${p.source}`,{structuredOutput:{schema:generatedSchema}});
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
    const results=await Promise.allSettled(p.pages.map(page=>imagePage(id,revision,page.id)));
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
    for(const item of affected) { item.imageVersion++; delete item.image; delete item.jobId; delete item.error; item.status='idle'; }
    if(page===p.pages[0]) p.sampleApproved=false;
    p.phase=p.sampleApproved?'produce':'sample'; p.state=p.sampleApproved?'producing':'sample-generating';
  } else if(action==='retry' || action==='render') {
    if(action==='render' && !p.sampleApproved) throw new Error('请先确认样稿');
    for(const page of p.pages) if(page.status==='failed') {
      // Preserve a remote job after network failure; reconcile it before deciding to resubmit.
      delete page.error; page.status=page.jobId?'pending':'idle';
    }
    p.phase=action==='render'?'produce':p.phase;
    p.state=p.phase==='draft'?'drafting':p.phase==='sample'?'sample-generating':'producing';
  } else throw new Error('未知操作');
  p.revision++; delete p.final; delete p.error; return save(p);
}
export async function reconcileFailed(id:string) {
  const p=read(id);
  for(const page of p.pages) if(page.jobId && !page.image) {
    const job=await request(`/api/jobs/${page.jobId}`);
    if(job.status==='failed') { delete page.jobId; page.imageVersion++; page.status='idle'; }
  }
  save(p);
}
