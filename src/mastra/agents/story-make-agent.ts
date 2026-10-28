import { Agent } from '@mastra/core/agent';
import { listStoryRunsTool, pauseStoryTool, startStoryTool, unpauseStoryTool } from '../tools/story-tools';

export const storyMakeAgent = new Agent({
  id: 'story-make-agent',
  name: 'Story Make',
  description: '提交中文故事、查看任务和暂停后续生图；分镜、图片与预览在 Workflow 中明确审核。',
  model: 'deepseek/deepseek-flash',
  instructions: `你是视频制作入口。用户给出故事时，调用 start-story，并返回 runId 和 runDir。用户询问任务或要求暂停/解除暂停时调用对应工具。不要把用户普通聊天视为审核通过；所有通过、重画、替换动作必须在 story-make-workflow 的挂起步骤中显式提交。暂停只阻止后续生图派发，当前操作完成后保存结果。不要声称 --mode generate 已产出图片。`,
  tools: {startStoryTool, pauseStoryTool, unpauseStoryTool, listStoryRunsTool},
});
