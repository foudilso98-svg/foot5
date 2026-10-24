// Envoi d'e-mails derrière une interface commune : changer de service = changer d'implémentation
import { logger } from 'firebase-functions';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export const FROM = { name: 'EZFOOT', email: 'noreply@ezfoot.app' };
export const REPLY_TO = { name: 'EZFOOT', email: 'contact@ezfoot.app' };

export class BrevoMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}

  async send(email: Email): Promise<void> {
    const res = await this.fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: FROM,
        replyTo: REPLY_TO,
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        tags: [email.tag],
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

// Émulateur et tests : rien n'est envoyé, le lien apparaît dans les journaux
export class LogMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
    logger.info('E-mail (non envoyé)', { to: email.to, subject: email.subject, text: email.text });
  }
}
