// Cloud Functions d'EZFOOT : e-mails d'authentification envoyés depuis noreply@ezfoot.app
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineInt, defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { asLang } from './actionUrl.js';
import { MIN_RESPONSE_MS, TooMany, atLeast, requestPasswordReset as reset, sendVerificationEmail as verify, type Deps } from './core.js';
import { BrevoMailer, LogMailer } from './mailer.js';

initializeApp();

const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
const EMAIL_DAILY_CAP = defineInt('EMAIL_DAILY_CAP', { default: 250 });
const OPTS = { region: 'europe-west1', secrets: [BREVO_API_KEY], maxInstances: 10, memory: '256MiB' as const };

function deps(): Deps {
  const emulated = process.env.FUNCTIONS_EMULATOR === 'true';
  return {
    db: getFirestore(),
    auth: getAuth(),
    mailer: emulated ? new LogMailer() : new BrevoMailer(BREVO_API_KEY.value()),
    dailyCap: EMAIL_DAILY_CAP.value(),
  };
}

// « Mot de passe oublié » : pseudo ou adresse, sans être connecté
export const requestPasswordReset = onCall(OPTS, async req => {
  const data = (req.data ?? {}) as { id?: unknown; lang?: unknown };
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  if (!id || id.length > 254) throw new HttpsError('invalid-argument', 'Pseudo ou e-mail requis.');
  await atLeast(MIN_RESPONSE_MS, async () => {
    try { await reset(deps(), id, asLang(data.lang), req.rawRequest.ip ?? 'inconnue') }
    catch (e) { logger.error('requestPasswordReset', e) }
  });
  return { ok: true };
});

// Vérification de l'adresse du compte connecté (après inscription, ou « renvoyer »)
export const sendVerificationEmail = onCall(OPTS, async req => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    return { status: await verify(deps(), uid, asLang((req.data as { lang?: unknown } | undefined)?.lang)) };
  } catch (e) {
    if (e instanceof TooMany) throw new HttpsError('resource-exhausted', 'Trop de demandes, réessaie dans une heure.');
    logger.error('sendVerificationEmail', e);
    throw new HttpsError('internal', 'Envoi impossible pour le moment.');
  }
});
