import assert from 'node:assert/strict';
import { buildExpiredCookieText, resolveImportedCourseId } from './hosted-acceptance-helpers.mjs';

const expired = buildExpiredCookieText('https://spouseworks.udemy.com/course/sample/');
assert.match(expired, /^# Netscape HTTP Cookie File\n/);
assert.match(expired, /#HttpOnly_\.spouseworks\.udemy\.com\tTRUE\t\/\tTRUE\t1\tsession\tcodex-hosted-expired-session\n$/);
assert.throws(() => buildExpiredCookieText('https://example.com/course/sample/'), /must use a udemy\.com host/);
assert.equal(resolveImportedCourseId({course_id: 7}, 3), 7);
assert.equal(resolveImportedCourseId({course_id: null}, 3), 3);
assert.equal(resolveImportedCourseId({course_id: null}, null), null);
console.log('Hosted acceptance expired-session fixture passed.');
