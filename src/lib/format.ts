const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(cents: number | string | null | undefined, exact = false) {
  const v = Number(cents ?? 0) / 100;
  return (exact ? brl2 : brl).format(v);
}

export function centsToInput(cents: number | string) {
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}

export function dateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export function timeOnly(d: Date | string) {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function relative(d: Date | string | null | undefined, now = Date.now()) {
  if (!d) return "—";
  const diff = now - new Date(d).getTime();
  const m = Math.round(diff / 60000);
  if (Math.abs(m) < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  return dateTime(d);
}

export function phone(p: string | null | undefined) {
  if (!p) return "—";
  const m = p.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${p}`;
}

export const TEMPERATURE: Record<string, { label: string; tone: "info" | "money" | "danger" }> = {
  cold: { label: "Frio", tone: "info" },
  warm: { label: "Morno", tone: "money" },
  hot: { label: "Quente", tone: "danger" },
};
