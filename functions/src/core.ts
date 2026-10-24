// Logique des e-mails d'authentification, indépendante de Cloud Functions (testée sur les émulateurs)
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { toEzfootActionUrl, type Lang } from './actionUrl.js';
import type { Mailer } from './mailer.js';
import { HOUR, dailyCount, hit, limitKey } from './rateLimit.js';
import { render } from './templates.js';

export interface Deps {
  db: Firestore;
  auth: Auth;
  mailer: Mailer;
  dailyCap: number;
  actionBase?: string;
}

export const LIMITS = { perAddress: 3, perIp: 10, perUser: 3 };
export const MIN_RESPONSE_MS = 800;

export class TooMany extends Error {}

// Pseudo ou adresse → adresse du compte (null si inconnu)
export async function resolveEmail(d: Deps, id: string): Promise<string | null> {
  if (id.includes('@')) return id;
  const snap = await d.db.collection('usernames').doc(id.toLowerCase()).get();
  if (!snap.exists) return null;
  const uid = snap.get('uid') as string | undefined;
  if (uid) {
    try { return (await d.auth.getUser(uid)).email ?? null } catch { return null }
  }
  return (snap.get('email') as string | undefined) ?? null;
}

async function findUser(d: Deps, email: string): Promise<UserRecord | null> {
  try { return await d.auth.getUserByEmail(email) } catch { return null }
}

// Réponse toujours identique et jamais plus rapide que MIN_RESPONSE_MS : rien ne trahit l'existence d'un compte
export async function requestPasswordReset(d: Deps, id: string, lang: Lang, ip: string): Promise<void> {
  if (!(await hit(d.db, limitKey('reset-ip', ip), LIMITS.perIp, HOUR))) return;
  const email = await resolveEmail(d, id.trim());
  if (!email) return;
  if (!(await hit(d.db, limitKey('reset', email.toLowerCase()), LIMITS.perAddress, HOUR))) return;
  const user = await findUser(d, email.toLowerCase());
  if (!user || user.disabled || !user.email) return;
  if (!(await dailyCount(d.db, d.dailyCap))) { logger.error('Plafond quotidien d’e-mails atteint'); return; }
  const link = toEzfootActionUrl(await d.auth.generatePasswordResetLink(user.email), lang, d.actionBase);
  await d.mailer.send(render('resetPassword', lang, user.email, link));
}

// Compte connecté : les erreurs peuvent être explicites, elles ne concernent que son propre compte
export async function sendVerificationEmail(d: Deps, uid: string, lang: Lang): Promise<'sent' | 'already' | 'no-email'> {
  const user = await d.auth.getUser(uid);
  if (!user.email) return 'no-email';
  if (user.emailVerified) return 'already';
  if (!(await hit(d.db, limitKey('verify', uid), LIMITS.perUser, HOUR))) throw new TooMany();
  if (!(await dailyCount(d.db, d.dailyCap))) throw new TooMany();
  const link = toEzfootActionUrl(await d.auth.generateEmailVerificationLink(user.email), lang, d.actionBase);
  await d.mailer.send(render('verifyEmail', lang, user.email, link));
  return 'sent';
}

export async function atLeast<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try { return await fn() } finally {
    const rest = ms - (Date.now() - t);
    if (rest > 0) await new Promise(r => setTimeout(r, rest));
  }
}
