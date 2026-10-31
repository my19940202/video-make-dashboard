import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { appRoot } from '../lib/config';
import { runCommand } from '../lib/process';
import { approve } from './engine';
import { create, list, read, update, projectDir, musicDir, musicFile, musicList, layoutTemplateSchema } from './store';
import { launch, recover } from './workflow';
import { styleIdSchema } from './styles';
import { narrativeModeSchema } from './narratives';
import { imageSettings, setImageSettings } from './settings';
import { userFor, sendCode, verifyCode, logout, ownsProject, ownProject, projectIds, ownsMusic, ownMusic, musicIds } from './auth';
import { putObject, getObject } from './r2';

function errorMessage(error:unknown) {return error instanceof Error?error.message:String(error);}
function fileResponse(file:string,type:string,range?:string):Response {
  if(!existsSync(file)) return new Response('文件尚未生成',{status:404});
  const bytes=readFileSync(file); const headers:Record<string,string>={'Content-Type':type,'Cache-Control':'no-store','Accept-Ranges':'bytes'};
  if(range) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    const start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
    const end=match[1]?(match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1):bytes.length-1;
    if(start>end || start>=bytes.length) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
  }
  return new Response(new Uint8Array(bytes),{headers});
}
// Local mutations require same-origin requests; cross-origin browser forms cannot start jobs.
function checkOrigin(c:any) {const origin=c.req.header('origin');if(!origin)return;const expected=c.req.header('x-forwarded-host')||c.req.header('host')||new URL(c.req.url).host;const url=new URL(origin);if(url.host!==expected||!['https:','http:'].includes(url.protocol))throw new Error('不允许跨站请求');}
function requireUser(c:any):string {const id=userFor(c.req.raw);if(!id)throw new Error('请先登录');return id;}
function requireProject(c:any):string {const user=requireUser(c),id=c.req.param('id');if(!ownsProject(user,id))throw new Error('项目不存在');return id;}
export const pptRoutes=[
  registerApiRoute('/auth/me',{method:'GET',requiresAuth:false,handler:async c=>c.json({authenticated:!!userFor(c.req.raw)})}),
  registerApiRoute('/auth/send-code',{method:'POST',requiresAuth:false,handler:async c=>{try{checkOrigin(c);await sendCode(c.req.raw,(await c.req.json()).email);return c.json({ok:true});}catch(e){return c.json({error:errorMessage(e)},400);}}}),
  registerApiRoute('/auth/verify',{method:'POST',requiresAuth:false,handler:async c=>{try{checkOrigin(c);const body=await c.req.json();const result=verifyCode(body.email,body.code);c.header('Set-Cookie',result.cookie);return c.json({ok:true});}catch(e){return c.json({error:errorMessage(e)},400);}}}),
  registerApiRoute('/auth/logout',{method:'POST',requiresAuth:false,handler:async c=>{checkOrigin(c);c.header('Set-Cookie',logout(c.req.raw));return c.json({ok:true});}}),
  registerApiRoute('/workbench',{method:'GET',requiresAuth:false,handler:async()=>fileResponse(resolve(appRoot,'public/workbench/index.html'),'text/html; charset=utf-8')}),
  registerApiRoute('/workbench/:file',{method:'GET',requiresAuth:false,handler:async c=>{
    const name=c.req.param('file'); if(!['app.js','style.css','layout.mjs'].includes(name)) return c.text('Not found',404);
    return fileResponse(resolve(appRoot,'public/workbench',name),name.endsWith('.css')?'text/css':'text/javascript');
  }}),
  registerApiRoute('/ppt/projects',{method:'GET',requiresAuth:false,handler:async c=>{try{const ids=projectIds(requireUser(c));recover();return c.json(list().filter(p=>ids.has(p.id)));}catch(e){return c.json({error:errorMessage(e)},401);}}}),
  registerApiRoute('/ppt/projects',{method:'POST',requiresAuth:false,handler:async c=>{
    try {checkOrigin(c);const user=requireUser(c); const body=z.object({title:z.string().trim().min(1).max(60),source:z.string().trim().min(10).max(20000),styleId:styleIdSchema.default('colored-pencil-diary'),narrativeMode:narrativeModeSchema.default('legal-case'),layoutTemplate:layoutTemplateSchema.optional()}).parse(await c.req.json());
      const layout=body.narrativeMode==='legal-case'?'legal-carousel-v2':body.layoutTemplate||'text-illustration';
      const p=create(body.title,body.source,body.styleId,body.narrativeMode,layout);ownProject(user,p.id);launch(p.id);return c.json(p,201);
    }catch(e){return c.json({error:errorMessage(e)},400);}
  }}),
  registerApiRoute('/ppt/projects/:id',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const id=requireProject(c);launch(id);return c.json(read(id));}catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
  registerApiRoute('/ppt/projects/:id',{method:'PUT',requiresAuth:false,handler:async c=>{
    try{checkOrigin(c);const id=requireProject(c);const body=await c.req.json();if(body.musicId&&!ownsMusic(requireUser(c),body.musicId))throw new Error('背景音乐不存在');musicFile(body.musicId);return c.json(update(id,body));}catch(e){return c.json({error:errorMessage(e)},409);}
  }}),
  registerApiRoute('/ppt/projects/:id/action',{method:'POST',requiresAuth:false,handler:async c=>{
    try{checkOrigin(c);const body=z.object({action:z.enum(['script','references','generate-references','redraw-reference','sample','retry','render','redraw']),revision:z.number().int(),pageId:z.string().uuid().optional(),referenceId:z.string().uuid().optional()}).parse(await c.req.json());
      const p=approve(requireProject(c),body.action,body.revision,body.pageId,body.referenceId);launch(p.id);return c.json(p);
    }catch(e){return c.json({error:errorMessage(e)},409);}
  }}),
  registerApiRoute('/ppt/projects/:id/assets/:file',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const id=requireProject(c),file=c.req.param('file');const p=read(id);
      if(![...p.pages.map(page=>page.image),...(p.references||[]).map(ref=>ref.image),p.final].includes(file)) return c.text('Not found',404);
      return process.env.SAAS_MODE==='1'?await getObject(`projects/${id}/${file}`,c.req.header('range')):fileResponse(resolve(projectDir(id),file),file.endsWith('.png')?'image/png':'video/mp4',c.req.header('range'));
    }catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
  registerApiRoute('/ppt/music',{method:'GET',requiresAuth:false,handler:async c=>{try{const ids=musicIds(requireUser(c));return c.json(musicList().filter(m=>ids.has(m.id)));}catch(e){return c.json({error:errorMessage(e)},401);}}}),
  registerApiRoute('/ppt/music',{method:'POST',requiresAuth:false,handler:async c=>{
    let dest:string|undefined;
    try{checkOrigin(c);const user=requireUser(c);
      if(Number(c.req.header('content-length')||0)>32*1024*1024) throw new Error('音乐最大32MB');
      const form=await c.req.formData();const file=form.get('file');
      if(!file || typeof file==='string' || file.size>32*1024*1024) throw new Error('请选择32MB以内的MP3或WAV');
      const ext=extname(file.name).toLowerCase(); if(!['.mp3','.wav'].includes(ext)) throw new Error('仅支持MP3或WAV');
      const id=randomUUID();dest=resolve(musicDir(),id+ext);writeFileSync(dest,Buffer.from(await file.arrayBuffer()));
      const probe=await runCommand('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','csv=p=0',dest],musicDir(),30000);
      if(!probe.includes('audio')) throw new Error('文件中没有有效音轨');
      const entry={id,name:file.name.slice(0,100),file:id+ext};if(process.env.SAAS_MODE==='1')await putObject(`music/${id}${ext}`,readFileSync(dest),ext==='.mp3'?'audio/mpeg':'audio/wav');writeFileSync(resolve(musicDir(),`${id}.json`),JSON.stringify(entry));ownMusic(user,id);return c.json(entry,201);
    }catch(e){if(dest && existsSync(dest))unlinkSync(dest);return c.json({error:errorMessage(e)},400);}
  }}),
  registerApiRoute('/ppt/music/:id',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const id=c.req.param('id');if(!ownsMusic(requireUser(c),id))throw new Error('背景音乐不存在');const file=musicFile(id)!;return process.env.SAAS_MODE==='1'?await getObject(`music/${id}${extname(file)}`,c.req.header('range')):fileResponse(file,file.endsWith('.wav')?'audio/wav':'audio/mpeg',c.req.header('range'));}catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
];
