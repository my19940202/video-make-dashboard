const apiBase = () => (process.env.DRAW_THINGS_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');
export async function generateImage(prompt: string): Promise<{bytes: Buffer; durationMs: number}> {
  const started=Date.now();
  let response: Response;
  try { response=await fetch(`${apiBase()}/sdapi/v1/txt2img`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'z_image_turbo_1.0_q8p.ckpt',prompt,negative_prompt:'',width:768,height:768,steps:8,guidance_scale:1,sampler:'UniPC Trailing',shift:3,seed:-1}),signal:AbortSignal.timeout(300_000)}); }
  catch(error) { throw new Error(`无法连接 Draw Things：${error instanceof Error?error.message:String(error)}`); }
  if(!response.ok) throw new Error(`Draw Things ${response.status}：${(await response.text()).slice(0,250)}`);
  const data=await response.json() as {images?:unknown[]};
  const encoded=data.images?.[0];
  if(typeof encoded!=='string') throw new Error('Draw Things 未返回图片');
  const raw=encoded.startsWith('data:')?encoded.slice(encoded.indexOf(',')+1):encoded;
  if(!/^[A-Za-z0-9+/\s]+={0,2}$/.test(raw)) throw new Error('Draw Things 返回的图片编码无效');
  const bytes=Buffer.from(raw,'base64');
  if(bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(16)<512 || bytes.readUInt32BE(20)<512) throw new Error('Draw Things 返回的图片不是有效的至少512像素PNG');
  return {bytes,durationMs:Date.now()-started};
}
