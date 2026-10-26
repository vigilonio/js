import { defineConfig, devices } from "@playwright/test";

// The keepalive transport test (transport/keepalive.spec.ts). It loads the
// built script-tag bundle, so run `pnpm build` first.
export default defineConfig({
  testDir: "transport",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
