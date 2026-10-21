import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function verifyReleaseHealth(origin, commit, token = process.env.SITE_SERVICE_TOKEN) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Expected a full tested Git commit');
  const response = await fetch(new URL('/api/health', origin), {
    redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw Error(`Health verification failed: HTTP ${response.status}`);
  const health = await response.json();
  if (health.status !== 'ok' || health.commit !== commit) throw Error(`Deployed provenance does not match tested commit ${commit}`);
  return health;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyReleaseHealth(process.argv[2], process.argv[3]);
  console.log(`PASS: deployed /api/health matches ${process.argv[3]}`);
}
