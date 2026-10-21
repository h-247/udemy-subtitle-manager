import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = 'chatgpt-sites/udemy-subtitle-manager/';
const manifestName = '.openai/release.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });

export function verifySnapshot(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, manifestName), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || !manifest.files || !Object.keys(manifest.files).length) throw Error('Invalid release manifest');
  const actual = {};
  const walk = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), name + '/');
      else if (!entry.isFile()) throw Error(`Unsupported release entry: ${name}`);
      else if (name !== manifestName) actual[name] = digest(readFileSync(path.join(folder, entry.name)));
    }
  };
  walk(directory);
  for (const name of new Set([...Object.keys(actual), ...Object.keys(manifest.files)])) {
    if (actual[name] !== manifest.files[name]) throw Error(`Unexpected, missing or modified release file: ${name}`);
  }
  return manifest;
}

export function prepareSnapshot(root, commit, parent) {
  // Materialize immutable Git blobs, never working-tree files or an old checkout.
  const entries = git(root, 'ls-tree', '-rz', commit, '--', source).toString('utf8').split('\0').filter(Boolean);
  if (!entries.length) throw Error('Commit has no application source');
  mkdirSync(parent, { recursive: true });
  const destination = mkdtempSync(path.join(parent, commit + '-'));
  const files = {};
  for (const entry of entries) {
    const match = entry.match(/^(\d+) blob ([a-f0-9]+)\t(.+)$/s);
    if (!match || !['100644', '100755'].includes(match[1])) throw Error(`Unsupported Git entry: ${entry}`);
    const name = match[3].slice(source.length);
    if (!name || path.isAbsolute(name) || name === manifestName || name.split(/[\\/]/).some(part => part === '..' || part === '.git')) throw Error(`Reserved release path: ${name}`);
    const bytes = git(root, 'cat-file', 'blob', match[2]);
    const file = path.join(destination, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes, { mode: match[1] === '100755' ? 0o755 : 0o644 });
    files[name] = digest(bytes);
  }
  const bindingConfig = path.join(destination, '.openai/hosting.json');
  if (!files['.openai/hosting.json']) throw Error('Selected commit must track .openai/hosting.json');
  {
    const bindings = JSON.parse(readFileSync(bindingConfig, 'utf8'));
    if (bindings.d1 !== 'DB' || bindings.r2 !== 'BUCKET') throw Error('Sites hosting config must declare the tested DB and BUCKET bindings');
  }
  mkdirSync(path.join(destination, '.openai'), { recursive: true });
  writeFileSync(path.join(destination, manifestName), JSON.stringify({ commit, repository: 'https://github.com/h-247/udemy-subtitle-manager', files }, null, 2) + '\n');
  verifySnapshot(destination);
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--verify') {
    console.log(`Verified release ${verifySnapshot(path.resolve(process.argv[3])).commit}`);
  } else {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (git(root, 'status', '--porcelain').toString().trim()) throw Error('Commit intended changes before preparing a release');
    const commit = git(root, 'rev-parse', 'HEAD').toString().trim();
    const runs = JSON.parse(execFileSync('gh', ['run', 'list', '--commit', commit, '--workflow', 'ci.yml', '--json', 'conclusion,status,event,headSha'], { cwd: root, encoding: 'utf8' }));
    if (!runs.some(run => run.headSha === commit && run.status === 'completed' && run.conclusion === 'success' && run.event === 'push')) throw Error('This commit has no successful push release-check run');
    console.log(prepareSnapshot(root, commit, path.join(root, 'output/sites-releases')));
  }
}
