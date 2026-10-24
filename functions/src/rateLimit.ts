// Limitation de débit : fenêtre glissante, compteur stocké sous une empreinte (jamais l'adresse en clair)
import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

export const HOUR = 3_600_000;

// Garde les passages encore dans la fenêtre et dit si un de plus est permis
export function slide(hits: number[], now: number, limit: number, windowMs: number): { ok: boolean; hits: number[] } {
  const recent = hits.filter(t => t > now - windowMs && t <= now);
  if (recent.length >= limit) return { ok: false, hits: recent };
  return { ok: true, hits: [...recent, now] };
}

export function limitKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

// `rateLimits/{clé}` ; le champ expireAt sert à la politique TTL de Firestore (nettoyage automatique)
export async function hit(db: Firestore, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const ref = db.collection('rateLimits').doc(key);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? ((snap.get('hits') as number[] | undefined) ?? []) : [];
    const r = slide(prev, now, limit, windowMs);
    if (r.ok) tx.set(ref, { hits: r.hits, expireAt: Timestamp.fromMillis(now + windowMs) });
    return r.ok;
  });
}

// Compteur du jour (UTC) pour rester sous le plafond de l'offre gratuite de Brevo
export async function dailyCount(db: Firestore, cap: number, now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const ref = db.collection('rateLimits').doc('daily-' + day);
  return db.runTransaction(async tx => {
    const n = ((await tx.get(ref)).get('n') as number | undefined) ?? 0;
    if (n >= cap) return false;
    tx.set(ref, { n: n + 1, expireAt: Timestamp.fromMillis(now + 2 * 24 * HOUR) });
    return true;
  });
}
