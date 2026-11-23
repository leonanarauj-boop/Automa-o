/** Camada de gateway de pagamento. O Asaas é a primeira implementação; testes usam um provedor falso. */
export type BillingType = "UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD";

export interface GatewayPayment {
  id: string;
  subscriptionId: string | null;
  valueCents: number;
  status: string; // status do gateway (PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED, ...)
  billingType: string | null;
  dueDate: string; // YYYY-MM-DD
  paymentDate: string | null;
  invoiceUrl: string | null;
}

export interface BillingProvider {
  readonly name: string;
  available(): boolean;
  createCustomer(input: { name: string; cpfCnpj: string; email?: string | null; externalReference: string }): Promise<{ id: string }>;
  createSubscription(input: { customerId: string; billingType: BillingType; valueCents: number; nextDueDate: string; description: string; externalReference: string }): Promise<{ id: string }>;
  listSubscriptionPayments(subscriptionId: string): Promise<GatewayPayment[]>;
  deleteSubscription(subscriptionId: string): Promise<void>;
}

export class BillingProviderError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}
