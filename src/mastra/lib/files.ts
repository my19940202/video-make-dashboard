import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function versionFile(path: string): void {
  if (!existsSync(path)) return;
  const backup = resolve(dirname(path), 'revisions', `${Date.now()}-${path.split('/').pop()}`);
  mkdirSync(dirname(backup), { recursive: true });
  copyFileSync(path, backup);
}

export function recordRevision(runDir: string, stage: string, action: string, feedback?: string): void {
  const path = resolve(runDir, 'revisions/log.jsonl');
  mkdirSync(dirname(path), {recursive: true});
  appendFileSync(path, `${JSON.stringify({at: new Date().toISOString(), stage, action, feedback: feedback || null})}\n`);
}
