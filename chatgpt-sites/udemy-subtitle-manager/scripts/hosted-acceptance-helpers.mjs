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
