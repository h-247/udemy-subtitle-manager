import assert from 'node:assert/strict';
import { createRuntime, caption } from './harness.mjs';
import { setTimeout } from 'node:timers/promises';

const runtime = await createRuntime();
try {
  await runtime.seed();
  const missingHeartbeat = await (await runtime.request('/api/health')).json();
  assert.equal(missingHeartbeat.status,'degraded');
  assert.equal(missingHeartbeat.dispatcher.status,'NEVER_RUN');
  assert.equal(missingHeartbeat.dispatcher.stale,true);
  assert.match(missingHeartbeat.dispatcher.stale_reason,/No valid dispatcher heartbeat/);
  await runtime.reconnect();
  runtime.expireSession(true);
  const imported = await runtime.request('/api/courses/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.udemy.com/course/browser-import/', tags: ['recovery'] }) });
  assert.equal(imported.status, 202, await imported.clone().text());
  let importedJob;
  for (let i = 0; i < 12; i++) {
    await runtime.dispatch();
    importedJob = await runtime.db.prepare('SELECT * FROM processing_jobs ORDER BY id DESC LIMIT 1').first();
    if (importedJob.status === 'WAITING_SESSION') break;
    await setTimeout(100);
  }
  assert.equal(importedJob.job_type, 'SUBTITLE_BATCH');
  assert.equal(importedJob.status, 'WAITING_SESSION');
  const checkpoint = importedJob.payload_json;
  await runtime.restart();
  assert.equal((await runtime.db.prepare('SELECT payload_json FROM processing_jobs WHERE id=?').bind(importedJob.id).first()).payload_json, checkpoint);
  runtime.expireSession(false); await runtime.reconnect();
  for (let i = 0; i < 30; i++) {
    await runtime.dispatch();
    if ((await runtime.db.prepare('SELECT status FROM processing_jobs WHERE id=?').bind(importedJob.id).first()).status === 'COMPLETED') break;
    await setTimeout(100);
  }
  assert.equal((await runtime.db.prepare('SELECT status FROM processing_jobs WHERE id=?').bind(importedJob.id).first()).status, 'COMPLETED');
  assert.equal(runtime.counters.downloads, 1);
  assert.equal((await runtime.db.prepare('SELECT COUNT(*) AS n FROM lectures WHERE lecture_id=?').bind('9001').first()).n, 1);
  console.log('PASS: import API, curriculum, automatic subtitles, expired session, persisted restart checkpoint, cookie reconnection');
  await runtime.seed(); await runtime.queue();
  // Hold an actual outgoing HTTP request while a competing dispatcher runs.
  const started = runtime.holdCaption();
  const first = runtime.dispatch();
  await started;
  await runtime.dispatch();
  assert.equal(runtime.counters.downloads, 1);
  runtime.releaseCaption(); await first;
  let subtitle = await runtime.db.prepare('SELECT * FROM subtitles').first();
  assert.equal(subtitle.status, 'COMPLETED');
  const downloaded = await runtime.request(`/api/subtitles/${subtitle.id}/content`);
  assert.equal(downloaded.status, 200); assert.equal(await downloaded.text(), caption);
  const key = subtitle.storage_key;
  await runtime.db.prepare(`UPDATE processing_jobs SET status='PROCESSING',completed_items=0,payload_json='{"lecture_ids":[1],"cursor":0}';`).run();
  await runtime.db.prepare("INSERT INTO job_leases VALUES(1,'crashed',unixepoch()-1)").run();
  await runtime.restart(); await runtime.dispatch();
  assert.equal(runtime.counters.downloads, 1, 'Restart reuses persisted R2 caption');
  assert.equal((await runtime.db.prepare('SELECT storage_key FROM subtitles').first()).storage_key, key);

  await runtime.db.prepare(`UPDATE users SET drive_credentials='{"access_token":"fixture","expires_at":9999999999999}' WHERE id=1`).run();
  const requeue = async () => runtime.db.prepare(`UPDATE processing_jobs SET status='PENDING',retry_at=0,completed_items=0,payload_json='{"lecture_ids":[1],"cursor":0}'`).run();
  await requeue(); runtime.failUpload(true); await runtime.dispatch();
  subtitle = await runtime.db.prepare('SELECT * FROM subtitles').first();
  assert.equal(subtitle.status, 'COMPLETED'); assert.equal(subtitle.drive_status, 'FAILED');
  assert.equal(runtime.counters.uploads, 1);
  runtime.failUpload(false); await runtime.restart(); await requeue(); await runtime.dispatch();
  assert.equal((await runtime.db.prepare('SELECT drive_status FROM subtitles').first()).drive_status, 'COMPLETED');
  assert.equal(runtime.counters.uploads, 1, 'Remote readback prevents a second upload after lost confirmation');
  assert.equal(runtime.counters.downloads, 1, 'Drive-only retry never downloads the caption again');

  const headers = { 'oai-authenticated-user-id': 'runtime-other', 'oai-authenticated-user-email': 'other@example.test' };
  for (const [route, method] of [['/api/courses/1','GET'],['/api/jobs/1','GET'],['/api/jobs/1/retry','POST'],['/api/jobs/1/cancel','POST'],[`/api/subtitles/${subtitle.id}/content`,'GET'],['/api/subtitles/lectures/1/process','POST']]) {
    assert.equal((await runtime.request(route, { method, headers })).status, 404, `${method} ${route} rejects another user`);
  }
  assert.deepEqual(await (await runtime.request('/api/jobs', { headers })).json(), []);
  assert.equal((await runtime.request('/api/internal/jobs/run', { method: 'POST' })).status, 401);
  await runtime.seed(); await runtime.queue();
  const manualWake = await runtime.request('/api/jobs/run', { method:'POST' });
  assert.equal(manualWake.status,200);
  assert.equal((await manualWake.json()).advanced,true,'dashboard recovery action advances the signed-in user job');
  assert.equal((await runtime.db.prepare('SELECT status FROM processing_jobs WHERE id=1').first()).status,'COMPLETED');
  await runtime.seed(); await runtime.queue();
  await runtime.db.prepare("UPDATE processing_jobs SET created_at=datetime('now','-2 hours'),updated_at=datetime('now','-20 minutes') WHERE id=1").run();
  assert.equal((await (await runtime.request('/api/jobs')).json())[0].stalled,true);
  const queueHealth = await (await runtime.request('/api/health')).json();
  assert.equal(queueHealth.status,'degraded');
  assert.equal(queueHealth.queue.stalled_jobs,1);
  assert.equal(queueHealth.queue.overdue_runnable_jobs,1);
  assert.ok(queueHealth.queue.oldest_queued_age_seconds >= 7100);
  await runtime.db.prepare("UPDATE users SET drive_credentials='not-json' WHERE id=1").run();
  const simulatedFailure = await runtime.request('/api/internal/jobs/run', { method:'POST', headers:{Authorization:'Bearer runtime-runner-secret'} });
  assert.equal(simulatedFailure.status,500);
  const failedHealth = await (await runtime.request('/api/health')).json();
  assert.equal(failedHealth.dispatcher.status,'FAILED');
  assert.ok(failedHealth.dispatcher.error);
  await runtime.db.prepare('UPDATE users SET drive_credentials=NULL WHERE id=1').run();
  await runtime.dispatch();
  const recoveredHealth = await (await runtime.request('/api/health')).json();
  assert.equal(recoveredHealth.status,'ok');
  assert.equal(recoveredHealth.dispatcher.status,'SUCCEEDED');
  assert.ok(recoveredHealth.dispatcher.heartbeat_at);
  await runtime.db.prepare("UPDATE dispatcher_status SET heartbeat_at=datetime('now','-20 minutes') WHERE id=1").run();
  const staleSuccess = await (await runtime.request('/api/health')).json();
  assert.equal(staleSuccess.status,'degraded','a stopped dispatcher is detected after a successful run');
  assert.equal(staleSuccess.dispatcher.status,'SUCCEEDED');
  assert.equal(staleSuccess.dispatcher.stale,true);
  assert.match(staleSuccess.dispatcher.stale_reason,/hosted dispatcher may have stopped/);
  await runtime.dispatch();
  assert.equal((await (await runtime.request('/api/health')).json()).status,'ok','a fresh heartbeat clears dispatcher degradation');
  console.log('PASS: workerd/D1/R2 overlapping dispatch, disk restart, expired lease, Drive-only retry, lost upload confirmation, caption reuse, user isolation');
} finally { await runtime.close(); }

