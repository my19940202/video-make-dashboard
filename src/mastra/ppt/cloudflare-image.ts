import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommand } from '../lib/process';

export async function generateCloudflareImage(options:{prompt:string;width:number;height:number;references?:Buffer[]}):Promise<{bytes:Buffer;durationMs:number}> {
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN;
  if(!account||!token)throw new Error('Cloudflare 生图凭据未配置');
  const started=Date.now();
  const input={prompt:options.prompt,quality:'medium',size:options.width===options.height?'1024x1024':'1024x1792',...(options.references?.length?{images:options.references.slice(0,3).map(bytes=>`data:image/png;base64,${bytes.toString('base64')}`)}:{})};
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-image-1.5',input}),signal:AbortSignal.timeout(600_000)});
  if(!response.ok)throw new Error(`Cloudflare 生图失败 (${response.status})`);
  const data=await response.json() as {state?:string;result?:{image?:string};error?:string};
  if(data.state!=='Completed'||!data.result?.image)throw new Error(`Cloudflare 未返回图片：${data.error||data.state||'未知错误'}`);
  const url=new URL(data.result.image);if(url.protocol!=='https:')throw new Error('生图地址无效');
  const image=await fetch(url,{signal:AbortSignal.timeout(120_000)});if(!image.ok)throw new Error('无法下载生成的图片');
  const raw=Buffer.from(await image.arrayBuffer());if(raw.length<33||raw.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('生成结果不是 PNG');
  const dir=mkdtempSync(resolve(tmpdir(),'story-cloudflare-'));
  try{const source=resolve(dir,'source.png'),target=resolve(dir,'target.png');writeFileSync(source,raw);await runCommand('ffmpeg',['-y','-v','error','-i',source,'-vf',`scale=${options.width}:${options.height}:force_original_aspect_ratio=increase,crop=${options.width}:${options.height}`,'-frames:v','1',target],dir,60_000);return {bytes:readFileSync(target),durationMs:Date.now()-started};}
  finally{rmSync(dir,{recursive:true,force:true});}
}
