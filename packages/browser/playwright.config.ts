import { defineConfig, devices } from "@playwright/test";

// Real-browser tests: the keepalive transport (transport/keepalive.spec.ts)
// and automatic breadcrumbs (transport/breadcrumbs.spec.ts). They load the
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
