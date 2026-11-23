import type { Db } from "@/lib/db";
import { getDefaultPipeline } from "@/modules/crm/service";

/**
 * Dados de DEMONSTRAÇÃO, sempre marcados com is_demo = true e exibidos com o selo "DEMO".
 * Servem para conhecer o sistema antes de conectar o WhatsApp. Podem ser removidos a qualquer momento.
 */
const H = 3600 * 1000;

interface DemoContact {
  name: string; phone: string; stage: number | "won" | "lost"; value: number; temperature: "cold" | "warm" | "hot";
  msgs: { dir: "in" | "out"; text: string; hoursAgo: number }[];
}

const DEMO: DemoContact[] = [
  { name: "Mariana Costa (DEMO)", phone: "5511900000001", stage: 2, value: 4800, temperature: "hot",
    msgs: [
      { dir: "in", text: "Oi! Gostaria de saber o valor do clareamento e se parcelam.", hoursAgo: 130 },
      { dir: "out", text: "Olá, Mariana! Enviamos o orçamento de R$ 4.800 em até 10x. Posso agendar uma avaliação?", hoursAgo: 128 },
      { dir: "in", text: "Vou ver com meu marido e te aviso.", hoursAgo: 126 },
      { dir: "out", text: "Claro! Fico à disposição.", hoursAgo: 125 },
    ] },
  { name: "Ricardo Alves (DEMO)", phone: "5511900000002", stage: 0, value: 0, temperature: "warm",
    msgs: [{ dir: "in", text: "Boa tarde, vocês atendem convênio? Preciso de um orçamento para implante.", hoursAgo: 5 }] },
  { name: "Juliana Prado (DEMO)", phone: "5511900000003", stage: 3, value: 12500, temperature: "hot",
    msgs: [
      { dir: "in", text: "Recebi a proposta do tratamento ortodôntico. Tem desconto à vista?", hoursAgo: 200 },
      { dir: "out", text: "Temos 8% de desconto à vista. Posso reservar o início para a próxima semana?", hoursAgo: 198 },
    ] },
  { name: "Carlos Mendes (DEMO)", phone: "5511900000004", stage: 1, value: 350, temperature: "warm",
    msgs: [
      { dir: "in", text: "Quero marcar uma avaliação.", hoursAgo: 30 },
      { dir: "out", text: "Perfeito! Temos quinta às 14h ou sexta às 9h.", hoursAgo: 29 },
      { dir: "in", text: "Quinta às 14h, por favor.", hoursAgo: 28 },
      { dir: "out", text: "Agendado! Até quinta.", hoursAgo: 27 },
    ] },
  { name: "Fernanda Lima (DEMO)", phone: "5511900000005", stage: "won", value: 2200, temperature: "hot",
    msgs: [
      { dir: "in", text: "Pode confirmar minha sessão de harmonização?", hoursAgo: 72 },
      { dir: "out", text: "Confirmado, Fernanda! Pagamento recebido.", hoursAgo: 71 },
    ] },
  { name: "Paulo Rocha (DEMO)", phone: "5511900000006", stage: "lost", value: 6000, temperature: "cold",
    msgs: [
      { dir: "in", text: "Achei caro, vou pesquisar em outro lugar.", hoursAgo: 300 },
      { dir: "out", text: "Entendo, Paulo. Se quiser, podemos rever as condições.", hoursAgo: 299 },
    ] },
];

export async function seedDemo(db: Db, orgId: string, userId: string) {
  const existing = await db.query("select 1 from contacts where is_demo and deleted_at is null limit 1");
  if (existing.rowCount) return false;
  const pipe = await getDefaultPipeline(db);
  const open = pipe.stages.filter((s) => s.kind === "open");
  const won = pipe.stages.find((s) => s.kind === "won")!;
  const lost = pipe.stages.find((s) => s.kind === "lost")!;
  const now = Date.now();
  for (const d of DEMO) {
    const lastIn = Math.min(...d.msgs.filter((m) => m.dir === "in").map((m) => m.hoursAgo));
    const outs = d.msgs.filter((m) => m.dir === "out").map((m) => m.hoursAgo);
    const lastOut = outs.length ? Math.min(...outs) : null;
    const c = await db.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, phone_e164, source, temperature, owner_user_id, is_demo, last_inbound_at, last_outbound_at, created_at)
       values ($1,$2,$3,'demo',$4,$5,true,$6,$7,$8) returning id`,
      [orgId, d.name, d.phone, d.temperature, userId, new Date(now - lastIn * H), lastOut === null ? null : new Date(now - lastOut * H),
       new Date(now - Math.max(...d.msgs.map((m) => m.hoursAgo)) * H)],
    );
    const contactId = c.rows[0].id;
    const conv = await db.query<{ id: string }>(
      `insert into conversations (organization_id, contact_id, is_demo, last_message_at, service_window_expires_at, unread_count)
       values ($1,$2,true,$3,$4,$5) returning id`,
      [orgId, contactId, new Date(now - Math.min(...d.msgs.map((m) => m.hoursAgo)) * H), new Date(now - lastIn * H + 24 * H),
       lastOut === null || lastOut > lastIn ? 1 : 0],
    );
    for (const m of d.msgs) {
      await db.query(
        `insert into messages (organization_id, conversation_id, direction, sender_type, body, status, sent_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [orgId, conv.rows[0].id, m.dir === "in" ? "inbound" : "outbound", m.dir === "in" ? "contact" : "user", m.text,
         m.dir === "in" ? "received" : "read", new Date(now - m.hoursAgo * H)],
      );
    }
    const stage = d.stage === "won" ? won : d.stage === "lost" ? lost : open[Math.min(d.stage, open.length - 1)];
    const lastActivity = new Date(now - Math.min(...d.msgs.map((m) => m.hoursAgo)) * H);
    await db.query(
      `insert into deals (organization_id, contact_id, pipeline_id, stage_id, owner_user_id, title, value_cents, status, won_at, lost_reason, is_demo, last_activity_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$11)`,
      [orgId, contactId, pipe.id, stage.id, userId, "Tratamento (DEMO)", d.value * 100, stage.kind,
       stage.kind === "won" ? lastActivity : null, stage.kind === "lost" ? "Preço" : null, lastActivity],
    );
  }
  await seedDemoAgenda(db, orgId, userId);
  return true;
}

/** Agenda de demonstração: uma profissional (DEMO) e agendamentos ligados aos contatos de exemplo. */
async function seedDemoAgenda(db: Db, orgId: string, userId: string) {
  const p = await db.query<{ id: string }>("insert into professionals (organization_id, name, is_demo) values ($1, 'Dra. Exemplo (DEMO)', true) returning id", [orgId]);
  const pid = p.rows[0].id;
  for (let wd = 1; wd <= 6; wd++) {
    await db.query("insert into availability_rules (organization_id, professional_id, weekday, start_time, end_time) values ($1,$2,$3,'08:00','12:00'), ($1,$2,$3,'13:00','18:00')", [orgId, pid, wd]);
  }
  const plan: { name: string; dayOffset: number; time: string; status: string; minutes: number }[] = [
    { name: "Carlos Mendes (DEMO)", dayOffset: 1, time: "14:00", status: "scheduled", minutes: 30 },
    { name: "Fernanda Lima (DEMO)", dayOffset: -1, time: "10:00", status: "done", minutes: 60 },
    { name: "Paulo Rocha (DEMO)", dayOffset: -3, time: "09:00", status: "no_show", minutes: 30 },
    { name: "Juliana Prado (DEMO)", dayOffset: 0, time: "16:00", status: "confirmed", minutes: 45 },
  ];
  for (const a of plan) {
    await db.query(
      `with tz as (select timezone from organizations where id = $1)
       insert into appointments (organization_id, contact_id, professional_id, starts_at, ends_at, status, source, is_demo, created_by, confirmed_at, confirmed_via)
       select $1, c.id, $2, s.at, s.at + make_interval(mins => $6), $5, 'demo', true, $7,
              case when $5 = 'confirmed' then now() end, case when $5 = 'confirmed' then 'user' end
       from contacts c, tz, lateral (select ((current_date + $3::int) + $4::time) at time zone tz.timezone as at) s
       where c.organization_id = $1 and c.display_name = $8 and c.is_demo`,
      [orgId, pid, a.dayOffset, a.time, a.status, a.minutes, userId, a.name]);
  }
}

export async function removeDemo(db: Db) {
  await db.query("delete from contacts where is_demo");
  await db.query("delete from professionals where is_demo");
}
