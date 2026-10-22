export function buildExpiredCookieText(courseUrl) {
  const host = new URL(courseUrl).hostname.toLowerCase();
  if (!(host === 'udemy.com' || host.endsWith('.udemy.com'))) throw new Error('The acceptance course URL must use a udemy.com host.');
  return `# Netscape HTTP Cookie File\n#HttpOnly_.${host}\tTRUE\t/\tTRUE\t1\tsession\tcodex-hosted-expired-session\n`;
}
