/**
 * Executor de migrations versionadas. Aplica, em ordem, os arquivos db/migrations/*.sql ainda não
 * aplicados, cada um em sua própria transação, registrando-os em schema_migrations.
 * Uso: npm run db:migrate  (usa DATABASE_URL; aceita a URL como 1º argumento)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadEnvFile } from "node:process";

export async function migrate(databaseUrl: string, log = console.log) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const dir = path.join(__dirname, "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        log(`aplicada: ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`falha em ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  try { loadEnvFile(); } catch { /* sem .env: usa variáveis do ambiente */ }
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL não definido"); process.exit(1); }
  migrate(url).then(() => console.log("migrations ok")).catch((e) => { console.error(e.message); process.exit(1); });
}
