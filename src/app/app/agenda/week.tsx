import Link from "next/link";
import type { DayAppointment } from "@/modules/agenda/service";
import { STATUS_LABEL } from "@/modules/agenda/service";
import { cx } from "@/components/ui";

const HOUR_PX = 56;
const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const STYLE: Record<string, string> = {
  scheduled: "border-primary/40 bg-primary-soft", confirmed: "border-success/50 bg-success-soft", no_show: "border-danger/40 bg-danger-soft", done: "border-border bg-surface-2 text-muted",
};

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Grade semanal (segunda a domingo) de um profissional, com expediente, bloqueios e agendamentos. */
export function WeekGrid({ weekStart, today, data }: {
  weekStart: string; today: string;
  data: { appointments: (DayAppointment & { day: number })[]; rules: { weekday: number; start_min: number; end_min: number }[]; blocks: { day: number; start_min: number; end_min: number; reason: string | null }[]; startHour: number; endHour: number };
}) {
  const hours = Array.from({ length: data.endHour - data.startHour }, (_, i) => data.startHour + i);
  const y = (min: number) => ((min - data.startHour * 60) / 60) * HOUR_PX;
  return (
    <div className="min-w-[760px]">
      <div className="sticky top-0 z-10 grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border bg-surface">
        <div />
        {DAYS.map((l, i) => {
          const date = addDays(weekStart, i);
          const n = data.appointments.filter((a) => a.day === i && a.status !== "done").length;
          return (
            <Link key={i} href={`/app/agenda?date=${date}`} className={cx("border-l border-border px-2 py-2 text-sm hover:bg-surface-2", date === today && "bg-primary-soft text-primary")}>
              <span className="font-medium">{l} {date.slice(8, 10)}/{date.slice(5, 7)}</span>
              <span className="block text-xs text-muted">{n} agendamento(s)</span>
            </Link>
          );
        })}
      </div>
      <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height: hours.length * HOUR_PX }}>
        <div>{hours.map((h) => <div key={h} className="pr-2 text-right text-xs text-muted" style={{ height: HOUR_PX }}>{String(h).padStart(2, "0")}:00</div>)}</div>
        {DAYS.map((_, i) => {
          const weekday = (i + 1) % 7; // 0 = domingo
          const date = addDays(weekStart, i);
          return (
            <div key={i} className="relative border-l border-border bg-surface-2/60">
              {/* expediente em branco; fora do expediente em cinza */}
              {data.rules.filter((r) => r.weekday === weekday).map((r, k) => (
                <div key={k} className="absolute inset-x-0 bg-surface" style={{ top: y(r.start_min), height: y(r.end_min) - y(r.start_min) }} aria-hidden="true" />
              ))}
              {hours.map((h) => <div key={h} className="relative border-b border-border/50" style={{ height: HOUR_PX }} />)}
              {data.blocks.filter((b) => b.day === i).map((b, k) => (
                <div key={k} title={b.reason ?? "Bloqueado"} className="absolute inset-x-0.5 rounded bg-[repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2)_6px,var(--border)_6px,var(--border)_8px)] text-[10px] text-muted"
                  style={{ top: y(b.start_min), height: y(b.end_min) - y(b.start_min) }}><span className="px-1">{b.reason ?? "Bloqueado"}</span></div>
              ))}
              {data.appointments.filter((a) => a.day === i).map((a) => {
                const h = Math.max(20, y(a.end_min) - y(a.start_min) - 2);
                return (
                  <Link key={a.id} href={`/app/agenda?date=${date}&a=${a.id}`} aria-label={`${a.contact_name}, ${STATUS_LABEL[a.status]}`}
                    className={cx("absolute inset-x-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:shadow", STYLE[a.status])}
                    style={{ top: y(a.start_min), height: h }}>
                    <span className="font-medium">{String(Math.floor(a.start_min / 60)).padStart(2, "0")}:{String(a.start_min % 60).padStart(2, "0")} {a.contact_name}</span>
                    {h >= 34 && <span className="block truncate text-muted">{a.service_name ?? STATUS_LABEL[a.status]}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
