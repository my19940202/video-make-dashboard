import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function requireSceneApprovals(scenes: Array<{runDir: string; sceneId: string}>): string {
  if (!scenes.length) throw new Error('没有通过审核的场景');
  const runDir = scenes[0].runDir;
  for (const scene of scenes) {
    if (scene.runDir !== runDir) throw new Error('场景来自不同任务');
    if (!existsSync(resolve(runDir, 'approvals', `${scene.sceneId}.json`))) {
      throw new Error(`场景 ${scene.sceneId} 未通过审核`);
    }
  }
  return runDir;
}

export function requirePreviewApproval(runDir: string): void {
  if (!existsSync(resolve(runDir, 'preview-approved.json'))) throw new Error('预览尚未批准');
}
