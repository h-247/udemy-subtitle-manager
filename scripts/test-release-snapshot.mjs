import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { prepareSnapshot, verifySnapshot } from './prepare-sites-release.mjs';
import { verifyReleaseHealth } from './verify-release-health.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'udemy-release-test-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
try {
  git('init'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Release test'); git('config', 'core.autocrlf', 'false');
  const app = path.join(root, 'chatgpt-sites/udemy-subtitle-manager'); mkdirSync(app, { recursive: true });
  mkdirSync(path.join(app, '.openai'));
  const hosting = JSON.stringify({ d1: 'DB', r2: 'BUCKET', project_id: 'tested-site' });
  writeFileSync(path.join(app, '.openai/hosting.json'), hosting);
  writeFileSync(path.join(app, 'obsolete.ts'), 'old'); git('add', '.'); git('commit', '-m', 'old');
  git('mv', 'chatgpt-sites/udemy-subtitle-manager/obsolete.ts', 'chatgpt-sites/udemy-subtitle-manager/current.ts');
  writeFileSync(path.join(app, 'binary.bin'), Buffer.from([0, 255, 13, 10])); git('add', '.'); git('commit', '-m', 'tested');
  const commit = git('rev-parse', 'HEAD');
  writeFileSync(path.join(app, 'current.ts'), 'uncommitted work must not leak');
  writeFileSync(path.join(app, '.openai/hosting.json'), JSON.stringify({ d1: 'DRIFT', project_id: 'wrong-site' }));
  const parent = path.join(root, 'snapshots');
  const snapshot = prepareSnapshot(root, commit, parent);
  assert.equal(readFileSync(path.join(snapshot, 'current.ts'), 'utf8'), 'old');
  assert.deepEqual(readFileSync(path.join(snapshot, 'binary.bin')), Buffer.from([0, 255, 13, 10]));
  verifySnapshot(snapshot);
  assert.equal(readFileSync(path.join(snapshot, '.openai/hosting.json'), 'utf8'), hosting);
  writeFileSync(path.join(snapshot, 'obsolete.ts'), 'stale'); assert.throws(() => verifySnapshot(snapshot), /obsolete.ts/);
  const fresh = prepareSnapshot(root, commit, parent); assert.notEqual(fresh, snapshot); verifySnapshot(fresh);
  writeFileSync(path.join(fresh, '.openai/hosting.json'), '{}');
  assert.throws(() => verifySnapshot(fresh), /hosting.json/);
  writeFileSync(path.join(fresh, '.openai/hosting.json'), hosting);
  writeFileSync(path.join(fresh, 'current.ts'), 'tampered'); assert.throws(() => verifySnapshot(fresh), /current.ts/);
  let reported = commit;
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok', commit: reported })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await verifyReleaseHealth(origin, commit); reported = 'f'.repeat(40);
    await assert.rejects(verifyReleaseHealth(origin, commit), /provenance/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  git('rm', '-f', 'chatgpt-sites/udemy-subtitle-manager/.openai/hosting.json'); git('commit', '-m', 'missing hosting');
  assert.throws(() => prepareSnapshot(root, git('rev-parse', 'HEAD'), parent), /must track/);
  mkdirSync(path.join(app, '.openai'), { recursive: true });
  writeFileSync(path.join(app, '.openai/hosting.json'), '{"d1":"WRONG","r2":"BUCKET"}');
  git('add', '.'); git('commit', '-m', 'invalid committed hosting');
  assert.throws(() => prepareSnapshot(root, git('rev-parse', 'HEAD'), parent), /tested DB and BUCKET/);
  console.log('PASS: commit-only hosting, working-tree drift isolation, missing/invalid config rejection, binary fidelity, stale/tampered file rejection, deployed provenance match/mismatch');
} finally { rmSync(root, { recursive: true, force: true }); }
