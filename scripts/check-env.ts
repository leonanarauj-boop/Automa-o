/**
 * Confere a configuração de um ambiente ANTES de publicar. Nunca imprime valores secretos.
 *   npm run check:env                 (usa o .env / variáveis do ambiente)
 *   npm run check:env -- --production (exige tudo o que é necessário para clientes reais)
 * Sai com código 1 se houver erro bloqueante.
 */
import { loadEnvFile } from "node:process";
import { readdirSync } from "node:fs";
import path from "node:path";
try { loadEnvFile(); } catch { /* variáveis do ambiente */ }

type Level = "ok" | "warn" | "error";
const results: { area: string; level: Level; msg: string }[] = [];
const add = (area: string, level: Level, msg: string) => results.push({ area, level, msg });
const production = process.argv.includes("--production");
const e = process.env;

async function main() {
  // --- Aplicação ---
  const appUrl = e.APP_URL ?? "";
  if (!appUrl) add("Aplicação", "error", "APP_URL não definido (usado em links de convite, senha e webhooks).");
  else if (production && !appUrl.startsWith("https://")) add("Aplicação", "error", "APP_URL precisa ser https em produção.");
  else add("Aplicação", "ok", `APP_URL = ${appUrl}`);

  const key = Buffer.from(e.ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) add("Criptografia", "error", "ENCRYPTION_KEY precisa ter 32 bytes em base64 (gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").");
  else add("Criptografia", "ok", "ENCRYPTION_KEY válida. Guarde uma cópia segura: sem ela, tokens salvos não podem ser lidos.");

  // --- Banco ---
  if (!e.DATABASE_URL) add("Banco", "error", "DATABASE_URL não definido.");
  else {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: e.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    try {
      await c.connect();
      const v = (await c.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v;
      add("Banco", Number(v.split(".")[0]) >= 15 ? "ok" : "warn", `Conectado (PostgreSQL ${v}).`);
      const files = readdirSync(path.join(__dirname, "..", "db", "migrations")).filter((f) => f.endsWith(".sql"));
      const applied = await c.query<{ name: string }>("select name from schema_migrations").then((r) => new Set(r.rows.map((x) => x.name))).catch(() => new Set<string>());
      const pending = files.filter((f) => !applied.has(f));
      add("Banco", pending.length ? "error" : "ok", pending.length ? `Migrações pendentes: ${pending.join(", ")} (rode npm run db:migrate com a URL direta).` : `Todas as ${files.length} migrações aplicadas.`);
      const role = await c.query("select 1 from pg_roles where rolname = 'app_user' and not rolbypassrls");
      add("Banco", role.rowCount ? "ok" : "error", role.rowCount ? "Papel app_user (sujeito a RLS) existe." : "Papel app_user ausente: o isolamento entre empresas não funcionaria.");
      const ext = (await c.query<{ extname: string }>("select extname from pg_extension")).rows.map((r) => r.extname);
      for (const x of ["pgcrypto", "btree_gist", "unaccent"]) if (!ext.includes(x)) add("Banco", "error", `Extensão ${x} não instalada.`);
      const admins = await c.query<{ n: string }>("select count(*) n from platform_admins").catch(() => ({ rows: [{ n: "0" }] }));
      add("Banco", Number(admins.rows[0].n) ? "ok" : "warn", Number(admins.rows[0].n) ? `${admins.rows[0].n} administrador(es) da plataforma.` : "Nenhum administrador da plataforma (npm run admin:grant -- email).");
      const hb = await c.query<{ age: number | null }>("select extract(epoch from now() - max(last_seen_at))::int age from worker_heartbeats").catch(() => ({ rows: [{ age: null }] }));
      const age = hb.rows[0].age;
      add("Worker", age !== null && age < 120 ? "ok" : production ? "error" : "warn", age === null ? "Nenhum worker conectou a este banco ainda." : age < 120 ? `Worker ativo (último sinal há ${age}s).` : `Worker sem sinal há ${age}s.`);
    } catch (err) {
      add("Banco", "error", `Não foi possível conectar: ${(err as Error).message}`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  const poolMax = Number(e.DB_POOL_MAX ?? 10);
  if (e.VERCEL && poolMax > 5) add("Banco", "warn", "Em serverless use a URL do pooler e DB_POOL_MAX baixo (ex.: 3).");

  // --- WhatsApp (Meta) ---
  if (!e.META_APP_SECRET || !e.META_WEBHOOK_VERIFY_TOKEN) add("WhatsApp", production ? "error" : "warn", "META_APP_SECRET e/ou META_WEBHOOK_VERIFY_TOKEN ausentes: webhooks serão recusados.");
  else add("WhatsApp", (e.META_WEBHOOK_VERIFY_TOKEN?.length ?? 0) >= 20 ? "ok" : "warn", `Segredos do webhook definidos. URL do webhook: ${appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`);

  // --- IA ---
  if (!e.ANTHROPIC_API_KEY) add("IA", "warn", "ANTHROPIC_API_KEY ausente: copiloto desativado (o resto funciona).");
  else add("IA", "ok", `Chave definida (modelo ${e.AI_MODEL ?? "claude-opus-5-5"}). Teste real: npm run ai:smoke`);

  // --- Pagamentos ---
  if (!e.ASAAS_API_KEY) add("Pagamentos", production ? "error" : "warn", "ASAAS_API_KEY ausente: não é possível assinar planos.");
  else {
    const envName = e.ASAAS_ENV ?? "sandbox";
    add("Pagamentos", production && envName !== "production" ? "error" : "ok", `Asaas em modo ${envName}.`);
    const t = e.ASAAS_WEBHOOK_TOKEN ?? "";
    if (t.length < 32 || t.length > 255 || /\s/.test(t)) add("Pagamentos", "error", "ASAAS_WEBHOOK_TOKEN precisa ter de 32 a 255 caracteres, sem espaços.");
    else if (t === e.ASAAS_API_KEY) add("Pagamentos", "error", "ASAAS_WEBHOOK_TOKEN não pode ser igual à API key.");
    else add("Pagamentos", "ok", `Token do webhook válido. URL: ${appUrl.replace(/\/$/, "")}/api/webhooks/billing`);
  }

  // --- E-mail ---
  if (!e.SMTP_URL) add("E-mail", production ? "error" : "warn", "SMTP_URL ausente: convites mostram o link na tela e 'esqueci minha senha' não envia e-mails.");
  else {
    try {
      const nodemailer = (await import("nodemailer")).default;
      await nodemailer.createTransport(e.SMTP_URL).verify();
      add("E-mail", "ok", `Servidor SMTP respondeu. Remetente: ${e.EMAIL_FROM ?? "(EMAIL_FROM não definido)"}`);
    } catch (err) {
      add("E-mail", "error", `SMTP não respondeu: ${(err as Error).message}`);
    }
    if (!e.EMAIL_FROM || /localhost/.test(e.EMAIL_FROM)) add("E-mail", "warn", "Defina EMAIL_FROM com um domínio verificado no provedor (evita cair no spam).");
  }

  const icon: Record<Level, string> = { ok: "✓", warn: "!", error: "✗" };
  for (const r of results) console.log(`${icon[r.level]} [${r.area}] ${r.msg}`);
  const errors = results.filter((r) => r.level === "error").length;
  const warns = results.filter((r) => r.level === "warn").length;
  console.log(`\n${errors} erro(s), ${warns} aviso(s)${production ? " — verificação de PRODUÇÃO" : ""}.`);
  process.exit(errors ? 1 : 0);
}

main();
