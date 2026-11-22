import { defineConfig } from "@playwright/test";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://retoma:retoma@localhost:5432/retoma_e2e";
const env = {
  DATABASE_URL: E2E_DB,
  APP_URL: "http://localhost:3100",
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  META_APP_SECRET: "e2e-app-secret",
  META_WEBHOOK_VERIFY_TOKEN: "e2e-verify",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", locale: "pt-BR" },
  webServer: [
    { command: "npx next start -p 3100", url: "http://localhost:3100", env, reuseExistingServer: false, timeout: 120_000 },
    { command: "npx tsx src/worker/index.ts", env, reuseExistingServer: false, wait: { stdout: /worker iniciado/ } },
  ],
});
