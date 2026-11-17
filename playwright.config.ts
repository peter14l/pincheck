import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = "file:./test.db";
const port = 3100;
// Use localhost (not 127.0.0.1): Next's dev server blocks 127.0.0.1 resources and hydration breaks.
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Prepares test.db first, then starts Next on an isolated port.
    command: "npm run dev:test",
    url: baseURL,
    // Never attach to a developer server: its database is dev.db.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
    },
  },
});
