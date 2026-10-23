import assert from 'node:assert/strict';
import { buildExpiredCookieText, isScheduledDispatcherEvidence, resolveImportedCourseId } from './hosted-acceptance-helpers.mjs';

const expired = buildExpiredCookieText('https://spouseworks.udemy.com/course/sample/');
assert.match(expired, /^# Netscape HTTP Cookie File\n/);
assert.match(expired, /#HttpOnly_\.spouseworks\.udemy\.com\tTRUE\t\/\tTRUE\t1\tsession\tcodex-hosted-expired-session\n$/);
assert.throws(() => buildExpiredCookieText('https://example.com/course/sample/'), /must use a udemy\.com host/);
assert.equal(resolveImportedCourseId({course_id: 7}, 3), 7);
assert.equal(resolveImportedCourseId({course_id: null}, 3), 3);
assert.equal(resolveImportedCourseId({course_id: null}, null), null);
const run = { event:'schedule', status:'completed', conclusion:'success', head_sha:'abc', created_at:'2026-10-23T03:00:00Z' };
const dispatchJob = { name:'dispatch', status:'completed', conclusion:'success', started_at:'2026-10-23T03:00:02Z', completed_at:'2026-10-23T03:00:20Z' };
assert.equal(isScheduledDispatcherEvidence(run, dispatchJob, '2026-10-23T03:00:10Z', 'abc', Date.parse('2026-10-23T02:59:00Z')), true);
assert.equal(isScheduledDispatcherEvidence({...run,event:'workflow_dispatch'}, dispatchJob, '2026-10-23T03:00:10Z', 'abc', Date.parse('2026-10-23T02:59:00Z')), false);
assert.equal(isScheduledDispatcherEvidence(run, dispatchJob, '2026-10-23T03:01:00Z', 'abc', Date.parse('2026-10-23T02:59:00Z')), false);
assert.equal(isScheduledDispatcherEvidence(run, dispatchJob, '2026-10-23T03:00:10Z', 'other', Date.parse('2026-10-23T02:59:00Z')), false);
console.log('Hosted acceptance expired-session fixture passed.');
