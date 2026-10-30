import { z } from 'zod';

export const narrativeModeSchema = z.enum(['legal-case', 'childhood-memoir']);
export type NarrativeMode = z.infer<typeof narrativeModeSchema>;

const common = '把用户材料整理为无配音的竖屏视频，按要点组织6至8页，不逐句拆图。只使用提供的材料，不编造事实。每页标题不超过32字，正文不超过105字且必须独立可读，排版最多5行；配图提示词只描述一个可画的瞬间，不包含文字排版或画风要求。每页停留时间按内容估算，单页1至30秒，不要求整条视频达到固定时长。';

export function planningPrompt(mode: NarrativeMode, title: string, source: string): string {
  const direction = mode === 'childhood-memoir'
    ? '口吻：童年回忆录。正文以讲述人“我”的第一人称呈现，按经历的时间和情绪脉络组织，保留具体场景与感受。可以忠实改写、重排和润色，但不得虚构事件、对白、人物或未提供的感受；材料不足时保留留白，不补编。不要使用案件解读、争议、裁判、行动建议或律师口吻。'
    : '口吻：法律案例解读。按问题、经过、争议、结论、行动建议组织；不编造法律依据或案件结论，材料不足时明确表达不确定性。';
  return `${common}\n${direction}\n标题：${title}\n材料：\n${source}`;
}

export function pageLabel(mode: NarrativeMode): string {
  return mode === 'childhood-memoir' ? '童年手记' : '案例笔记';
}
