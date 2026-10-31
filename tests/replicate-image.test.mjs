import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const bundled=buildSync({entryPoints:['src/mastra/ppt/replicate-image.ts'],bundle:true,platform:'node',format:'esm',write:false,packages:'external'});
const {generateReplicateImage}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const portrait=readFileSync('assets/style-references/portrait/colored-pencil-diary.png');
const square=readFileSync('assets/style-references/colored-pencil-diary.png');
const predictionId='abcdef1234567890abcdef12';
const output='https://replicate.delivery/test/result.png';

test('Replicate 直接请求 low 和 3:4，成功结果不裁剪',async()=>{
  const original=globalThis.fetch, token=process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN='test-token';
  let body,headers,saved;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/models/')){body=JSON.parse(init.body);headers=init.headers;return new Response(JSON.stringify({id:predictionId,status:'succeeded',output:[output]}));}
    assert.equal(String(url),output);return new Response(portrait);
  };
  try{
    const result=await generateReplicateImage({prompt:'法律插画',width:576,height:768,onPrediction:id=>saved=id});
    assert.equal(body.input.quality,'low');assert.equal(body.input.aspect_ratio,'3:4');
    assert.equal(body.input.output_format,'png');assert.equal(headers.Prefer,'wait');
    assert.equal(headers.Authorization,'Bearer test-token');assert.equal(saved,predictionId);
    assert.deepEqual(result.bytes,portrait);
  }finally{globalThis.fetch=original;if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;}
});

test('Replicate 方图携带压缩后的参考图，并轮询未完成任务',async()=>{
  const original=globalThis.fetch, token=process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN='test-token';
  let body,polls=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/models/')){body=JSON.parse(init.body);return new Response(JSON.stringify({id:predictionId,status:'processing'}));}
    if(String(url).includes('/predictions/')){polls++;return new Response(JSON.stringify({id:predictionId,status:'succeeded',output:[output]}));}
    return new Response(square);
  };
  try{
    const result=await generateReplicateImage({prompt:'人物',width:960,height:960,references:[square],onPrediction:()=>{}});
    assert.equal(body.input.aspect_ratio,'1:1');assert.match(body.input.input_images[0],/^data:image\/jpeg;base64,/);
    assert.equal(polls,1);assert.deepEqual(result.bytes,square);
  }finally{globalThis.fetch=original;if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;}
});

test('已有预测 ID 直接查询，失败状态与错误比例有明确提示',async()=>{
  const original=globalThis.fetch, token=process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN='test-token';
  let calls=0;
  globalThis.fetch=async url=>{calls++;assert.match(String(url),/\/predictions\/abcdef1234567890abcdef12$/);return new Response(JSON.stringify({id:predictionId,status:'failed',error:'quota exceeded'}));};
  try{
    await assert.rejects(generateReplicateImage({prompt:'测试',width:576,height:768,existingPredictionId:predictionId,onPrediction:()=>{}}),/quota exceeded/);
    assert.equal(calls,1);
    globalThis.fetch=async url=>String(url).includes('/predictions/')?new Response(JSON.stringify({id:predictionId,status:'succeeded',output:[output]})):new Response(square);
    await assert.rejects(generateReplicateImage({prompt:'测试',width:576,height:768,existingPredictionId:predictionId,onPrediction:()=>{}}),/比例不符/);
  }finally{globalThis.fetch=original;if(token===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=token;}
});
