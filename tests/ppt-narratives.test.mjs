import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {pageSvg} from '../public/workbench/layout.mjs';

const bundled=await build({entryPoints:['src/mastra/ppt/narratives.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {planningPrompt,pageLabel}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('法律与回忆录使用不同文本结构',()=>{
  const legal=planningPrompt('legal-case','合同争议','双方签订合同');
  const memoir=planningPrompt('childhood-memoir','夏天的院子','我小时候住在外婆家');
  assert.match(legal,/问题、经过、争议、结论、行动建议/);
  assert.match(memoir,/第一人称/);
  assert.match(memoir,/不得虚构事件、对白/);
  assert.match(memoir,/我小时候住在外婆家/);
  assert.doesNotMatch(memoir,/按问题、经过、争议、结论、行动建议组织/);
});

test('预览页眉按口吻切换',()=>{
  const page={title:'院子',body:'那年夏天我常坐在门口。',duration:8};
  assert.equal(pageLabel('legal-case'),'案例笔记');
  assert.equal(pageLabel('childhood-memoir'),'童年手记');
  assert.match(pageSvg(page,0,1,'',false,'childhood-memoir'),/童年手记/);
  assert.doesNotMatch(pageSvg(page,0,1,'',false,'childhood-memoir'),/案例笔记/);
});
