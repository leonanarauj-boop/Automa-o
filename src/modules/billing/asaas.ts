import { env } from "@/lib/env";
import { BillingProviderError, type BillingProvider, type BillingType, type GatewayPayment } from "./provider";

/**
 * Adaptador do Asaas (API v3), conforme docs.asaas.com:
 *   autenticação: cabeçalho access_token + User-Agent obrigatório
 *   POST   /v3/customers                       (name, cpfCnpj obrigatórios)
 *   POST   /v3/subscriptions                   (customer, billingType, value, nextDueDate, cycle obrigatórios)
 *   GET    /v3/subscriptions/{id}/payments     (cobranças da assinatura, com invoiceUrl)
 *   DELETE /v3/subscriptions/{id}
 * Observação: a atualização de assinatura NÃO aceita alterar o valor; troca de plano = nova assinatura.
 */
const BASE = { sandbox: "https://api-sandbox.asaas.com/v3", production: "https://api.asaas.com/v3" } as const;

type FetchLike = typeof fetch;

interface AsaasPayment {
  id: string; subscription?: string | null; value: number; status: string; billingType?: string | null;
  dueDate: string; paymentDate?: string | null; clientPaymentDate?: string | null; invoiceUrl?: string | null;
}

export function mapAsaasPayment(p: AsaasPayment): GatewayPayment {
  return {
    id: p.id, subscriptionId: p.subscription ?? null, valueCents: Math.round(Number(p.value) * 100), status: p.status,
    billingType: p.billingType ?? null, dueDate: p.dueDate, paymentDate: p.paymentDate ?? p.clientPaymentDate ?? null, invoiceUrl: p.invoiceUrl ?? null,
  };
}

export class AsaasProvider implements BillingProvider {
  readonly name = "asaas";
  constructor(private readonly apiKey = env().ASAAS_API_KEY, private readonly envName = env().ASAAS_ENV, private readonly fetchImpl: FetchLike = fetch) {}

  available() { return !!this.apiKey; }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) throw new BillingProviderError("Pagamentos não configurados (ASAAS_API_KEY ausente).");
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE[this.envName]}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "User-Agent": "Retoma/0.5", access_token: this.apiKey },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new BillingProviderError(`Falha de rede com o gateway de pagamento: ${(e as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as { errors?: { code?: string; description?: string }[] } & T;
    if (!res.ok) {
      const msg = json.errors?.map((e) => e.description).filter(Boolean).join(" ") || `Erro ${res.status} do gateway de pagamento.`;
      throw new BillingProviderError(msg, res.status >= 500 || res.status === 429);
    }
    return json;
  }

  async createCustomer(i: { name: string; cpfCnpj: string; email?: string | null; externalReference: string }) {
    const r = await this.call<{ id: string }>("POST", "/customers", { name: i.name, cpfCnpj: i.cpfCnpj, email: i.email ?? undefined, externalReference: i.externalReference });
    return { id: r.id };
  }

  async createSubscription(i: { customerId: string; billingType: BillingType; valueCents: number; nextDueDate: string; description: string; externalReference: string }) {
    const r = await this.call<{ id: string }>("POST", "/subscriptions", {
      customer: i.customerId, billingType: i.billingType, value: i.valueCents / 100, nextDueDate: i.nextDueDate, cycle: "MONTHLY",
      description: i.description, externalReference: i.externalReference,
    });
    return { id: r.id };
  }

  async listSubscriptionPayments(subscriptionId: string) {
    const r = await this.call<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    return (r.data ?? []).map(mapAsaasPayment);
  }

  async deleteSubscription(subscriptionId: string) {
    await this.call("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }
}

let provider: BillingProvider | null = null;
export function billingProvider(): BillingProvider {
  return (provider ??= new AsaasProvider());
}
export function setBillingProvider(p: BillingProvider | null) {
  provider = p;
}
