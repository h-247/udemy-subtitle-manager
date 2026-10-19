const origin = process.env.SITE_URL;
if (!origin || !process.env.SITE_SERVICE_TOKEN || !process.env.JOB_RUNNER_SECRET) throw new Error('Missing dispatcher secrets');
const deadline = Date.now() + 240_000;
let total = 0;
do {
  const response = await fetch(`${origin}/api/internal/jobs/run`, {
    method: 'POST',
    headers: {'OAI-Sites-Authorization': `Bearer ${process.env.SITE_SERVICE_TOKEN}`, Authorization: `Bearer ${process.env.JOB_RUNNER_SECRET}`},
    signal: AbortSignal.timeout(110_000),
  });
  if (!response.ok) throw new Error(`Dispatcher HTTP ${response.status}`);
  const result = await response.json();
  total += result.advanced;
  if (!result.advanced) break;
} while (Date.now() < deadline);
console.log(`Advanced ${total} user job steps`);
