import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { storyMakeAgent } from './agents/story-make-agent';
import { storyboardAgent } from './agents/storyboard-agent';
import { listStoryRunsTool, pauseStoryTool, startStoryTool, unpauseStoryTool } from './tools/story-tools';
import { storyMakeWorkflow } from './workflows/story-make-workflow';
import { appRoot } from './lib/config';
import { pptRoutes } from './ppt/routes';
import { pptWorkflow, recover } from './ppt/workflow';
import { artifactRoute } from './artifact-route';

mkdirSync(resolve(appRoot, 'data'), {recursive: true});

export const mastra = new Mastra({
  agents: {storyMakeAgent, storyboardAgent},
  tools: {startStoryTool, pauseStoryTool, unpauseStoryTool, listStoryRunsTool},
  workflows: {storyMakeWorkflow, pptWorkflow},
  storage: new LibSQLStore({id: 'story-make-storage', url: `file:${resolve(appRoot, 'data/story-make.db')}`}),
  server: {host: '0.0.0.0', port: Number(process.env.PORT || 4112), apiRoutes: [artifactRoute, ...pptRoutes]},
});

setTimeout(recover, 1500).unref();
