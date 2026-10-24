// Modèles des e-mails d'authentification (FR/EN), thème « vert nuit », HTML en tableaux + version texte
import type { Lang } from './actionUrl.js';
import type { Email } from './mailer.js';

export type Kind = 'resetPassword' | 'verifyEmail';

const LOGO = 'https://ezfoot.app/logo-texte@2x.png';

const COPY: Record<Kind, Record<Lang, { subject: string; title: string; body: string; cta: string; note: string }>> = {
  resetPassword: {
    fr: {
      subject: 'Réinitialise ton mot de passe EZFOOT',
      title: 'Nouveau mot de passe',
      body: 'Tu as demandé à réinitialiser le mot de passe de ton compte EZFOOT. Clique sur le bouton pour en choisir un nouveau. Le lien est valable 1 heure.',
      cta: 'Choisir un nouveau mot de passe',
      note: 'Si tu n’es pas à l’origine de cette demande, ignore cet e-mail : ton mot de passe ne change pas.',
    },
    en: {
      subject: 'Reset your EZFOOT password',
      title: 'New password',
      body: 'You asked to reset the password of your EZFOOT account. Click the button to choose a new one. The link is valid for 1 hour.',
      cta: 'Choose a new password',
      note: 'If you didn’t request this, ignore this email: your password stays the same.',
    },
  },
  verifyEmail: {
    fr: {
      subject: 'Confirme ton adresse e-mail EZFOOT',
      title: 'Bienvenue sur EZFOOT',
      body: 'Confirme ton adresse e-mail pour sécuriser ton compte et pouvoir récupérer ton mot de passe si tu l’oublies.',
      cta: 'Confirmer mon adresse',
      note: 'Si tu n’as pas créé de compte EZFOOT, ignore cet e-mail.',
    },
    en: {
      subject: 'Confirm your EZFOOT email address',
      title: 'Welcome to EZFOOT',
      body: 'Confirm your email address to secure your account and be able to recover your password if you forget it.',
      cta: 'Confirm my address',
      note: 'If you didn’t create an EZFOOT account, ignore this email.',
    },
  },
};

const FOOT: Record<Lang, string> = {
  fr: 'Le bouton ne marche pas ? Copie ce lien dans ton navigateur :',
  en: 'Button not working? Paste this link into your browser:',
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function render(kind: Kind, lang: Lang, to: string, link: string): Email {
  const c = COPY[kind][lang];
  const L = esc(link);
  const font = "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#0B0F0C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F0C"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 24px"><img src="${LOGO}" width="130" height="30" alt="EZFOOT" style="display:block;border:0"></td></tr>
<tr><td style="background:#141A16;border:1px solid #26302A;border-radius:16px;padding:32px 28px;${font};color:#F2F5F0">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:#F2F5F0">${esc(c.title)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#F2F5F0">${esc(c.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#3DDC84">
<a href="${L}" style="display:inline-block;padding:14px 22px;${font};font-size:16px;font-weight:700;color:#06170D;text-decoration:none;border-radius:12px">${esc(c.cta)}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#8A968E">${esc(c.note)}</p>
</td></tr>
<tr><td style="padding:20px 8px 0;${font};font-size:12px;line-height:1.5;color:#8A968E">${esc(FOOT[lang])}<br><a href="${L}" style="color:#3DDC84;word-break:break-all">${L}</a></td></tr>
<tr><td style="padding:16px 8px 0;${font};font-size:12px;color:#8A968E">EZFOOT · ezfoot.app · contact@ezfoot.app</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${c.title}\n\n${c.body}\n\n${c.cta}${lang === 'fr' ? ' :' : ':'}\n${link}\n\n${c.note}\n\n— EZFOOT · ezfoot.app · contact@ezfoot.app\n`;
  return { to, subject: c.subject, html, text, tag: kind };
}
