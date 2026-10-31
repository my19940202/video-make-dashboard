import { z } from 'zod';

export const narrativeModeSchema = z.enum(['legal-case', 'childhood-memoir']);
export type NarrativeMode = z.infer<typeof narrativeModeSchema>;

const common = '把用户材料整理为无配音的竖屏视频，按要点组织6至8页，不逐句拆图。只使用提供的材料，不编造事实。每页标题不超过32字，正文不超过105字且必须独立可读，排版最多5行；配图提示词只描述一个可画的瞬间，不包含文字排版或画风要求。每页停留时间按内容估算，单页1至30秒，不要求整条视频达到固定时长。';
const legal = '口吻：法律案例解读，专业准确但接地气。像向普通人解释一件事那样说清“发生了什么、为什么会这样判断、这对当事人意味着什么”，用日常词语解释必要的法律概念，不堆法条、不用训诫或保证结果的语气。按6至8页轮播：第1页用问句作封面；中间页面每页只讲一个事实、争点或简短原因；倒数第2页给出结论，材料没有明确结论时写“仅凭现有材料无法判断”并说明还缺什么；最后1页是小程序提问引导。每页标题应能在两行内读完，尽量不超过12个汉字；正文最多两句、42字，不能塞整段判决理由。事实与原因太长就拆页。配图只描述一个无文字的可画瞬间，画面为3:4竖图。不编造法律依据、案情或裁判结果。';

export function planningPrompt(mode: NarrativeMode, title: string, source: string): string {
  const direction = mode === 'childhood-memoir'
    ? '口吻：童年回忆录。正文以讲述人“我”的第一人称呈现，按经历的时间和情绪脉络组织，保留具体场景与感受。可以忠实改写、重排和润色，但不得虚构事件、对白、人物或未提供的感受；材料不足时保留留白，不补编。不要使用案件解读、争议、裁判、行动建议或律师口吻。'
    : legal;
  return `${mode==='legal-case'?'把用户材料整理为无配音、6至8页的法律案例轮播视频。每页停留1至30秒。':common}\n${direction}\n标题：${title}\n材料：\n${source}`;
}

export function pageLabel(mode: NarrativeMode): string {
  return mode === 'childhood-memoir' ? '童年手记' : '案例笔记';
}
