// Transforme le lien produit par Firebase (…firebaseapp.com/__/auth/action?mode=…&oobCode=…)
// en lien vers la page d'action d'EZFOOT. Seuls mode et oobCode sont conservés.
export type Lang = 'fr' | 'en';

export const ACTION_PAGE = 'https://ezfoot.app/auth/action';
const MODES = new Set(['resetPassword', 'verifyEmail', 'verifyAndChangeEmail']);

export function toEzfootActionUrl(firebaseLink: string, lang: Lang, base = ACTION_PAGE): string {
  const src = new URL(firebaseLink);
  const mode = src.searchParams.get('mode') ?? '';
  const oobCode = src.searchParams.get('oobCode') ?? '';
  if (!MODES.has(mode) || !oobCode) throw new Error('Lien Firebase inattendu');
  const out = new URL(base);
  out.searchParams.set('mode', mode);
  out.searchParams.set('oobCode', oobCode);
  out.searchParams.set('lang', lang);
  return out.toString();
}

export function asLang(v: unknown): Lang {
  return v === 'en' ? 'en' : 'fr';
}
