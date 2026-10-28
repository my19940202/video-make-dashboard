import { z } from 'zod';

export const sceneSchema = z.object({
  id: z.string().regex(/^\d{2,}$/),
  narration: z.string().min(1),
  direction: z.string().min(1),
  durationSec: z.number().positive().max(30),
});

export const draftSchema = z.object({
  characterLock: z.string().min(1),
  scenes: z.array(sceneSchema).min(1),
});
export type Draft = z.infer<typeof draftSchema>;

export function validateDraft(input: unknown, sourceScenes: Array<{id: string; narration: string}>): Draft {
  const draft = draftSchema.parse(input);
  if (draft.scenes.length !== sourceScenes.length) throw new Error('分镜数量与原文拆分结果不一致');
  sourceScenes.forEach((source, index) => {
    const scene = draft.scenes[index];
    if (scene.id !== source.id || scene.narration !== source.narration) {
      throw new Error(`分镜 ${index + 1} 的 ID 或原文被更改；请只编辑视觉方向和时长`);
    }
  });
  return draft;
}

export function visualPlan(draft: Draft): Record<string, string> {
  return Object.fromEntries(draft.scenes.map(scene => [scene.id, scene.direction]));
}
