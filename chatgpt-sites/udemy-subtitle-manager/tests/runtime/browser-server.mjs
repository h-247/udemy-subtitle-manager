import { createServer } from 'node:http';
import { createRuntime, caption } from './harness.mjs';

const runtime = await createRuntime(Number(process.env.E2E_PORT || 18787));
await runtime.seed();
// Test controls live in this Node process, never in the application Worker.
const controls = createServer(async (req, res) => {
  try {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/reset') {
      await runtime.seed();
      await runtime.db.prepare("DELETE FROM sqlite_sequence WHERE name='subtitles'").run();
      await runtime.seedSubtitle();
      // Hold background advancement so browser assertions observe stable checkpoints.
      await runtime.db.prepare("INSERT INTO job_leases VALUES(1,'browser-checkpoint',unixepoch()+3600)").run();
    } else if (route === '/workflow') {
      await runtime.seed();
      await runtime.reconnect();
      runtime.expireSession(true);
    } else if (route === '/restart') {
      await runtime.restart();
    } else if (route === '/reconnect') {
      runtime.expireSession(false); await runtime.reconnect();
    } else if (route === '/dispatch') {
      await runtime.dispatch();
    } else if (route === '/counters') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(runtime.counters)); return;
    } else if (route === '/drive-failure') {
      await runtime.db.prepare(`UPDATE users SET drive_credentials='{"access_token":"fixture","expires_at":9999999999999}' WHERE id=1`).run();
      runtime.failUpload(true);
    } else if (route === '/drive-recovered') {
      runtime.failUpload(false);
    } else if (route === '/subtitle-state') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await runtime.db.prepare('SELECT * FROM subtitles ORDER BY id DESC LIMIT 1').first())); return;
    } else if (route === '/progress') {
      await runtime.db.prepare("UPDATE processing_jobs SET status='PROCESSING',total_items=10,completed_items=4,progress_message='Reading curriculum page 2'").run();
    } else if (route === '/fail') {
      await runtime.db.prepare("UPDATE processing_jobs SET status='FAILED',error_message='Fixture network interruption',progress_message='Import interrupted'").run();
    } else if (route === '/state') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await runtime.db.prepare('SELECT * FROM processing_jobs ORDER BY id DESC LIMIT 1').first())); return;
    } else { res.writeHead(404); res.end(); return; }
    res.end('ok');
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => controls.listen(Number(process.env.E2E_CONTROL_PORT || 18788), '127.0.0.1', resolve));
console.log(`Browser Worker ready at ${await runtime.origin}`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await runtime.close(); controls.close(); process.exit(); });
