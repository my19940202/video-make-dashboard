import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const output = join(mkdtempSync(join(tmpdir(), 'story-make-test-')), 'modules');
await Promise.all(['story', 'gates', 'files', 'image-worker'].map(name => build({
  entryPoints: [`src/mastra/lib/${name}.ts`], bundle: true, platform: 'node',
  format: 'esm', outfile: `${output}-${name}.mjs`,
})));
const { validateDraft } = await import(pathToFileURL(`${output}-story.mjs`).href);
const { requireSceneApprovals, requirePreviewApproval } = await import(pathToFileURL(`${output}-gates.mjs`).href);
const { versionFile, recordRevision } = await import(pathToFileURL(`${output}-files.mjs`).href);
const { paused } = await import(pathToFileURL(`${output}-image-worker.mjs`).href);

test('manual draft can change visuals but cannot silently alter original narration', () => {
  const source = [{id: '01', narration: '小猫坐在窗边。'}];
  const draft = {characterLock: '灰色小猫，白色爪子', scenes: [{id: '01', narration: source[0].narration, direction: '小猫望着窗外', durationSec: 4.4}]};
  assert.deepEqual(validateDraft(draft, source), draft);
  assert.throws(() => validateDraft({...draft, scenes: [{...draft.scenes[0], narration: '改了原文。'}]}, source), /原文被更改/);
  assert.throws(() => validateDraft({...draft, scenes: []}, source));
});

test('render gates refuse missing scene and preview approvals', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'story-make-run-'));
  assert.throws(() => requireSceneApprovals([{runDir, sceneId: '01'}]), /未通过审核/);
  mkdirSync(join(runDir, 'approvals'));
  writeFileSync(join(runDir, 'approvals/01.json'), '{}');
  assert.equal(requireSceneApprovals([{runDir, sceneId: '01'}]), runDir);
  assert.throws(() => requirePreviewApproval(runDir), /预览尚未批准/);
  writeFileSync(join(runDir, 'preview-approved.json'), '{}');
  assert.doesNotThrow(() => requirePreviewApproval(runDir));
});


test('pause flag stops new image dispatch without removing completed files', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'story-make-pause-'));
  const image = join(runDir, 'finished.png');
  writeFileSync(image, 'completed image');
  assert.equal(paused(runDir), false);
  writeFileSync(join(runDir, 'pause.flag'), 'now');
  assert.equal(paused(runDir), true);
  assert.equal(readFileSync(image, 'utf8'), 'completed image');
});

test('revisions retain the previous file and record the reason', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'story-make-revision-'));
  const draft = join(runDir, 'draft.json');
  writeFileSync(draft, '{"version":1}');
  versionFile(draft);
  writeFileSync(draft, '{"version":2}');
  recordRevision(runDir, 'storyboard', 'replace', '视觉方向调整');
  const revisions = join(runDir, 'revisions');
  const { readdirSync } = await import('node:fs');
  const saved = readdirSync(revisions).find(name => name.endsWith('draft.json'));
  assert.ok(saved);
  assert.equal(readFileSync(join(revisions, saved), 'utf8'), '{"version":1}');
  assert.match(readFileSync(join(revisions, 'log.jsonl'), 'utf8'), /视觉方向调整/);
});
