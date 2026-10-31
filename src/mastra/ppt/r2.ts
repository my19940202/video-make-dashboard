import { createHash, createHmac } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';

const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const hmac=(key:Buffer|string,value:string)=>createHmac('sha256',key).update(value).digest();
function config(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,access=process.env.R2_ACCESS_KEY_ID,secret=process.env.R2_SECRET_ACCESS_KEY,bucket=process.env.R2_BUCKET;
  if(!account||!access||!secret||!bucket)throw new Error('R2 存储未配置');
  return {account,access,secret,bucket};
}
async function hashFile(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function request(method:'GET'|'PUT',key:string,body?:Buffer|string,type?:string,range?:string):Promise<Response>{
  const {account,access,secret,bucket}=config();
  const host=`${account}.r2.cloudflarestorage.com`;
  const path=`/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8);
  const hash=method==='GET'?sha256(''):Buffer.isBuffer(body)?sha256(body):body?await hashFile(body):sha256('');
  const headers:Record<string,string>={'host':host,'x-amz-content-sha256':hash,'x-amz-date':stamp};
  if(type)headers['content-type']=type;
  if(range)headers.range=range;
  const names=Object.keys(headers).sort(),signed=names.join(';');
  const canonical=names.map(name=>`${name}:${headers[name].trim()}\n`).join('');
  const scope=`${day}/auto/s3/aws4_request`;
  const toSign=`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(`${method}\n${path}\n\n${canonical}\n${signed}\n${hash}`)}`;
  const signing=hmac(hmac(hmac(hmac(`AWS4${secret}`,day),'auto'),'s3'),'aws4_request');
  headers.authorization=`AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed}, Signature=${hmac(signing,toSign).toString('hex')}`;
  const init:RequestInit & {duplex?:'half'}={method,headers,signal:AbortSignal.timeout(method==='PUT'?600_000:120_000)};
  if(method==='PUT'&&body!==undefined){init.body=typeof body==='string'?createReadStream(body) as unknown as BodyInit:new Uint8Array(body);if(typeof body==='string'){init.duplex='half';headers['content-length']=String(statSync(body).size);}}
  const response=await fetch(`https://${host}${path}`,init);
  if(!response.ok)throw new Error(`R2 ${method} 失败 (${response.status})`);
  return response;
}
export async function putObject(key:string,bytes:Buffer,type:string){await request('PUT',key,bytes,type);}
export async function putFile(key:string,file:string,type:string){await request('PUT',key,file,type);}
export async function getObject(key:string,range?:string):Promise<Response>{const source=await request('GET',key,undefined,undefined,range);const headers=new Headers({'Content-Type':source.headers.get('content-type')||'application/octet-stream','Cache-Control':'private, no-store','Accept-Ranges':'bytes'});for(const name of ['content-length','content-range']){const value=source.headers.get(name);if(value)headers.set(name,value);}return new Response(source.body,{status:source.status,headers});}
