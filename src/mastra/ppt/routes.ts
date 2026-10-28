import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { appRoot } from '../lib/config';
import { runCommand } from '../lib/process';
import { approve } from './engine';
import { create, list, read, update, projectDir, musicDir, musicFile, musicList } from './store';
import { launch, recover } from './workflow';
import { styleIdSchema } from './styles';

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
function checkOrigin(c:any) {const origin=c.req.header('origin'); if(origin && origin!==new URL(c.req.url).origin) throw new Error('不允许跨站请求');}
export const pptRoutes=[
  registerApiRoute('/workbench',{method:'GET',requiresAuth:false,handler:async()=>fileResponse(resolve(appRoot,'public/workbench/index.html'),'text/html; charset=utf-8')}),
  registerApiRoute('/workbench/:file',{method:'GET',requiresAuth:false,handler:async c=>{
    const name=c.req.param('file'); if(!['app.js','style.css','layout.mjs'].includes(name)) return c.text('Not found',404);
    return fileResponse(resolve(appRoot,'public/workbench',name),name.endsWith('.css')?'text/css':'text/javascript');
  }}),
  registerApiRoute('/ppt/projects',{method:'GET',requiresAuth:false,handler:async c=>{recover();return c.json(list());}}),
  registerApiRoute('/ppt/projects',{method:'POST',requiresAuth:false,handler:async c=>{
    try {checkOrigin(c); const body=z.object({title:z.string().trim().min(1).max(60),source:z.string().trim().min(10).max(20000),styleId:styleIdSchema.default('colored-pencil-diary')}).parse(await c.req.json());
      const p=create(body.title,body.source,body.styleId);launch(p.id);return c.json(p,201);
    }catch(e){return c.json({error:errorMessage(e)},400);}
  }}),
  registerApiRoute('/ppt/projects/:id',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const id=c.req.param('id');launch(id);return c.json(read(id));}catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
  registerApiRoute('/ppt/projects/:id',{method:'PUT',requiresAuth:false,handler:async c=>{
    try{checkOrigin(c);const body=await c.req.json();musicFile(body.musicId);return c.json(update(c.req.param('id'),body));}catch(e){return c.json({error:errorMessage(e)},409);}
  }}),
  registerApiRoute('/ppt/projects/:id/action',{method:'POST',requiresAuth:false,handler:async c=>{
    try{checkOrigin(c);const body=z.object({action:z.enum(['script','sample','retry','render','redraw']),revision:z.number().int(),pageId:z.string().uuid().optional()}).parse(await c.req.json());
      const p=approve(c.req.param('id'),body.action,body.revision,body.pageId);launch(p.id);return c.json(p);
    }catch(e){return c.json({error:errorMessage(e)},409);}
  }}),
  registerApiRoute('/ppt/projects/:id/assets/:file',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const {id,file}=c.req.param();const p=read(id);
      if(![...p.pages.map(page=>page.image),p.final].includes(file)) return c.text('Not found',404);
      return fileResponse(resolve(projectDir(id),file),file.endsWith('.png')?'image/png':'video/mp4',c.req.header('range'));
    }catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
  registerApiRoute('/ppt/music',{method:'GET',requiresAuth:false,handler:async c=>c.json(musicList())}),
  registerApiRoute('/ppt/music',{method:'POST',requiresAuth:false,handler:async c=>{
    let dest:string|undefined;
    try{checkOrigin(c);
      if(Number(c.req.header('content-length')||0)>32*1024*1024) throw new Error('音乐最大32MB');
      const form=await c.req.formData();const file=form.get('file');
      if(!file || typeof file==='string' || file.size>32*1024*1024) throw new Error('请选择32MB以内的MP3或WAV');
      const ext=extname(file.name).toLowerCase(); if(!['.mp3','.wav'].includes(ext)) throw new Error('仅支持MP3或WAV');
      const id=randomUUID();dest=resolve(musicDir(),id+ext);writeFileSync(dest,Buffer.from(await file.arrayBuffer()));
      const probe=await runCommand('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','csv=p=0',dest],musicDir(),30000);
      if(!probe.includes('audio')) throw new Error('文件中没有有效音轨');
      const entry={id,name:file.name.slice(0,100),file:id+ext};writeFileSync(resolve(musicDir(),`${id}.json`),JSON.stringify(entry));return c.json(entry,201);
    }catch(e){if(dest && existsSync(dest))unlinkSync(dest);return c.json({error:errorMessage(e)},400);}
  }}),
  registerApiRoute('/ppt/music/:id',{method:'GET',requiresAuth:false,handler:async c=>{
    try{const file=musicFile(c.req.param('id'))!;return fileResponse(file,file.endsWith('.wav')?'audio/wav':'audio/mpeg',c.req.header('range'));}catch(e){return c.json({error:errorMessage(e)},404);}
  }}),
];
