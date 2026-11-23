/**
 * Preparação local em um comando: cria o .env (com segredos gerados), espera o banco e aplica as migrações.
 *   npm run setup
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { loadEnvFile } from "node:process";
import { Client } from "pg";

async function main() {
  if (!existsSync(".env")) {
    let env = readFileSync(".env.example", "utf8");
    const set = (k: string, v: string) => { env = env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`); };
    set("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    set("META_APP_SECRET", `dev-${randomBytes(12).toString("hex")}`);
    set("META_WEBHOOK_VERIFY_TOKEN", `dev-${randomBytes(12).toString("hex")}`);
    writeFileSync(".env", env);
    console.log("✓ .env criado com segredos de desenvolvimento.");
  } else console.log("✓ .env já existe (mantido).");
  loadEnvFile();
  const url = process.env.DATABASE_URL!;
  process.stdout.write("… aguardando o banco");
  for (let i = 0; i < 40; i++) {
    const c = new Client({ connectionString: url });
    try { await c.connect(); await c.end(); console.log("\n✓ banco acessível."); break; }
    catch { await c.end().catch(() => {}); if (i === 39) { console.error(`\n✗ não consegui conectar em ${url.replace(/:[^:@/]+@/, ":***@")}. O banco está rodando? (docker compose up -d)`); process.exit(1); } process.stdout.write("."); await new Promise((r) => setTimeout(r, 1500)); }
  }
  const { migrate } = await import("../db/migrate");
  await migrate(url, (m) => console.log(`  ${m}`));
  console.log("✓ migrações aplicadas.\n\nPronto! Rode:  npm run dev:all   e abra http://localhost:3000");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
