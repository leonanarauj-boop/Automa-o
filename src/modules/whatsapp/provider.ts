/**
 * Camada de canal desacoplada. O domínio só conhece esta interface; o adaptador da Meta Cloud API
 * é a primeira implementação. Novos provedores (BSP, Instagram) entram como novos adaptadores.
 */
export interface ChannelCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}

export interface SendResult {
  providerMessageId: string;
}

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string | null;
}

export interface ChannelProvider {
  sendText(creds: ChannelCredentials, to: string, body: string): Promise<SendResult>;
  sendTemplate(creds: ChannelCredentials, to: string, name: string, language: string, bodyParams: string[]): Promise<SendResult>;
  listTemplates(creds: ChannelCredentials): Promise<RemoteTemplate[]>;
  getPhoneNumber(creds: ChannelCredentials): Promise<{ displayPhone: string; verifiedName: string | null }>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: number) {
    super(message);
  }
}
