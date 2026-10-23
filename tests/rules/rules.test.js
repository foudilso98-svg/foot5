// Tests des règles Firestore (émulateur) : npm test
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, describe, it } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';

const G = 'groups/g1/';
const now = () => Date.now();
const ODDS = { A: 2.58, N: 3.32, B: 2.58 }; // computeOdds() pour deux équipes égales
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
let env;

const user = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();
const anon = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-foot5',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore(), put = (p, d) => setDoc(doc(db, p), d);
    await put('groups/g1', { name: 'Les Poteaux', k: 'K', owner: 'owner', admins: ['adm', 'adm2'], roles: 2 });
    for (const u of ['owner', 'adm', 'adm2', 'alice', 'bob', 'carl', 'visitor']) await put(G + 'members/' + u, { k: 'K' });
    for (const u of ['owner', 'alice', 'bob', 'carl']) await put(G + 'players/p_' + u, { name: u, uid: u });
    await put(G + 'players/p_guest', { name: 'Invité', guest: true });
    const teams = { A: ['p_alice'], B: ['p_bob'] }, subs = { A: [], B: [] };
    await put(G + 'matches/open', { status: 'open', createdAt: now(), teams, subs, odds: ODDS });
    await put(G + 'matches/started', { status: 'open', createdAt: now(), teams, subs, odds: ODDS, timer: { start: now(), acc: 0 } });
    await put(G + 'matches/scored', { status: 'open', createdAt: now(), teams, subs, odds: ODDS, goals: [{ id: 'g', team: 'A', scorer: 'p_alice' }] });
    await put(G + 'matches/voting', { status: 'voting', createdAt: now(), teams, subs, odds: ODDS, score: { A: 1, B: 0 }, winner: 'A' });
    await put('players/old', { name: 'ancien' });
    await put('users/alice', { pseudo: 'alice', email: 'a@x.fr', groups: {} });
  });
});

const prono = (over = {}) => ({ matchId: 'open', voter: 'p_alice', pick: 'A', stake: 100, at: now(), ...over });
const vote = (over = {}) => ({ matchId: 'voting', voter: 'p_alice', ratings: { p_bob: 7 }, comments: {}, updatedAt: now(), ...over });

describe('anciennes collections', () => {
  it('ne sont plus lisibles', () => assertFails(getDoc(doc(anon('x'), 'players/old'))));
  it('meta/legacy n’est plus modifiable', () => assertFails(setDoc(doc(user('x'), 'meta/legacy'), { to: 'g' })));
});

describe('paris', () => {
  it('pari normal accepté', () => assertSucceeds(setDoc(doc(user('alice'), G + 'pronos/open__p_alice'), prono())));
  it('mise au-delà du plafond refusée', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/open__p_alice'), prono({ stake: 5000 }))));
  it('mise non entière refusée', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/open__p_alice'), prono({ stake: 10.5 }))));
  it('second document de pari refusé', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/bis'), prono())));
  it('pari pour un autre joueur refusé', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/open__p_bob'), prono({ voter: 'p_bob' }))));
  it('pari après le coup d’envoi refusé', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/started__p_alice'), prono({ matchId: 'started' }))));
  it('pari après un but refusé', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/scored__p_alice'), prono({ matchId: 'scored' }))));
  it('choix inconnu refusé', () => assertFails(setDoc(doc(user('alice'), G + 'pronos/open__p_alice'), prono({ pick: 'X' }))));
});

describe('matchs', () => {
  const m = (over = {}) => ({ status: 'open', createdAt: now(), date: '2026-10-24', teams: { A: ['p_alice'], B: ['p_bob'] }, subs: { A: [], B: [] }, names: {}, teamNames: { A: 'A', B: 'B' }, odds: ODDS, ...over });
  it('un membre crée un match avec des cotes cohérentes', () => assertSucceeds(setDoc(doc(user('alice'), G + 'matches/new'), m())));
  it('noms d’équipe par défaut Orange/Bleus acceptés', () => assertSucceeds(setDoc(doc(user('alice'), G + 'matches/new'), m({ teamNames: { A: 'Orange', B: 'Bleus' } }))));
  it('cotes truquées refusées', () => assertFails(setDoc(doc(user('alice'), G + 'matches/new'), m({ odds: { A: 50, N: 3.3, B: 1.05 } }))));
  it('match antidaté refusé', () => assertFails(setDoc(doc(user('alice'), G + 'matches/new'), m({ createdAt: 1000 }))));
  it('match créé déjà terminé refusé', () => assertFails(setDoc(doc(user('alice'), G + 'matches/new'), m({ status: 'closed' }))));
  it('un membre ajoute un but', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'matches/open'), { goals: [{ id: 'g1', team: 'A', scorer: 'p_alice' }] })));
  it('un membre lance le chrono', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'matches/open'), { timer: { start: now(), acc: 0 } })));
  it('un membre met en pause', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'matches/started'), { timer: { start: null, acc: 1000 } })));
  it('un membre ne remet pas le chrono à zéro', () => assertFails(updateDoc(doc(user('alice'), G + 'matches/started'), { timer: null })));
  it('un admin remet le chrono à zéro', () => assertSucceeds(updateDoc(doc(user('adm'), G + 'matches/started'), { timer: null })));
  it('un membre ne change pas les cotes', () => assertFails(updateDoc(doc(user('alice'), G + 'matches/open'), { odds: { A: 9, N: 9, B: 1.05 } })));
  it('un membre ne change pas les équipes', () => assertFails(updateDoc(doc(user('alice'), G + 'matches/open'), { teams: { A: ['p_bob'], B: ['p_alice'] } })));
  it('un membre termine le match avec un score', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'matches/open'), { status: 'voting', score: { A: 2, B: 1 }, winner: 'A', endedAt: now() })));
  it('score invalide refusé', () => assertFails(updateDoc(doc(user('alice'), G + 'matches/open'), { status: 'voting', score: { A: -1, B: 1 }, winner: 'B', endedAt: now() })));
  it('un membre ne clôture pas les votes', () => assertFails(updateDoc(doc(user('alice'), G + 'matches/voting'), { status: 'closed', results: {}, motm: ['p_alice'], closedAt: now() })));
  it('un admin clôture les votes', () => assertSucceeds(updateDoc(doc(user('adm'), G + 'matches/voting'), { status: 'closed', results: {}, motm: ['p_alice'], closedAt: now() })));
  it('un visiteur sans compte n’écrit rien', () => assertFails(updateDoc(doc(anon('visitor'), G + 'matches/open'), { goals: [] })));
});

describe('votes', () => {
  it('vote normal accepté', () => assertSucceeds(setDoc(doc(user('alice'), G + 'votes/voting__p_alice'), vote())));
  it('second document de vote refusé', () => assertFails(setDoc(doc(user('alice'), G + 'votes/bis'), vote())));
  it('se noter soi-même refusé', () => assertFails(setDoc(doc(user('alice'), G + 'votes/voting__p_alice'), vote({ ratings: { p_alice: 10, p_bob: 7 } }))));
  it('vote d’un non-participant refusé', () => assertFails(setDoc(doc(user('carl'), G + 'votes/voting__p_carl'), vote({ voter: 'p_carl' }))));
  it('vote hors période refusé', () => assertFails(setDoc(doc(user('alice'), G + 'votes/open__p_alice'), vote({ matchId: 'open' }))));
});

describe('boutique', () => {
  const buy = (over = {}) => ({ buyer: 'p_alice', target: 'p_alice', item: 'crown', cost: 1500, at: now(), ...over });
  it('couronne achetable', () => assertSucceeds(setDoc(doc(user('alice'), G + 'shop/s1'), buy())));
  it('moustache sur un pote', () => assertSucceeds(setDoc(doc(user('alice'), G + 'shop/s1'), buy({ item: 'stache', cost: 2000, target: 'p_bob' }))));
  it('achat antidaté refusé', () => assertFails(setDoc(doc(user('alice'), G + 'shop/s1'), buy({ at: 1000 }))));
  it('prix modifié refusé', () => assertFails(setDoc(doc(user('alice'), G + 'shop/s1'), buy({ cost: 1 }))));
  it('champ en trop refusé', () => assertFails(setDoc(doc(user('alice'), G + 'shop/s1'), buy({ free: true }))));
});

describe('joueurs', () => {
  it('ajouter un invité', () => assertSucceeds(setDoc(doc(user('alice'), G + 'players/p_new'), { name: 'Karim', createdAt: now(), guest: true })));
  it('renommer un autre joueur refusé', () => assertFails(updateDoc(doc(user('alice'), G + 'players/p_bob'), { name: 'Nul' })));
  it('passer un joueur en invité', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'players/p_guest'), { guest: false })));
  it('se lier à un joueur libre', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'players/p_guest'), { uid: 'alice' })));
  it('se délier (suppression de compte)', () => assertSucceeds(updateDoc(doc(user('alice'), G + 'players/p_alice'), { uid: deleteField(), guest: true })));
});

describe('meta et images', () => {
  it('config réservée aux admins', () => assertFails(setDoc(doc(user('alice'), G + 'meta/config'), { orgHash: 'x' })));
  it('un admin modifie la config', () => assertSucceeds(setDoc(doc(user('adm'), G + 'meta/config'), { orgHash: 'x' })));
  it('match en cours', () => assertSucceeds(setDoc(doc(user('alice'), G + 'meta/state'), { currentMatchId: 'open' })));
  it('prochain match', () => assertSucceeds(setDoc(doc(user('alice'), G + 'meta/next'), { at: new Date().toISOString(), place: 'Five', by: 'alice' })));
  it('photo de match valide', () => assertSucceeds(setDoc(doc(user('alice'), G + 'meta/photo_open'), { data: IMG, at: now() })));
  it('photo piégée (XSS) refusée', () => assertFails(setDoc(doc(user('alice'), G + 'meta/photo_open'), { data: 'x" onerror="alert(1)', at: now() })));
  it('avatar valide', () => assertSucceeds(setDoc(doc(user('alice'), G + 'avatars/p_alice'), { data: IMG, at: now() })));
  it('avatar piégé refusé', () => assertFails(setDoc(doc(user('alice'), G + 'avatars/p_alice'), { data: 'javascript:alert(1)', at: now() })));
});

describe('groupe et comptes', () => {
  it('un admin ne peut pas exclure le créateur', () => assertFails(updateDoc(doc(user('adm'), 'groups/g1'), { banned: ['owner'] })));
  it('un admin ne peut pas exclure un autre admin', () => assertFails(updateDoc(doc(user('adm'), 'groups/g1'), { banned: ['adm2'] })));
  it('un admin exclut un membre', () => assertSucceeds(updateDoc(doc(user('adm'), 'groups/g1'), { banned: ['bob'] })));
  it('le créateur exclut un admin', () => assertSucceeds(updateDoc(doc(user('owner'), 'groups/g1'), { banned: ['adm'] })));
  it('profil : champ inconnu refusé', () => assertFails(updateDoc(doc(user('alice'), 'users/alice'), { role: 'admin' })));
  it('profil : groupes modifiables', () => assertSucceeds(updateDoc(doc(user('alice'), 'users/alice'), { 'groups.g1': { name: 'Les Poteaux' } })));
});
