import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui";

const FEATURES = [
  { t: "Radar de dinheiro parado", d: "Veja, em reais, quantos clientes estão esperando resposta, quantos orçamentos esfriaram e qual a próxima ação para cada um. Estimativas e receita recuperada aparecem separadas." },
  { t: "Cada conversa vira oportunidade", d: "Quem fala com seu WhatsApp vira contato e negócio no funil automaticamente, com histórico completo." },
  { t: "WhatsApp oficial", d: "Integração pela API oficial da Meta. Sem QR Code, sem risco de banimento por automação não autorizada." },
  { t: "Feito para o seu segmento", d: "Funil, etiquetas e alertas já configurados para clínicas, imobiliárias, escolas, lojas e serviços." },
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo className="text-lg" />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost", "sm")}>Entrar</Link>
          <Link href="/signup" className={buttonClass("primary", "sm")}>Testar grátis</Link>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-3xl px-4 pt-16 pb-12 text-center">
          <p className="text-sm font-medium text-primary">Inteligência comercial para quem vende pelo WhatsApp</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Nenhuma venda esquecida no seu WhatsApp.</h1>
          <p className="mt-5 text-lg text-muted text-balance">A Retoma organiza suas conversas em oportunidades, mostra quanto dinheiro está parado no seu funil e diz qual cliente precisa de atenção agora.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/signup" className={buttonClass("primary")}>Começar teste de 14 dias</Link>
            <Link href="/login" className={buttonClass("secondary")}>Já tenho conta</Link>
          </div>
          <p className="mt-3 text-xs text-muted">Sem cartão de crédito · Versão de pré-lançamento</p>
        </section>
        <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-20 sm:grid-cols-2" aria-label="Funcionalidades">
          {FEATURES.map((f) => (
            <article key={f.t} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-semibold">{f.t}</h2>
              <p className="mt-2 text-sm text-muted">{f.d}</p>
            </article>
          ))}
        </section>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted">© {new Date().getFullYear()} Retoma</footer>
    </div>
  );
}
