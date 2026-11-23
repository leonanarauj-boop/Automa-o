import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";
import { withService } from "@/lib/db";

export interface OutgoingEmail { to: string; subject: string; text: string; html: string }
export interface Mailer { configured(): boolean; send(m: OutgoingEmail): Promise<void> }

class SmtpMailer implements Mailer {
  private t: Transporter | null = null;
  configured() { return !!env().SMTP_URL; }
  async send(m: OutgoingEmail) {
    this.t ??= nodemailer.createTransport(env().SMTP_URL);
    await this.t.sendMail({ from: env().EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

let mailer: Mailer | null = null;
export function getMailer(): Mailer { return (mailer ??= new SmtpMailer()); }
export function setMailer(m: Mailer | null) { mailer = m; }

/** Envia e registra o resultado (sem guardar o corpo, que pode conter links com tokens). */
export async function sendEmail(template: string, orgId: string | null, m: OutgoingEmail): Promise<"sent" | "failed" | "not_configured"> {
  const mail = getMailer();
  let status: "sent" | "failed" | "not_configured" = "not_configured";
  let error: string | null = null;
  if (mail.configured()) {
    try { await mail.send(m); status = "sent"; } catch (e) { status = "failed"; error = (e as Error).message.slice(0, 500); }
  }
  await withService((db) => db.query("insert into email_log (organization_id, to_address, template, status, error) values ($1,$2,$3,$4,$5)", [orgId, m.to, template, status, error]));
  if (status !== "sent") console.error(JSON.stringify({ level: "warn", msg: "e-mail não enviado", template, status, error }));
  return status;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function layout(title: string, paragraphs: string[], cta: { label: string; url: string }, footer: string): { html: string; text: string } {
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#121826">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e3e6eb;border-radius:12px"><tr><td style="padding:28px">
<p style="margin:0 0 16px;font-weight:bold;color:#0e6e6a">Retoma</p>
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join("")}
<p style="margin:20px 0"><a href="${esc(cta.url)}" style="background:#0e6e6a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">${esc(cta.label)}</a></p>
<p style="margin:0;font-size:12px;color:#5b6474">Se o botão não funcionar, copie este endereço: ${esc(cta.url)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#5b6474">${esc(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${title}\n\n${paragraphs.join("\n\n")}\n\n${cta.label}: ${cta.url}\n\n${footer}`;
  return { html, text };
}
