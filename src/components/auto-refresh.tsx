"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Atualiza os dados do servidor periodicamente enquanto a aba está visível. */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  return null;
}
