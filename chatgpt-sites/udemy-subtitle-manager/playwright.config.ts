import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.E2E_PORT || 18787}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node tests/runtime/browser-server.mjs",
    url: `http://127.0.0.1:${process.env.E2E_PORT || 18787}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
