import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1100, height: 900 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
