import { defineConfig, devices } from "@playwright/test";

const mobileChromium = {
  browserName: "chromium",
  viewport: { width: 390, height: 844 },
  hasTouch: true,
} as const;

const port = Number(process.env.FORECASTLE_PORT ?? "43873");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("FORECASTLE_PORT must be an integer from 1 to 65535.");
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./site/tests/e2e",
  use: { baseURL },
  projects: [
    { name: "mobile-chromium", use: mobileChromium },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    { name: "reduced-motion", use: { ...mobileChromium, reducedMotion: "reduce" } },
  ],
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: `npm run build && npm run preview -w site -- --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
        },
      }),
});
