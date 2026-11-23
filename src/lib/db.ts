import { Pool, type PoolClient } from "pg";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __retomaPool: Pool | undefined;
}

export function pool(): Pool {
  if (!globalThis.__retomaPool) {
    // Em ambientes serverless (Vercel), use a URL do pooler e um DB_POOL_MAX baixo (ex.: 3).
    // SET LOCAL e set_config(..., true) valem só na transação: compatível com pooler em modo transação.
    globalThis.__retomaPool = new Pool({ connectionString: env().DATABASE_URL, max: env().DB_POOL_MAX, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  }
  return globalThis.__retomaPool;
}

export async function closePool() {
  await globalThis.__retomaPool?.end();
  globalThis.__retomaPool = undefined;
}

export type Db = PoolClient;

export interface TenantContext {
  userId: string;
  orgId: string;
}

/**
 * Executa `fn` numa transação com o papel app_user (sujeito a RLS) e o contexto do tenant.
 * É o ÚNICO caminho que código de requisição de usuário deve usar para acessar dados de clientes.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("set local role app_user");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [
      ctx.userId,
      ctx.orgId,
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transação com o papel dono (ignora RLS). Uso restrito a código de serviço: cadastro, login,
 * webhooks e worker. Toda consulta aqui DEVE filtrar por organization_id explicitamente.
 */
export async function withService<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
