import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

const PORT = Number(process.env.E2E_PORT ?? 8199);
// Use a pre-installed Chromium when the bundled one is not available (e.g. CI containers).
const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node dist/server/server.cjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), GAMEU_DATA_DIR: '.cache/e2e-data', LOG_LEVEL: 'warn', GAMEU_RECONNECT_GRACE_MS: '1000' },
    timeout: 20_000,
  },
});
