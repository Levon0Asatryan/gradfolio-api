export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable across worker crashes and retries; never generate a new key for a retry. */
  idempotencyKey: string;
}

export interface Mailer {
  /** Time the provider promises to deduplicate a key; 0 means no such promise. */
  readonly idempotencyWindowMs: number;
  send(message: EmailMessage, signal: AbortSignal): Promise<{ messageId: string }>;
}

/** A provider adapter may retry only errors it knows were not accepted. Unknown = uncertain. */
export class MailDeliveryError extends Error {
  constructor(readonly kind: 'temporary' | 'permanent') {
    super('mail delivery failed');
  }
}

export class DisabledMailer implements Mailer {
  readonly idempotencyWindowMs = 0;
  send(_message: EmailMessage): Promise<{ messageId: string }> {
    return Promise.reject(new MailDeliveryError('temporary'));
  }
}
