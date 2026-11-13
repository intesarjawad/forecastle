declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SUBMIT_LIMIT: RateLimit;
    PAGES_URL: string;
    GIT_SHA: string;
    DAILY_STORE_CAP: number;
    EXPORT_TOKEN?: string;
  }

  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
