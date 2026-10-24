import { describe, expect, it } from 'vitest';
import { asLang, toEzfootActionUrl } from './actionUrl.js';
import { BrevoMailer } from './mailer.js';
import { HOUR, slide } from './rateLimit.js';
import { render } from './templates.js';

const FB = 'https://foot5-68b18.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC-123_x&apiKey=k&lang=fr';

describe('lien d’action', () => {
  it('pointe vers ezfoot.app et ne garde que mode, oobCode et lang', () => {
    const u = new URL(toEzfootActionUrl(FB, 'en'));
    expect(u.origin + u.pathname).toBe('https://ezfoot.app/auth/action');
    expect([...u.searchParams.keys()]).toEqual(['mode', 'oobCode', 'lang']);
    expect(u.searchParams.get('oobCode')).toBe('ABC-123_x');
    expect(u.searchParams.get('lang')).toBe('en');
  });
  it('refuse un mode inconnu ou un code absent', () => {
    expect(() => toEzfootActionUrl(FB.replace('resetPassword', 'signIn'), 'fr')).toThrow();
    expect(() => toEzfootActionUrl('https://x.firebaseapp.com/__/auth/action?mode=verifyEmail', 'fr')).toThrow();
  });
  it('langue : anglais si demandé, sinon français', () => {
    expect(asLang('en')).toBe('en');
    expect(asLang('de')).toBe('fr');
    expect(asLang(undefined)).toBe('fr');
  });
});

describe('fenêtre glissante', () => {
  const now = 10 * HOUR;
  it('accepte 3 demandes par heure puis refuse la 4e', () => {
    let hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = slide(hits, now + i, 3, HOUR);
      expect(r.ok).toBe(true);
      hits = r.hits;
    }
    expect(slide(hits, now + 10, 3, HOUR).ok).toBe(false);
  });
  it('oublie les demandes de plus d’une heure', () => {
    const r = slide([now - HOUR - 1, now - HOUR, now - 5], now, 3, HOUR);
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([now - 5, now]);
  });
});

describe('modèles', () => {
  const link = 'https://ezfoot.app/auth/action?mode=resetPassword&oobCode=A&lang=fr';
  it('FR : objet, lien échappé dans le HTML, lien brut dans le texte', () => {
    const e = render('resetPassword', 'fr', 'a@b.fr', link);
    expect(e.subject).toBe('Réinitialise ton mot de passe EZFOOT');
    expect(e.html).toContain('href="https://ezfoot.app/auth/action?mode=resetPassword&amp;oobCode=A&amp;lang=fr"');
    expect(e.html).toContain('https://ezfoot.app/logo-texte@2x.png');
    expect(e.html).toContain('#0B0F0C');
    expect(e.text).toContain(link);
    expect(e.text).toContain('nouveau mot de passe :');
  });
  it('EN : textes anglais', () => {
    const e = render('verifyEmail', 'en', 'a@b.fr', link);
    expect(e.subject).toBe('Confirm your EZFOOT email address');
    expect(e.html).toContain('lang="en"');
    expect(e.text).toContain('Confirm my address:');
  });
  it('aucun pixel ni lien externe autre que ezfoot.app', () => {
    const e = render('resetPassword', 'fr', 'a@b.fr', link);
    const urls = [...e.html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1] ?? '');
    expect(urls.every(u => u.startsWith('https://ezfoot.app/'))).toBe(true);
  });
});

describe('Brevo', () => {
  it('envoie depuis noreply@ezfoot.app, réponses vers contact@', async () => {
    let body: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = init.headers as Record<string, string>;
      return new Response('{"messageId":"x"}', { status: 201 });
    }) as unknown as typeof fetch;
    await new BrevoMailer('clé', fake).send(render('resetPassword', 'fr', 'a@b.fr', 'https://ezfoot.app/auth/action?mode=resetPassword&oobCode=A&lang=fr'));
    expect(headers['api-key']).toBe('clé');
    expect(body.sender).toEqual({ name: 'EZFOOT', email: 'noreply@ezfoot.app' });
    expect(body.replyTo).toEqual({ name: 'EZFOOT', email: 'contact@ezfoot.app' });
    expect(body.to).toEqual([{ email: 'a@b.fr' }]);
  });
  it('remonte une erreur si Brevo refuse', async () => {
    const fake = (async () => new Response('bad', { status: 401 })) as unknown as typeof fetch;
    await expect(new BrevoMailer('k', fake).send(render('verifyEmail', 'fr', 'a@b.fr', 'https://ezfoot.app/x'))).rejects.toThrow('Brevo 401');
  });
});
