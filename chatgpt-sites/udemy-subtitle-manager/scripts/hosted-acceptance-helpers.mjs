export function buildExpiredCookieText(courseUrl) {
  const host = new URL(courseUrl).hostname.toLowerCase();
  if (!(host === 'udemy.com' || host.endsWith('.udemy.com'))) throw new Error('The acceptance course URL must use a udemy.com host.');
  return `# Netscape HTTP Cookie File\n#HttpOnly_.${host}\tTRUE\t/\tTRUE\t1\tsession\tcodex-hosted-expired-session\n`;
}

export function resolveImportedCourseId(job, matchedCourseId = null) {
  const jobCourseId = Number(job?.course_id);
  if (Number.isSafeInteger(jobCourseId) && jobCourseId > 0) return jobCourseId;
  const matchedId = Number(matchedCourseId);
  return Number.isSafeInteger(matchedId) && matchedId > 0 ? matchedId : null;
}

export function isScheduledDispatcherEvidence(run, dispatchJob, dispatcherStartedAt, expectedCommit, after) {
  if (run?.event !== 'schedule' || run?.status !== 'completed' || run?.conclusion !== 'success') return false;
  if (expectedCommit && run?.head_sha !== expectedCommit) return false;
  if (dispatchJob?.name !== 'dispatch' || dispatchJob?.status !== 'completed' || dispatchJob?.conclusion !== 'success') return false;
  const createdAt = Date.parse(run?.created_at || '');
  const startedAt = Date.parse(dispatchJob?.started_at || '');
  const completedAt = Date.parse(dispatchJob?.completed_at || '');
  const dispatcherAt = Date.parse(dispatcherStartedAt || '');
  return [createdAt, startedAt, completedAt, dispatcherAt, after].every(Number.isFinite)
    && createdAt > after
    && startedAt <= dispatcherAt + 5_000
    && completedAt + 30_000 >= dispatcherAt;
}
