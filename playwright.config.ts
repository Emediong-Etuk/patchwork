import { defineConfig } from "@playwright/test";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/patchwork_test?schema=public";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: "http://localhost:3100", trace: "off" },
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    // Requires `npm run build` first.
    command: "npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: TEST_DB,
      SWITCH_MODE: "simulator",
      ANTHROPIC_API_KEY: "",
      PATCHWORK_ACCESS_CODE: "e2e-access",
      PATCHWORK_WORKSPACES_DIR: "tests/.tmp/e2e-workspaces",
    },
  },
});
