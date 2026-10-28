import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findAppRoot(): string {
  if (process.env.STORY_MAKE_HOME) return resolve(process.env.STORY_MAKE_HOME);
  let current = resolve(process.cwd());
  while (true) {
    const packagePath = resolve(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        if (JSON.parse(readFileSync(packagePath, 'utf8')).name === 'story-make') return current;
      } catch { /* Continue toward parent. */ }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Cannot find Story Make root; set STORY_MAKE_HOME');
}

export const appRoot = findAppRoot();
export const runsRoot = resolve(appRoot, 'data/runs');
export const rendererRoot = resolve(
  process.env.STORY_VIDEO_PROJECT || resolve(appRoot, '../../story-to-handdrawn-video'),
);

export function requireRenderer(): string {
  if (!existsSync(resolve(rendererRoot, 'scripts/run_story_video.py'))) {
    throw new Error(`STORY_VIDEO_PROJECT does not point to the renderer: ${rendererRoot}`);
  }
  return rendererRoot;
}
