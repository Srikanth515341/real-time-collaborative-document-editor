import { defineConfig, devices } from '@playwright/test';

// Runs against a full stack (postgres + server + client) that must already
// be up -- locally via `docker compose up`, in CI via the e2e job in
// .github/workflows/ci.yml. This config doesn't auto-start anything itself,
// since the app it drives is a multi-service stack, not a single dev server.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
