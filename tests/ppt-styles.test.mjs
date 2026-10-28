import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['src/mastra/ppt/styles.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {imagePrompt,styleIds}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('四种样式分别组合画面描述且不混入蓝白限制',()=>{
  assert.deepEqual(styleIds,['colored-pencil-diary','ink-wash','warm-flat-storybook','legacy-blue']);
  const marker='律师在桌前阅读合同';
  const prompts=styleIds.map(id=>imagePrompt(id,marker));
  for(const prompt of prompts){assert.match(prompt,/律师在桌前阅读合同/);assert.match(prompt,/不含任何文字/);}
  assert.match(prompts[0],/彩铅日记漫画/);
  assert.match(prompts[1],/写意水墨画/);
  assert.match(prompts[2],/暖色几何扁平绘本/);
  assert.match(prompts[3],/深蓝与浅蓝/);
  assert.ok(prompts.slice(0,3).every(prompt=>!prompt.includes('深蓝与浅蓝')));
  const memoir=imagePrompt('colored-pencil-diary','我和奶奶在院子里','childhood-memoir');
  assert.match(memoir,/童年回忆录/);
  assert.doesNotMatch(memoir,/法律案例知识卡/);
});
