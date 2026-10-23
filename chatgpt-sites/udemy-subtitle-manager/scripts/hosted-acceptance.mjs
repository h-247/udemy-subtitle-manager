import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { buildExpiredCookieText, resolveImportedCourseId } from './hosted-acceptance-helpers.mjs';

const origin = new URL(process.env.SITE_URL).origin;
const required = ['SITE_SERVICE_TOKEN','JOB_RUNNER_SECRET','HOSTED_ACCEPTANCE_SECRET','HOSTED_TEST_UDEMY_COOKIE_TEXT','DRIVE_RETRY_COURSE_ID'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required hosted acceptance secret/input: ${key}`);
const headers = {
  'OAI-Sites-Authorization': `Bearer ${process.env.SITE_SERVICE_TOKEN || ''}`,
  'x-hosted-acceptance-secret': process.env.HOSTED_ACCEPTANCE_SECRET || '',
  'x-job-scheduled-only': process.env.JOB_RUNNER_SECRET || '',
  'Content-Type': 'application/json',
};
const evidence = { site: origin, workflow_run_id: process.env.GITHUB_RUN_ID || null, workflow_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  started_at: new Date().toISOString(), phases: {} };
const expectedCommit = process.env.EXPECTED_COMMIT || '';
let manualDispatchRuns = 0;

async function api(path, init = {}) {
  const { timeoutMs = 30_000, ...requestInit } = init;
  const requestHeaders = { ...headers, ...requestInit.headers };
  if (requestInit.body instanceof FormData) delete requestHeaders['Content-Type'];
  const response = await fetch(new URL(path, origin), { ...requestInit, headers: requestHeaders, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { detail: text.slice(0,300) }; }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function dispatchOnce() {
  const result = await api('/api/internal/jobs/run', { method:'POST', timeoutMs:120_000, headers:{ Authorization:`Bearer ${process.env.JOB_RUNNER_SECRET}` } });
  manualDispatchRuns += 1;
  return result;
}
async function waitForManuallyDispatchedJob(id, predicate, timeoutMs = 35 * 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await dispatchOnce();
    const health = await api('/api/health');
    const job = await api(`/api/jobs/${id}`);
    if (health.dispatcher?.status === 'SUCCEEDED' && predicate(job)) return { job, dispatcher:health.dispatcher };
    if (['FAILED','CANCELLED'].includes(job.status)) throw new Error(`Job ${id} ended as ${job.status}: ${job.error_message || ''}`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error(`Timed out waiting for manual dispatcher processing of job ${id}.`);
}
function cookiesForm(text) {
  const form = new FormData(); form.set('cookie_text', text); return form;
}
function expiredCookieText(courseUrl) {
  const host = new URL(courseUrl).hostname.toLowerCase();
  if (!(host === 'udemy.com' || host.endsWith('.udemy.com'))) throw new Error('The acceptance course URL must use a udemy.com host.');
  return `# Netscape HTTP Cookie File\n#HttpOnly_.${host}\tTRUE\t/\tTRUE\t1\tsession\tcodex-hosted-expired-session\n`;
}
try {
  const health = await api('/api/health');
  assert.equal(health.status, 'ok');
  if (process.env.EXPECTED_COMMIT) assert.equal(health.commit, process.env.EXPECTED_COMMIT, 'hosted commit provenance');
  evidence.commit = health.commit;
  evidence.initial_dispatcher_heartbeat = health.dispatcher?.heartbeat_at || null;

  const activeSession = await api('/api/udemy/cookies', { method:'POST', body:cookiesForm(process.env.HOSTED_TEST_UDEMY_COOKIE_TEXT) });
  assert.equal(activeSession.saved, true);
  assert.equal(activeSession.status, 'CONNECTED', 'the real import must start with a valid Udemy session');
  evidence.phases.active_session_installed = { status:activeSession.status, saved:activeSession.saved };

  // Submit through a real browser and leave it open until the import has persisted real curriculum progress.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();
  await page.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
  const existingLibrary = await api('/api/courses?page=1&page_size=100');
  const normalizedCoursePath = new URL(process.env.COURSE_URL).pathname.replace(/\/+$/, '');
  const existingCourse = existingLibrary.items?.find(course => new URL(course.url).pathname.replace(/\/+$/, '') === normalizedCoursePath);
  const matchedCourseId = existingCourse?.id ?? null;
  const importTags = existingCourse?.tags || [];
  const existingImportJobId = Number(process.env.IMPORT_JOB_ID || 0);
  const imported = existingImportJobId > 0
    ? await api(`/api/jobs/${existingImportJobId}`)
    : await page.evaluate(async ({url,tags}) => {
      const response = await fetch('/api/courses/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url,tags}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
      return body;
    }, {url:process.env.COURSE_URL,tags:importTags});
  assert.equal(imported.job_type, 'COURSE_IMPORT', 'the acceptance must track a course import job');
  if (existingImportJobId > 0) assert.ok(Number(imported.completed_items) > 0, 'an adopted import must already have persisted curriculum progress');
  evidence.phases.browser_enqueued = { job_id: imported.id, status: imported.status, reused_existing_job:existingImportJobId > 0,
    origin_workflow_run_id:process.env.IMPORT_JOB_ORIGIN_RUN_ID || null, reused_existing_course: Boolean(existingCourse), preserved_tags: importTags };
  const initialJob = await api(`/api/jobs/${imported.id}`);

  let progressed;
  const progressDeadline = Date.now() + 35 * 60_000;
  while (Date.now() < progressDeadline) {
    await dispatchOnce();
    const health = await api('/api/health');
    const job = await api(`/api/jobs/${imported.id}`);
    if (['FAILED','CANCELLED'].includes(job.status)) throw new Error(`Job ${imported.id} ended as ${job.status}: ${job.error_message || ''}`);
    const heartbeat = Date.parse(health.dispatcher?.heartbeat_at || '');
    const dispatcherRanAfterEnqueue = Number.isFinite(heartbeat) && heartbeat > Date.parse(initialJob.created_at) && health.dispatcher?.status === 'SUCCEEDED';
    const courseId = resolveImportedCourseId(job, matchedCourseId);
    // An adopted job already has a browser-originated durable checkpoint. A
    // new acceptance-created job must advance after enqueue before the browser
    // is closed; adoption verifies that existing checkpoint and then tests
    // recovery from its saved cursor.
    const checkpointAdvanced = Number(job.completed_items) > 0;
    if (dispatcherRanAfterEnqueue && checkpointAdvanced && courseId) {
      const course = await api(`/api/courses/${courseId}`);
      const lectureCount = (course.sections || []).reduce((total, section) => total + (section.lectures || []).length, 0);
      if (lectureCount > 0) {
        progressed = { job, lecture_count:lectureCount, course_id:courseId, dispatcher:health.dispatcher };
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  assert.ok(progressed, 'the import must persist at least one real lecture before interruption');
  evidence.phases.real_import_progress = { course_id:progressed.course_id, lecture_count:progressed.lecture_count, imported_lecture_count:progressed.job.completed_items,
    job_status:progressed.job.status, progress_message:progressed.job.progress_message, adopted_checkpoint:existingImportJobId > 0,
    checkpoint_created_at:initialJob.created_at, checkpoint_updated_at:progressed.job.updated_at, dispatcher:progressed.dispatcher, dispatch_mode:'manual-acceptance-runner' };

  await context.close(); await browser.close();
  evidence.phases.browser_closed_after_progress = { job_id:imported.id, closed_at:new Date().toISOString() };
  const expiredSession = await api('/api/udemy/cookies', { method:'POST', body:cookiesForm(buildExpiredCookieText(process.env.COURSE_URL)) });
  assert.equal(expiredSession.saved, true);
  assert.equal(expiredSession.status, 'EXPIRED_SESSION', 'the synthetic expired session must be rejected by Udemy validation');
  evidence.phases.expired_test_session_installed = { status:expiredSession.status, saved:expiredSession.saved, source:'synthetic-expired-cookie' };

  const waitingResult = await waitForManuallyDispatchedJob(imported.id, job => job.status === 'WAITING_SESSION');
  const waiting = waitingResult.job;
  const recoveredCourseId = resolveImportedCourseId(waiting, progressed.course_id);
  assert.ok(recoveredCourseId, 'the interrupted import must retain or resolve its course checkpoint');
  evidence.phases.expired_session_after_progress = { status:waiting.status, course_id:recoveredCourseId, completed_items:waiting.completed_items, progress_message:waiting.progress_message, dispatcher:waitingResult.dispatcher };

  const reconnected = await api('/api/udemy/cookies', { method:'POST', body:cookiesForm(process.env.HOSTED_TEST_UDEMY_COOKIE_TEXT) });
  assert.equal(reconnected.saved, true);
  assert.equal(reconnected.status, 'CONNECTED', 'reconnection must restore an active Udemy session');
  evidence.phases.session_reconnected = { status: reconnected.status, saved: reconnected.saved };
  const completedResult = await waitForManuallyDispatchedJob(imported.id, job => job.status === 'COMPLETED');
  const completed = completedResult.job;
  evidence.phases.import_completed = { status: completed.status, completed_items: completed.completed_items, total_items: completed.total_items, course_id: resolveImportedCourseId(completed, recoveredCourseId), dispatcher:completedResult.dispatcher };

  const courseId = Number(process.env.DRIVE_RETRY_COURSE_ID);
  const before = await api(`/api/courses/${courseId}`);
  const failed = before.sections.flatMap(section => section.lectures).flatMap(lecture => lecture.subtitles.map(subtitle => ({lecture,subtitle})))
    .filter(row => row.subtitle.status === 'COMPLETED' && row.subtitle.drive_status === 'FAILED');
  assert.ok(failed.length, `course ${courseId} must have a completed caption with a failed Drive upload before this acceptance run`);
  const snapshot = failed.map(({lecture,subtitle}) => ({lecture_id:lecture.id,subtitle_id:subtitle.id,last_processed_at:subtitle.last_processed_at,drive_file_id:subtitle.drive_file_id}));
  assert.ok(snapshot.every(item => item.drive_file_id), 'each Drive retry must already have a reserved file ID to prove remote upload idempotency');
  const retry = await api('/api/subtitles/process', { method:'POST', body:JSON.stringify({course_id:courseId}) });
  const retryResult = await waitForManuallyDispatchedJob(retry.id, job => job.status === 'COMPLETED');
  const retryDone = retryResult.job;
  const after = await api(`/api/courses/${courseId}`);
  const afterLectures = new Map(after.sections.flatMap(section => section.lectures).map(lecture => [lecture.id,lecture]));
  for (const old of snapshot) {
    const current = afterLectures.get(old.lecture_id).subtitles.find(subtitle => subtitle.id === old.subtitle_id);
    assert.equal(current.drive_status, 'COMPLETED', `subtitle ${old.subtitle_id} Drive retry`);
    assert.equal(current.last_processed_at, old.last_processed_at, `subtitle ${old.subtitle_id} caption was not downloaded again`);
    if (old.drive_file_id) assert.equal(current.drive_file_id, old.drive_file_id, `subtitle ${old.subtitle_id} reuses its reserved Drive id`);
  }
  evidence.phases.drive_only_retry = { job_id:retryDone.id, status:retryDone.status, subtitles:snapshot.map(item=>item.subtitle_id), caption_downloads_repeated:false, reserved_drive_ids_reused:true, dispatcher:retryResult.dispatcher };
  evidence.dispatch_mode = 'manual-acceptance-runner';
  evidence.manual_dispatch_runs = manualDispatchRuns;
  evidence.finished_at = new Date().toISOString();
  await mkdir('artifacts', {recursive:true});
  await writeFile('artifacts/hosted-acceptance.json', JSON.stringify(evidence,null,2)+'\n');
  console.log(`PASS: hosted import, browser closure, expired-session recovery, Drive-only retry; commit ${evidence.commit}`);
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : 'Hosted acceptance failed.';
  evidence.finished_at = new Date().toISOString();
  await mkdir('artifacts', {recursive:true});
  await writeFile('artifacts/hosted-acceptance.json', JSON.stringify(evidence,null,2)+'\n');
  throw error;
}
