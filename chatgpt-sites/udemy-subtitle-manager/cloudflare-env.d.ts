declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    JOB_RUNNER_SECRET?: string;
  }
}
