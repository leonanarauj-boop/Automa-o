// Sobe o app (Next.js) e o worker juntos, com saída identificada. Ctrl+C encerra os dois.
import { spawn } from "node:child_process";

const procs = [
  ["app   ", ["run", "dev"]],
  ["worker", ["run", "worker"]],
].map(([name, args]) => {
  const p = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const out = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  p.on("exit", (code) => { console.log(`[${name}] encerrado (${code ?? 0})`); stop(); });
  return p;
});
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const p of procs) p.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
