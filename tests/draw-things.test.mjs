import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const bundled=await build({entryPoints:['src/mastra/ppt/draw-things.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {generateImage}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(768,16);png.writeUInt32BE(768,20);
test('Draw Things 使用 768 方图并解码 PNG',async()=>{
 const original=globalThis.fetch;let request;
 globalThis.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({images:[png.toString('base64')]}),{status:200});};
 try{const result=await generateImage('测试插画');assert.equal(request.url,'http://127.0.0.1:7860/sdapi/v1/txt2img');assert.equal(request.body.width,768);assert.equal(request.body.height,768);assert.equal(request.body.model,'z_image_turbo_1.0_q8p.ckpt');assert.deepEqual(result.bytes,png);}finally{globalThis.fetch=original;}
});
test('Draw Things 缺少图片时给出明确错误',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({images:[]}));try{await assert.rejects(generateImage('测试'),/未返回图片/);}finally{globalThis.fetch=original;}});
test('前三种样式通过 img2img 使用各自的 960 参考图',async()=>{const original=globalThis.fetch;let request;globalThis.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body),timeout:options.signal};return new Response(JSON.stringify({images:[png.toString('base64')]}));};try{for(const style of ['colored-pencil-diary','ink-wash','warm-flat-storybook']){await generateImage('测试插画',style);assert.equal(request.url,'http://127.0.0.1:7860/sdapi/v1/img2img');assert.equal(request.body.width,960);assert.equal(request.body.height,960);assert.equal(request.body.strength,.96);assert.equal(request.body.steps,10);assert.deepEqual(Buffer.from(request.body.init_images[0],'base64'),readFileSync(`assets/style-references/${style}.png`));}}finally{globalThis.fetch=original;}});
