import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { executePhase, reconcileFailed } from './engine';
import { list, read, save } from './store';

const schema=z.object({id:z.string().uuid()});
export const pptWorkflow=createWorkflow({id:'ppt-video-workflow',inputSchema:schema,outputSchema:schema})
  .then(createStep({id:'execute-ppt-phase',inputSchema:schema,outputSchema:schema,
    execute:async({inputData})=>{await reconcileFailed(inputData.id); await executePhase(inputData.id);return inputData;},
  })).commit();
const active=new Set<string>();
export function launch(id:string) {
  if(process.env.SAAS_MODE==='1' && process.env.PPT_WORKER!=='1')return;
  if(process.env.SAAS_MODE==='1' && active.size>=1)return;
  if(active.has(id)) return;
  const p=read(id); if(!['drafting','references-generating','sample-generating','producing','rendering'].includes(p.state)) return;
  active.add(id);
  void (async()=>{
    try { const run=await pptWorkflow.createRun(); const result=await run.start({inputData:{id}});
      if(result.status==='failed') throw new Error(String(result.error || '制作失败'));
    } catch(error) { const latest=read(id); latest.state='failed'; latest.error=error instanceof Error?error.message:String(error); save(latest); }
    finally { active.delete(id); }
  })();
}
export function recover() { if(process.env.SAAS_MODE==='1' && process.env.PPT_WORKER!=='1')return;for(const project of list()) launch(project.id); }
