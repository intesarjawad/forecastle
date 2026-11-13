import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: { DAILY_STORE_CAP: 3, GIT_SHA: "test-sha", EXPORT_TOKEN: "test-token" },
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
