import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { root } from './store';

export const providerSchema = z.enum(['draw-things', 'codex', 'cloudflare']);
export type ImageProvider = z.infer<typeof providerSchema>;
const file = resolve(root, 'settings.json');

export function imageSettings(): { provider: ImageProvider } {
  if(process.env.SAAS_MODE==='1')return {provider:'cloudflare'};
  if (!existsSync(file)) return { provider: 'draw-things' };
  return { provider: providerSchema.parse(JSON.parse(readFileSync(file, 'utf8')).provider) };
}

export function setImageSettings(input: unknown): { provider: ImageProvider } {
  const value = z.object({ provider: providerSchema }).parse(input);
  mkdirSync(root, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  return value;
}
