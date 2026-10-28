import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { registerApiRoute } from '@mastra/core/server';
import { runsRoot } from './lib/config';
import { readJson } from './lib/files';
import type { Manifest } from './lib/renderer';

export function artifactUrl(runDir: string, asset: string): string {
  return `http://127.0.0.1:${process.env.PORT || 4112}/story-artifacts/${basename(runDir)}/${asset}`;
}

export const artifactRoute = registerApiRoute('/story-artifacts/:taskId/:asset', {
  method: 'GET', requiresAuth: false,
  handler: async c => {
    const {taskId, asset} = c.req.param();
    if (!/^[A-Za-z0-9-]+$/.test(taskId) || !/^(character|scene-\d{2,}|preview|final)$/.test(asset)) {
      return c.json({error: '无效素材标识'}, 400);
    }
    const runDir = resolve(runsRoot, taskId);
    let path: string;
    if (asset === 'preview' || asset === 'final') {
      path = resolve(runDir, 'out', asset === 'preview' ? 'picture_silent-preview.mp4' : 'picture_silent.mp4');
    } else {
      const manifestPath = resolve(runDir, 'codex-image-jobs.json');
      if (!existsSync(manifestPath)) return c.json({error: '生图清单尚未生成'}, 404);
      const manifest = readJson<Manifest>(manifestPath);
      const id = asset === 'character' ? 'character_reference' : asset.slice('scene-'.length);
      const job = manifest.jobs.find(item => item.id === id);
      if (!job) return c.json({error: '素材任务不存在'}, 404);
      path = resolve(job.output_master);
      if (!path.startsWith(`${resolve(runDir, 'public')}/`)) return c.json({error: '素材路径无效'}, 400);
    }
    if (!existsSync(path)) return c.json({error: '素材尚未生成'}, 404);
    const bytes = readFileSync(path);
    const video = path.endsWith('.mp4');
    return new Response(new Uint8Array(bytes), {
      headers: {'Content-Type': video ? 'video/mp4' : 'image/png', 'Cache-Control': 'no-store'},
    });
  },
});
