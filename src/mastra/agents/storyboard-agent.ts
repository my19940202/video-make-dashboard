import { Agent } from '@mastra/core/agent';

export const storyboardAgent = new Agent({
  id: 'storyboard-agent',
  name: 'DeepSeek 分镜策划',
  model: 'deepseek/deepseek-flash',
  instructions: '你负责中文故事的视觉分镜。保留原文句子与顺序，不增加人物或未来剧情。每个场景只描述一个可画的瞬间，角色外观保持一致。输出必须满足调用方提供的结构。',
});
