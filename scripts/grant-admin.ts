/**
 * Concede (ou revoga) acesso ao painel da plataforma. Uso:
 *   npm run admin:grant -- email@dominio.com
 *   npm run admin:grant -- email@dominio.com --revoke
 * A pessoa precisa ter conta e ativar a verificação em duas etapas para entrar no painel.
 */
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* ambiente */ }

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email) { console.error("Informe o e-mail."); process.exit(1); }
  const { withService, closePool } = await import("@/lib/db");
  await withService(async (db) => {
    const u = (await db.query<{ id: string }>("select id from users where lower(email) = lower($1)", [email])).rows[0];
    if (!u) throw new Error("Usuário não encontrado: crie a conta primeiro.");
    if (flag === "--revoke") await db.query("delete from platform_admins where user_id = $1", [u.id]);
    else await db.query("insert into platform_admins (user_id, created_by) values ($1, 'cli') on conflict do nothing", [u.id]);
    await db.query("insert into admin_audit (admin_user_id, action, metadata) values ($1,$2,$3)", [u.id, flag === "--revoke" ? "admin_revoked" : "admin_granted", JSON.stringify({ via: "cli", email })]);
  });
  await closePool();
  console.log(flag === "--revoke" ? "Acesso revogado." : "Acesso concedido. A pessoa deve ativar a verificação em duas etapas para usar o painel.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
