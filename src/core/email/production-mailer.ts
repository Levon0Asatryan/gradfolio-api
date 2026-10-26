import type { AppConfig } from '../config/index.js';
import { DisabledMailer, type Mailer } from './mailer.js';
import { ResendMailer } from './resend.js';
import { SendGridMailer } from './sendgrid.js';

export function productionMailer(cfg: AppConfig): Mailer {
  if (!cfg.EMAIL_DELIVERY_ENABLED) return new DisabledMailer();
  if (!cfg.EMAIL_FROM) throw new Error('enabled mail worker needs EMAIL_FROM');
  if (cfg.EMAIL_PROVIDER === 'sendgrid') {
    if (!cfg.SENDGRID_API_KEY) throw new Error('enabled mail worker needs SENDGRID_API_KEY');
    return new SendGridMailer(cfg.SENDGRID_API_KEY, cfg.EMAIL_FROM, cfg.EMAIL_REPLY_TO);
  }
  if (!cfg.RESEND_API_KEY) throw new Error('enabled mail worker needs RESEND_API_KEY');
  return new ResendMailer(cfg.RESEND_API_KEY, cfg.EMAIL_FROM, cfg.EMAIL_REPLY_TO);
}
