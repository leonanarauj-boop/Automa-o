import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Retoma — Inteligência comercial no WhatsApp", template: "%s · Retoma" },
  description: "Organize conversas do WhatsApp em oportunidades, veja o dinheiro parado no seu funil e saiba a próxima ação para cada cliente.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
