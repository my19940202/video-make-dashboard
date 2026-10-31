import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appRoot } from '../lib/config';
import type { StyleId } from './styles';
import type { LayoutTemplate } from './store';

const apiBase = () => (process.env.DRAW_THINGS_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');
export async function generateImage(prompt: string, styleId: StyleId = 'legacy-blue', layoutTemplate: LayoutTemplate = 'text-illustration'): Promise<{bytes: Buffer; durationMs: number}> {
  const started=Date.now();
  const referenced=styleId!=='legacy-blue';
  const portrait=layoutTemplate==='title-full-image'||layoutTemplate==='legal-carousel-v2';
  const width=portrait?576:referenced?960:768;
  const height=portrait?768:referenced?960:768;
  const image=referenced?readFileSync(resolve(appRoot,'assets/style-references',...(portrait?['portrait']:[]),`${styleId}.png`)).toString('base64'):undefined;
  const payload=referenced
    ? {prompt,init_images:[image],width,height,strength:0.96,steps:20}
    : {model:'z_image_turbo_1.0_q8p.ckpt',prompt,negative_prompt:'',width,height,steps:8,guidance_scale:1,sampler:'UniPC Trailing',shift:3,seed:-1};
  let response: Response;
  try { response=await fetch(`${apiBase()}/sdapi/v1/${referenced?'img2img':'txt2img'}`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(referenced?600_000:300_000)}); }
  catch(error) { throw new Error(`无法连接 Draw Things：${error instanceof Error?error.message:String(error)}`); }
  if(!response.ok) throw new Error(`Draw Things ${response.status}：${(await response.text()).slice(0,250)}`);
  const data=await response.json() as {images?:unknown[]};
  const encoded=data.images?.[0];
  if(typeof encoded!=='string') throw new Error('Draw Things 未返回图片');
  const raw=encoded.startsWith('data:')?encoded.slice(encoded.indexOf(',')+1):encoded;
  if(!/^[A-Za-z0-9+/\s]+={0,2}$/.test(raw)) throw new Error('Draw Things 返回的图片编码无效');
  const bytes=Buffer.from(raw,'base64');
  if(bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(16)<512 || bytes.readUInt32BE(20)<512) throw new Error('Draw Things 返回的图片不是有效的至少512像素PNG');
  if(portrait && (bytes.readUInt32BE(16)!==width || bytes.readUInt32BE(20)!==height)) throw new Error(`Draw Things 返回的图片尺寸应为 ${width}×${height}`);
  return {bytes,durationMs:Date.now()-started};
}
