import { z } from "zod";
import type { Db } from "@/lib/db";

export class KnowledgeError extends Error {}

// ---------------- Catálogo ----------------
const money = z.string().optional().transform((v, ctx) => {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) { ctx.addIssue({ code: "custom", message: "Preço inválido" }); return z.NEVER; }
  return Math.round(n * 100);
});

export const productSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(160),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  price: money,
  priceType: z.enum(["fixed", "from", "on_request"]),
  durationMin: z.string().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 1440) { ctx.addIssue({ code: "custom", message: "Duração inválida" }); return z.NEVER; }
    return n;
  }),
}).refine((d) => d.priceType === "on_request" || d.price !== null, { message: "Informe o preço ou marque 'sob consulta'" });

export async function saveProduct(db: Db, orgId: string, input: z.input<typeof productSchema>, id?: string) {
  const d = productSchema.parse(input);
  const price = d.priceType === "on_request" ? null : d.price;
  if (id) {
    const r = await db.query("update products_services set name=$2, description=$3, price_cents=$4, price_type=$5, duration_min=$6, updated_at=now() where id=$1",
      [id, d.name, d.description, price, d.priceType, d.durationMin]);
    if (!r.rowCount) throw new KnowledgeError("Item não encontrado.");
    return id;
  }
  const r = await db.query<{ id: string }>(
    "insert into products_services (organization_id, name, description, price_cents, price_type, duration_min) values ($1,$2,$3,$4,$5,$6) returning id",
    [orgId, d.name, d.description, price, d.priceType, d.durationMin],
  );
  return r.rows[0].id;
}

export interface CatalogItem { id: string; name: string; description: string | null; price_cents: string | null; price_type: string; duration_min: number | null }
export async function listCatalog(db: Db, activeOnly = true) {
  const r = await db.query<CatalogItem & { active: boolean }>(
    `select id, name, description, price_cents, price_type, duration_min, active from products_services ${activeOnly ? "where active" : ""} order by name`,
  );
  return r.rows;
}

// ---------------- Documentos ----------------
export const documentSchema = z.object({
  title: z.string().trim().min(1, "Informe um título").max(200),
  kind: z.enum(["text", "faq"]),
  content: z.string().trim().min(10, "Conteúdo muito curto").max(100_000, "Máximo de 100 mil caracteres por documento"),
});

/** Divide o texto em trechos de ~1.200 caracteres respeitando parágrafos (e perguntas/respostas no FAQ). */
export function chunkText(text: string, max = 1200): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    if (p.length > max) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += max) chunks.push(p.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + p.length + 2 > max) { chunks.push(cur); cur = p; } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function saveDocument(db: Db, orgId: string, userId: string, input: z.input<typeof documentSchema>) {
  const d = documentSchema.parse(input);
  const r = await db.query<{ id: string }>(
    "insert into knowledge_documents (organization_id, title, kind, content, created_by) values ($1,$2,$3,$4,$5) returning id",
    [orgId, d.title, d.kind, d.content, userId],
  );
  const id = r.rows[0].id;
  for (const [i, c] of chunkText(d.content).entries()) {
    await db.query("insert into knowledge_chunks (organization_id, document_id, position, content) values ($1,$2,$3,$4)", [orgId, id, i, `${d.title}\n${c}`]);
  }
  return id;
}

export interface Snippet { id: string; documentTitle: string; content: string }

/** Base pequena (até este total) vai inteira para o contexto; acima disso, só os trechos mais relevantes. */
const FULL_KB_CHARS = 40_000;

function orQuery(text: string): string | null {
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []))].slice(0, 40);
  return words.length ? words.join(" | ") : null;
}

/**
 * Recupera trechos da base de conhecimento da PRÓPRIA organização (RLS + filtro explícito).
 * Busca textual em português (sem acentos); escolhida no lugar de embeddings para não depender de
 * outro provedor. Trocável por pgvector se a base crescer.
 */
export async function retrieve(db: Db, orgId: string, query: string, limit = 6): Promise<Snippet[]> {
  const total = await db.query<{ n: string | null }>(
    `select sum(length(c.content)) n from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
     where c.organization_id = $1 and d.active`, [orgId]);
  if (Number(total.rows[0].n ?? 0) <= FULL_KB_CHARS) {
    const all = await db.query<Snippet>(
      `select c.id, d.title as "documentTitle", c.content from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
       where c.organization_id = $1 and d.active order by d.created_at, c.position`, [orgId]);
    return all.rows;
  }
  const q = orQuery(query);
  if (!q) return [];
  const r = await db.query<Snippet>(
    `select c.id, d.title as "documentTitle", c.content
     from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
     where c.organization_id = $1 and d.active and c.tsv @@ to_tsquery('public.pt_unaccent', $2)
     order by ts_rank(c.tsv, to_tsquery('public.pt_unaccent', $2)) desc limit $3`,
    [orgId, q, limit],
  );
  return r.rows;
}

// ---------------- Configuração do assistente ----------------
export const agentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tone: z.string().trim().min(1).max(200),
  formality: z.enum(["informal", "neutral", "formal"]),
  businessDescription: z.string().trim().max(4000).optional().transform((v) => v || null),
  businessHours: z.string().trim().max(1000).optional().transform((v) => v || null),
  policies: z.string().trim().max(8000).optional().transform((v) => v || null),
  handoffRules: z.string().trim().max(2000).optional().transform((v) => v || null),
  forbiddenTopics: z.string().trim().max(2000).optional().transform((v) => v || null),
});
export type AgentConfig = z.infer<typeof agentSchema>;

export async function getAgent(db: Db): Promise<AgentConfig> {
  const r = await db.query<{ name: string; tone: string; formality: AgentConfig["formality"]; business_description: string | null; business_hours: string | null; policies: string | null; handoff_rules: string | null; forbidden_topics: string | null }>(
    "select * from ai_agents limit 1");
  const a = r.rows[0];
  return a
    ? { name: a.name, tone: a.tone, formality: a.formality, businessDescription: a.business_description, businessHours: a.business_hours, policies: a.policies, handoffRules: a.handoff_rules, forbiddenTopics: a.forbidden_topics }
    : { name: "Assistente", tone: "cordial e objetivo", formality: "neutral", businessDescription: null, businessHours: null, policies: null, handoffRules: null, forbiddenTopics: null };
}

export async function saveAgent(db: Db, orgId: string, userId: string, input: z.input<typeof agentSchema>) {
  const d = agentSchema.parse(input);
  await db.query(
    `insert into ai_agents (organization_id, name, tone, formality, business_description, business_hours, policies, handoff_rules, forbidden_topics, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (organization_id) do update set name=excluded.name, tone=excluded.tone, formality=excluded.formality,
       business_description=excluded.business_description, business_hours=excluded.business_hours, policies=excluded.policies,
       handoff_rules=excluded.handoff_rules, forbidden_topics=excluded.forbidden_topics, updated_by=excluded.updated_by, updated_at=now()`,
    [orgId, d.name, d.tone, d.formality, d.businessDescription, d.businessHours, d.policies, d.handoffRules, d.forbiddenTopics, userId],
  );
}
