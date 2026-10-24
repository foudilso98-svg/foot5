// Parcours complets sur les émulateurs Auth + Firestore : npm run test:emu
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestPasswordReset, sendVerificationEmail, type Deps } from './core.js';
import { LogMailer } from './mailer.js';

const ON = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = 'demo-foot5';

describe.skipIf(!ON)('e-mails d’authentification (émulateurs)', () => {
  let d: Deps;
  let mailer: LogMailer;

  beforeAll(() => {
    initializeApp({ projectId: PROJECT });
  });

  beforeEach(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    mailer = new LogMailer();
    d = { db: getFirestore(), auth: getAuth(), mailer, dailyCap: 250 };
    await d.auth.createUser({ uid: 'u1', email: 'samir@exemple.fr', password: 'secret123' });
    await d.db.doc('usernames/samir').set({ uid: 'u1', email: 'samir@exemple.fr', at: Date.now() });
  });

  it('par adresse : un e-mail avec un lien ezfoot.app', async () => {
    await requestPasswordReset(d, 'samir@exemple.fr', 'fr', '1.1.1.1');
    expect(mailer.sent).toHaveLength(1);
    const e = mailer.sent[0]!;
    expect(e.to).toBe('samir@exemple.fr');
    const u = new URL(/https:\/\/ezfoot\.app\/auth\/action\S+/.exec(e.text)![0]);
    expect(u.searchParams.get('mode')).toBe('resetPassword');
    expect(u.searchParams.get('oobCode')).toBeTruthy();
  });

  it('par pseudo, quelle que soit la casse', async () => {
    await requestPasswordReset(d, 'SaMiR', 'en', '1.1.1.1');
    expect(mailer.sent[0]?.subject).toBe('Reset your EZFOOT password');
  });

  it('compte inconnu : rien n’est envoyé, aucune erreur', async () => {
    await requestPasswordReset(d, 'personne@exemple.fr', 'fr', '1.1.1.1');
    await requestPasswordReset(d, 'inconnu', 'fr', '1.1.1.1');
    expect(mailer.sent).toHaveLength(0);
  });

  it('3 demandes par adresse et par heure, pseudo et adresse confondus', async () => {
    for (const [i, id] of ['samir', 'samir@exemple.fr', 'SAMIR@exemple.fr', 'samir'].entries()) {
      await requestPasswordReset(d, id, 'fr', '10.0.0.' + i);
    }
    expect(mailer.sent).toHaveLength(3);
  });

  it('10 demandes par IP et par heure', async () => {
    for (let i = 0; i < 12; i++) await requestPasswordReset(d, `x${i}@exemple.fr`, 'fr', '9.9.9.9');
    const snap = await d.db.collection('rateLimits').get();
    const ipDoc = snap.docs.find(x => (x.get('hits') as number[]).length === 10);
    expect(ipDoc).toBeDefined();
    expect(snap.docs.every(x => !JSON.stringify(x.data()).includes('exemple.fr'))).toBe(true);
  });

  it('plafond quotidien respecté', async () => {
    d.dailyCap = 1;
    await d.auth.createUser({ uid: 'u2', email: 'deux@exemple.fr', password: 'secret123' });
    await requestPasswordReset(d, 'samir@exemple.fr', 'fr', '1.1.1.1');
    await requestPasswordReset(d, 'deux@exemple.fr', 'fr', '1.1.1.2');
    expect(mailer.sent).toHaveLength(1);
  });

  it('vérification : envoyée, puis « déjà vérifiée »', async () => {
    expect(await sendVerificationEmail(d, 'u1', 'fr')).toBe('sent');
    expect(mailer.sent[0]?.text).toContain('mode=verifyEmail');
    await d.auth.updateUser('u1', { emailVerified: true });
    expect(await sendVerificationEmail(d, 'u1', 'fr')).toBe('already');
  });

  it('vérification : 3 par heure', async () => {
    for (let i = 0; i < 3; i++) await sendVerificationEmail(d, 'u1', 'fr');
    await expect(sendVerificationEmail(d, 'u1', 'fr')).rejects.toThrow();
  });
});
