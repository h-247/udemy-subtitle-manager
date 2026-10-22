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
    } else if (route === '/pagination-seed') {
      await runtime.seed();
      await runtime.db.prepare('DELETE FROM courses').run();
      const courses = Array.from({ length: 25 }, (_, index) => {
        const id = 25 - index;
        const archived = index === 24;
        return runtime.db.prepare('INSERT INTO courses(id,user_id,course_id,title,url,instructor,tags_json) VALUES(?,1,?,?,?,?,?)')
          .bind(id, `library-${id}`, archived ? 'Archived React Course' : `Runtime Library Course ${String(index + 1).padStart(2, '0')}`,
            `https://www.udemy.com/course/library-${id}/`, archived ? 'Legacy Instructor' : 'Runtime Instructor', JSON.stringify([archived ? 'legacy' : 'current']));
      });
      await runtime.db.batch(courses);
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
