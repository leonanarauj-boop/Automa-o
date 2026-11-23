/**
 * Worker de processamento assíncrono (rodar como serviço de longa duração).
 * Processa webhooks, envios ao WhatsApp e recalcula o Radar periodicamente.
 */
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* usa variáveis do ambiente */ }

const RADAR_EVERY_MS = 15 * 60 * 1000;
const REMINDERS_EVERY_MS = 5 * 60 * 1000;
const AUTOMATION_TICK_MS = 10 * 1000;
const NO_REPLY_SCAN_MS = 5 * 60 * 1000;
const CAMPAIGN_TICK_MS = 60 * 1000;
const BILLING_LIFECYCLE_MS = 30 * 60 * 1000;

async function main() {
  const { runOnce, schedulePeriodic, automationTick, campaignTick } = await import("./handlers");
  const { closePool } = await import("@/lib/db");
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let lastRadar = 0;
  let lastReminders = 0;
  let lastAutomation = 0;
  let lastNoReply = 0;
  let lastCampaign = 0;
  let lastBilling = 0;
  console.log(JSON.stringify({ level: "info", msg: "worker iniciado" }));
  while (!stopping) {
    try {
      if (Date.now() - lastRadar > RADAR_EVERY_MS) { await schedulePeriodic("radar.refresh_all"); lastRadar = Date.now(); }
      if (Date.now() - lastReminders > REMINDERS_EVERY_MS) { await schedulePeriodic("appointments.reminders"); lastReminders = Date.now(); }
      if (Date.now() - lastAutomation > AUTOMATION_TICK_MS) {
        const scan = Date.now() - lastNoReply > NO_REPLY_SCAN_MS;
        await automationTick({ scanNoReply: scan });
        lastAutomation = Date.now();
        if (scan) lastNoReply = Date.now();
      }
      if (Date.now() - lastCampaign > CAMPAIGN_TICK_MS) { await campaignTick(); lastCampaign = Date.now(); }
      if (Date.now() - lastBilling > BILLING_LIFECYCLE_MS) { await schedulePeriodic("billing.lifecycle"); lastBilling = Date.now(); }
      const n = await runOnce(20);
      if (n === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "erro no loop do worker", error: (e as Error).message }));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await closePool();
  console.log(JSON.stringify({ level: "info", msg: "worker finalizado" }));
}

main();
