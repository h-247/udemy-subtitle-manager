// Runs the production bundle in workerd with real, disk-backed D1 and R2.
// Only external Udemy/Drive HTTP responses are fixtures; application imports are untouched.
import { Miniflare } from 'miniflare';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

export const caption = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nRuntime caption\n';
export const identity = { 'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'owner@example.test' };
export async function createRuntime(port = 0) {
  const state = await mkdtemp(path.join(tmpdir(), 'udemy-runtime-'));
  const counters = { downloads: 0, uploads: 0 };
  const files = new Set();
  let failUpload = false, holdCaption = false, releaseCaption, expired = false;
  let captionStarted;
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/expired.vtt') return send({}, 403);
    if (url.pathname.includes('/lectures/')) return send({ asset: { captions: [{ locale_id: 'en_US', url: 'https://captions.example/caption.vtt' }] } }, expired ? 401 : 200);
    if (url.pathname.includes('curriculum-items')) return send({ results: [
      { _class: 'chapter', title: 'Imported section' },
      { _class: 'lecture', id: 9001, title: 'Imported lecture', asset: { asset_type: 'Video', captions: [{ locale_id: 'en_US', url: 'https://captions.example/expired.vtt' }] } },
    ], next: null });
    if (url.pathname.startsWith('/api-2.0/courses/')) return send({ id: 9000, title: 'Imported Course', url: '/course/browser-import/' });
    if (url.pathname.includes('/users/me/')) return send({ title: 'Fixture owner' });
    if (url.pathname === '/caption.vtt') {
      counters.downloads++; captionStarted?.();
      if (holdCaption) await new Promise(resolve => { releaseCaption = resolve; });
      res.end(caption); return;
    }
    if (url.pathname.includes('generateIds')) return send({ ids: ['reserved-runtime-file'] });
    if (url.pathname.includes('/upload/')) {
      counters.uploads++; files.add('reserved-runtime-file');
      // Remote upload succeeded, but its confirmation was lost.
      return send(failUpload ? { error: 'lost confirmation' } : { id: 'reserved-runtime-file' }, failUpload ? 503 : 200);
    }
    if (url.pathname.includes('/files/reserved-runtime-file')) return send({ id: 'reserved-runtime-file' }, files.has('reserved-runtime-file') ? 200 : 404);
    if (url.pathname.endsWith('/files')) return send({ files: [{ id: 'folder' }] });
    send({ error: 'Unexpected external request', path: url.pathname }, 500);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
  const options = {
    modules: (await readdir('dist/server', { recursive: true })).filter(name => /\.m?js$/.test(name))
      .sort((a, b) => Number(b === 'index.js') - Number(a === 'index.js'))
      .map(name => ({ type: 'ESModule', path: path.resolve('dist/server', name) })),
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1', port, cf: false,
    d1Databases: { DB: 'runtime-db' }, d1Persist: path.join(state, 'd1'),
    r2Buckets: { BUCKET: 'runtime-bucket' }, r2Persist: path.join(state, 'r2'),
    assets: { directory: path.resolve('dist/client'), routerConfig: { has_user_worker: true } },
    bindings: { JOB_RUNNER_SECRET: 'runtime-runner-secret', SECRET_KEY: 'fixture-only-secret-with-at-least-32-characters' },
    outboundService: async request => {
      const url = new URL(request.url);
      if (!['captions.example', 'www.googleapis.com', 'www.udemy.com'].includes(url.hostname)) throw Error(`Unexpected outbound host ${url.hostname}`);
      return fetch(fixtureOrigin + url.pathname + url.search, { method: request.method, headers: request.headers, body: request.method === 'GET' ? undefined : await request.arrayBuffer() });
    },
  };
  let mf = new Miniflare(options);
  await mf.ready;
  let database = await mf.getD1Database('DB');
  for (const name of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join('drizzle', name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await database.prepare(statement).run();
  }
  const api = {
    counters,
    get db() { return database; },
    get origin() { return mf.ready.then(url => url.origin); },
    async request(route, init = {}) { return mf.dispatchFetch('http://localhost' + route, { ...init, headers: { ...identity, ...init.headers } }); },
    async dispatch() { const response = await api.request('/api/internal/jobs/run', { method: 'POST', headers: { Authorization: 'Bearer runtime-runner-secret' } }); if (!response.ok) throw Error(`${response.status}: ${await response.text()}`); return response.json(); },
    async seed() {
      files.clear(); counters.downloads = 0; counters.uploads = 0; expired = false; failUpload = false;
      await database.batch(['DELETE FROM job_leases', 'DELETE FROM processing_jobs', 'DELETE FROM subtitles', 'DELETE FROM lectures', 'DELETE FROM sections', 'DELETE FROM courses', 'DELETE FROM udemy_sessions', 'DELETE FROM users'].map(sql => database.prepare(sql)));
      await database.batch([
        "INSERT INTO users(id,platform_user_id,email) VALUES(1,'runtime-owner','owner@example.test'),(2,'runtime-other','other@example.test')",
        "INSERT INTO courses(id,user_id,course_id,title,url) VALUES(1,1,'runtime','Runtime Course','https://www.udemy.com/course/runtime/')",
        "INSERT INTO sections(id,course_id,title,position) VALUES(1,1,'Runtime Section',1)",
        `INSERT INTO lectures(id,section_id,lecture_id,title,url,captions_json) VALUES(1,1,'runtime-lecture','Runtime Lecture','https://www.udemy.com/course/runtime/','[{"locale_id":"en_US","url":"https://captions.example/caption.vtt"}]')`,
      ].map(sql => database.prepare(sql)));
    },
    async seedSubtitle() {
      const bucket = await mf.getR2Bucket('BUCKET');
      const key = '1/runtime/runtime-lecture/en.vtt';
      await bucket.put(key, caption, { httpMetadata: { contentType: 'text/vtt; charset=utf-8' } });
      await database.prepare(`INSERT INTO subtitles(id,lecture_id,language,caption_language,subtitle_type,status,storage_key) VALUES(1,1,'en','en_US','MANUAL','COMPLETED',?)`).bind(key).run();
    },
    async queue() { await database.prepare(`INSERT INTO processing_jobs(id,user_id,course_id,job_type,total_items,payload_json) VALUES(1,1,1,'SUBTITLE_BATCH',1,'{"lecture_ids":[1],"language":"en","cursor":0}')`).run(); },
    async restart() { await mf.dispose(); mf = new Miniflare(options); await mf.ready; database = await mf.getD1Database('DB'); },
    failUpload(value) { failUpload = value; },
    expireSession(value) { expired = value; },
    async reconnect() {
      const form = new URLSearchParams(); form.set('cookie_text', JSON.stringify([{ domain: '.udemy.com', name: 'access_token', value: 'fixture' }]));
      const response = await api.request('/api/udemy/cookies', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      if (!response.ok) throw Error(await response.text());
    },
    async holdCaption() { holdCaption = true; return new Promise(resolve => { captionStarted = resolve; }); },
    releaseCaption() { holdCaption = false; releaseCaption?.(); },
    async close() { releaseCaption?.(); await mf.dispose(); await new Promise(resolve => fixture.close(resolve)); await rm(state, { recursive: true, force: true }); },
  };
  return api;
}
