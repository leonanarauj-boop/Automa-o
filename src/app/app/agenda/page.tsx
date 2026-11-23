import Link from "next/link";
import { tenant } from "@/lib/session";
import { appointmentDetail, dayView, STATUS_LABEL } from "@/modules/agenda/service";
import { dateTime, phone } from "@/lib/format";
import { Card, EmptyState, LinkButton, PageHeader, buttonClass, cx } from "@/components/ui";
import { NewAppointment } from "./new-appointment";
import { AppointmentPanel, type PanelData } from "./appointment-panel";

export const metadata = { title: "Agenda" };
const TZ = "America/Sao_Paulo";
const HOUR_PX = 64;

function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: "border-primary/40 bg-primary-soft text-text",
  confirmed: "border-success/50 bg-success-soft text-text",
  no_show: "border-danger/40 bg-danger-soft text-text",
  done: "border-border bg-surface-2 text-muted",
};

export default async function Agenda({ searchParams }: { searchParams: Promise<{ date?: string; a?: string; novo?: string; contato?: string }> }) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayLocal();
  const data = await tenant(async (db, s) => {
    const view = await dayView(db, s.orgId, date);
    const detail = sp.a && /^[0-9a-f-]{36}$/.test(sp.a) ? await appointmentDetail(db, sp.a) : null;
    const conv = detail ? (await db.query<{ id: string }>("select id from conversations where contact_id = $1 order by last_message_at desc nulls last limit 1", [detail.contact_id])).rows[0]?.id ?? null : null;
    const contacts = (await db.query<{ id: string; name: string }>("select id, display_name as name from contacts where deleted_at is null order by display_name limit 1000")).rows;
    const services = (await db.query<{ id: string; name: string; duration_min: number | null }>("select id, name, duration_min from products_services where active order by name")).rows;
    return { view, detail, conv, contacts, services, role: s.role };
  });
  const { view } = data;
  const nowMin = date === todayLocal() ? (() => { const n = new Date(new Date().toLocaleString("en-US", { timeZone: TZ })); return n.getHours() * 60 + n.getMinutes(); })() : null;
  const hours = Array.from({ length: view.endHour - view.startHour }, (_, i) => view.startHour + i);
  const panelOpen = !!data.detail || sp.novo === "1";
  const q = (extra: Record<string, string>) => `/app/agenda?${new URLSearchParams({ date, ...extra })}`;

  const panel: PanelData | null = data.detail ? {
    id: data.detail.id, contact_id: data.detail.contact_id, contact_name: data.detail.contact_name, phone: phone(data.detail.phone_e164),
    professional_id: data.detail.professional_id, professional_name: data.detail.professional_name, service_name: data.detail.service_name,
    when: dateTime(data.detail.starts_at), status: data.detail.status, notes: data.detail.notes, cancel_reason: data.detail.cancel_reason,
    confirmed_via: data.detail.confirmed_via, reminder: data.detail.reminder_sent_at ? dateTime(data.detail.reminder_sent_at) : null, reminder_error: data.detail.reminder_error,
    dur: data.detail.dur, past: data.detail.starts_at.getTime() <= Date.now(), is_demo: data.detail.is_demo,
    date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(data.detail.starts_at), conversationId: data.conv,
  } : null;

  return (
    <>
      <PageHeader title="Agenda" description={<span className="inline-block first-letter:uppercase">{longDate(date)}</span>}
        action={<div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/agenda?date=${shift(date, -1)}`} className={buttonClass("secondary", "sm")} aria-label="Dia anterior">←</Link>
          <Link href="/app/agenda" className={buttonClass("secondary", "sm")}>Hoje</Link>
          <Link href={`/app/agenda?date=${shift(date, 1)}`} className={buttonClass("secondary", "sm")} aria-label="Próximo dia">→</Link>
          <form className="flex"><label htmlFor="date" className="sr-only">Ir para data</label><input id="date" name="date" type="date" defaultValue={date} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm" /><button className={cx(buttonClass("ghost", "sm"), "ml-1")}>Ir</button></form>
          <Link href="/app/agenda/settings" className={buttonClass("ghost", "sm")}>Configurar</Link>
          {view.professionals.length > 0 && <LinkButton href={q({ novo: "1" })} size="sm">Novo agendamento</LinkButton>}
        </div>} />

      {view.professionals.length === 0 ? (
        <Card><EmptyState title="Cadastre os profissionais para começar" action={<LinkButton href="/app/agenda/settings">Configurar agenda</LinkButton>}>
          Defina quem atende e em quais horários. A agenda só oferece horários livres, sem conflitos.</EmptyState></Card>
      ) : (
        <div className={cx("grid gap-6", panelOpen && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
          <Card className="overflow-x-auto">
            <div className="min-w-max lg:min-w-0">
              <div className="sticky top-0 z-10 flex border-b border-border bg-surface">
                <div className="w-14 shrink-0" />
                {view.professionals.map((p) => (
                  <div key={p.id} className="min-w-56 flex-1 border-l border-border px-3 py-2 text-sm font-medium">
                    {p.name}{!view.workingIds.has(p.id) && <span className="ml-1 text-xs font-normal text-muted">· folga</span>}
                  </div>
                ))}
              </div>
              <div className="relative flex" style={{ height: hours.length * HOUR_PX }}>
                <div className="w-14 shrink-0">
                  {hours.map((h) => <div key={h} className="pr-2 text-right text-xs text-muted" style={{ height: HOUR_PX }}>{String(h).padStart(2, "0")}:00</div>)}
                </div>
                {view.professionals.map((p) => (
                  <div key={p.id} className="relative min-w-56 flex-1 border-l border-border">
                    {hours.map((h) => <div key={h} className="border-b border-border/60" style={{ height: HOUR_PX }} />)}
                    {view.appointments.filter((a) => a.professional_id === p.id).map((a) => {
                      const top = ((a.start_min - view.startHour * 60) / 60) * HOUR_PX;
                      const height = Math.max(22, ((a.end_min - a.start_min) / 60) * HOUR_PX - 2);
                      return (
                        <Link key={a.id} href={q({ a: a.id })} aria-label={`${a.contact_name}, ${STATUS_LABEL[a.status]}`}
                          className={cx("absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-xs leading-tight hover:shadow-md", height < 40 && "truncate whitespace-nowrap", STATUS_STYLE[a.status], sp.a === a.id && "ring-2 ring-primary")}
                          style={{ top, height }}>
                          <span className="font-medium">{a.contact_name}</span>
                          <span className={cx("text-muted", height >= 40 ? "block" : "ml-1")}>{height < 40 && "· "}{String(Math.floor(a.start_min / 60)).padStart(2, "0")}:{String(a.start_min % 60).padStart(2, "0")}{a.service_name ? ` · ${a.service_name}` : ""} · {STATUS_LABEL[a.status]}{a.confirmed_via === "whatsapp" ? " ✓" : ""}</span>
                        </Link>
                      );
                    })}
                  </div>
                ))}
                {nowMin !== null && nowMin >= view.startHour * 60 && nowMin <= view.endHour * 60 && (
                  <div className="pointer-events-none absolute right-0 left-14 border-t-2 border-danger/70" style={{ top: ((nowMin - view.startHour * 60) / 60) * HOUR_PX }} aria-hidden="true" />
                )}
              </div>
            </div>
          </Card>

          {panelOpen && (
            <Card className="h-fit p-5 lg:sticky lg:top-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{panel ? "Agendamento" : "Novo agendamento"}</h2>
                <Link href={`/app/agenda?date=${date}`} className="text-sm text-muted hover:text-text" aria-label="Fechar painel">Fechar</Link>
              </div>
              {panel ? <AppointmentPanel a={panel} key={panel.id + panel.status} />
                : <NewAppointment contacts={data.contacts} professionals={view.professionals} services={data.services} date={date} canOverride={data.role !== "agent"} defaultContactId={sp.contato} />}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
