"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={buttonClass("secondary", "sm")}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { setDone(false); } }}>
      {done ? "Copiado" : "Copiar texto"}
    </button>
  );
}
