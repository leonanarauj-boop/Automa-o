"use client";

import type { ComponentProps } from "react";
import { Select } from "./ui";

/** Select que envia o formulário ao mudar (com botão de fallback para quem navega sem JS). */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
