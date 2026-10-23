# Foot à 5 — Audit et architecture cible (étape 1)

> Statut : **proposition à valider**. Aucun code de la refonte n'est écrit avant validation.
> Date : 24/10/2026. Les tarifs sont des ordres de grandeur tirés des grilles publiques ; ils sont à revérifier avant tout engagement.

## 0. En bref

- **Recommandation : garder Firebase en le restructurant.** La logique sensible passe dans des Cloud Functions, Firestore est déplacé dans une région UE, les photos vont dans Cloud Storage, et le front est réécrit en **SvelteKit + TypeScript**.
- **Coût estimé** : environ 5 €/mois à 10 000 utilisateurs, 40 €/mois à 100 000, 180 €/mois à 500 000.
  - Le seuil de 100 €/mois est atteint vers 250 000 utilisateurs. Le plan premium doit être prêt avant.
- **Pourquoi pas Supabase ?** Le SQL et le hors-fournisseur sont plus agréables. Mais l'authentification facturée par utilisateur actif ferait passer la facture à environ 1 700 €/mois à 500 000 utilisateurs. Et la migration des mots de passe est risquée.
- **Le changement le plus important ne dépend pas de la stack.** Les soldes, les paris, les votes et les stats doivent être calculés **sur le serveur**, et le client ne doit plus télécharger l'historique complet à chaque ouverture.

---

## 1. Audit de l'existant

### 1.1 Ce qui marche bien (à garder)
- Le produit lui-même : parcours complet du match (compos → live → votes → podium), le ton, le design « vert nuit », le partage WhatsApp.
- Le chrono stocké sous la forme `{start, acc}` : chaque client calcule l'heure localement, sans écriture par seconde. C'est le bon modèle de temps réel.
- La PWA avec un service worker « réseau d'abord » et le cache Firestore persistant.

### 1.2 Points faibles

| # | Sujet | Constat | Gravité | Statut |
|---|---|---|---|---|
| S1 | Soldes | `balanceOf()` est recalculé dans le navigateur à partir de tout l'historique. Le serveur ne peut pas vérifier un solde. | Critique | **Ouvert** (mise plafonnée à 1000 en attendant) |
| S2 | Paris | Mise illimitée, plusieurs paris par joueur, pari possible après un but. | Critique | Corrigé (PR règles) |
| S3 | Cotes | Calculées et écrites par le client, donc falsifiables. | Élevée | Atténué : bornées et figées. Calcul serveur à faire |
| S4 | Votes | Résultats et homme du match écrits par le client à la clôture ; plusieurs documents de vote par votant possibles. | Critique | Corrigé (clôture réservée aux admins) |
| S5 | XSS | Photo ou avatar pouvant contenir du code exécuté chez tous les membres. | Critique | Corrigé |
| S6 | E-mails | `usernames/{pseudo}` expose l'e-mail à tout utilisateur connecté. | Élevée (RGPD) | **Ouvert** (connexion par pseudo à refaire côté serveur) |
| S7 | Débit | Aucune limitation de débit : on peut deviner un mot de passe de groupe en boucle ou spammer des écritures. | Moyenne | **Ouvert** (App Check et contrôles dans les fonctions) |
| S8 | Secrets | La clé API Firebase dans le front n'est pas un secret, c'est normal. Il n'y a pas d'autre secret côté client. | — | OK |
| C1 | Coût lecture | 9 écoutes par groupe, dont 5 collections **entières et sans limite** (`players`, `matches`, `votes`, `pronos`, `shop`). Après un an, chaque ouverture lit environ 1 100 documents. | Critique à l'échelle | Ouvert |
| C2 | Coût règles | Chaque vérification `isMember()` fait 2 à 3 `get()`, facturés comme des lectures. | Moyenne | Ouvert |
| C3 | Photos | Photos en base64 dans Firestore (jusqu'à 800 Ko par document) : lecture facturée, pas de cache CDN, et le plafond de 1 Mio par document est proche. | Élevée | Ouvert |
| M1 | Maintenabilité | Un seul fichier de 250 Ko, état global `S`, HTML construit par concaténation, aucun test. | Élevée | Ouvert |
| M2 | Données legacy | Champs et chemins hérités (`adminHash`, `claims`, `orgHash`, collections racine). | Faible | Ouvert (à nettoyer à la migration) |
| R1 | RGPD | Région Firestore inconnue, pas de consentement, pas de politique de confidentialité, pas d'export. La suppression de compte existe mais elle est partielle. | Élevée | Ouvert |

### 1.3 Projection du coût si on ne change rien

Hypothèses : 20 ouvertures par utilisateur et par mois, environ 1 100 documents lus par ouverture après un an d'historique, lecture Firestore à environ 0,033 € les 100 000.

| Utilisateurs | Lectures / mois | Coût lectures seules |
|---|---|---|
| 10 000 | 220 M | ≈ 70 € |
| 100 000 | 2,2 Md | ≈ 730 € |
| 500 000 | 11 Md | ≈ **3 600 €** |

Ce coût grossit en plus chaque mois avec l'historique. **L'architecture actuelle ne passe pas l'échelle**, quel que soit le fournisseur.

---

## 2. Stacks comparées

Hypothèses communes :
- 10 utilisateurs par groupe en moyenne, 1 match par groupe et par semaine (4,3 par mois).
- Pic du soir : environ 3 000 matchs simultanés avec 8 spectateurs chacun, soit environ 24 000 connexions en direct.
- Avatars en WebP de 512 px (environ 40 Ko), photo de match d'environ 200 Ko.
- Coûts en €/mois, hors nom de domaine (environ 10 €/an).

### A. Firebase restructuré + SvelteKit (recommandé)
Firestore (région UE), Cloud Functions 2e génération en TypeScript, Cloud Storage, Firebase Hosting (CDN), Firebase Auth.

### B. Supabase (Francfort) + SvelteKit
Postgres avec RLS, fonctions SQL, Edge Functions, Realtime, Storage. Hébergement du front sur Cloudflare Pages.

### C. Cloudflare (Workers + D1 + Durable Objects + R2)
Le moins cher à l'échelle, mais l'authentification et la synchronisation hors ligne sont à construire soi-même.

| Critère | A. Firebase restructuré | B. Supabase | C. Cloudflare |
|---|---|---|---|
| **Coût à 10 k** | ≈ 0–5 € (quotas gratuits) | ≈ 23 € (Pro obligatoire pour les sauvegardes et pour éviter la mise en pause) | ≈ 5 € |
| **Coût à 100 k** | ≈ 40 € | ≈ 100–130 € (compute + Realtime) | ≈ 15 € |
| **Coût à 500 k** | ≈ **180 €** | ≈ **1 700 €** (dont environ 1 200 € d'Auth à 0,003 $/MAU au-delà de 100 k) | ≈ 60–90 € |
| Temps de dev V1 (solo) | **≈ 8–10 semaines** | ≈ 10–12 semaines (migration Auth comprise) | ≈ 14–18 semaines |
| Temps réel | Natif (`onSnapshot`), facturé à la lecture | Natif, facturé à la connexion et au message | Durable Objects + WebSocket, à coder |
| Hors ligne en lecture | **Natif** (cache persistant) | À coder (IndexedDB) | À coder |
| Stats et classements | Agrégats précalculés par des fonctions | **SQL** (vues, fonctions) : le plus confortable | SQL (SQLite) |
| Migration depuis l'existant | **Mêmes comptes, mêmes uid, aucun mot de passe à migrer** | Import des mots de passe Firebase (scrypt modifié) : risqué | Idem B, en pire |
| Dépendance fournisseur | Forte (Firestore) | Faible (Postgres standard) | Forte (runtime Workers) |
| Risques | Coût à la lecture si on relâche la discipline ; NoSQL pour les stats | Facture Auth et Realtime ; montée en compute manuelle | Plafond de 10 Go par base D1 ; beaucoup de code « plomberie » |

### Choix recommandé : A
1. **Coût** : c'est la seule option dans le budget à chaque palier (≤ 25 € à 10 k, < 100 € jusqu'à environ 250 k), avec une authentification gratuite.
2. **Migration sans perte** : les utilisateurs gardent leur compte et leur mot de passe. On peut créer une nouvelle base Firestore UE **dans le même projet** et faire tourner les deux en parallèle.
3. **Moins de code** : le temps réel et le hors ligne sont fournis. Le temps gagné va dans la logique serveur et les tests.

La dépendance au fournisseur est le prix à payer. On la limite ainsi : toute la logique métier va dans un paquet TypeScript pur (`packages/domain`), sans import Firebase, testable et réutilisable si on change un jour de base.

> ⚠️ **À vérifier** : la gratuité de Firebase Auth (e-mail et anonyme) suppose de **ne pas** passer à « Identity Platform ». Avec Identity Platform, le coût serait d'environ 0,005 $/MAU au-delà de 50 000. On n'activera aucune fonction qui l'impose (MFA, SAML…).

### Front : SvelteKit + TypeScript
- **Peu de code** : les composants Svelte ressemblent au HTML/CSS actuel, sans les hooks ni l'état complexe de React. C'est la courbe la plus douce pour reprendre `index.html` écran par écran.
- **Rapide** : le framework est compilé, donc peu de JavaScript est envoyé. C'est ce qu'il faut pour un premier affichage en moins de 2 s en 4G et un score Lighthouse ≥ 90.
- **Simple à déployer** : un seul projet donne l'app (SPA statique) et les pages publiques prérendues pour le SEO, servies par Firebase Hosting, sans serveur Node à maintenir. Next.js tirerait vers un serveur, et donc vers Vercel.

---

## 3. Architecture cible

```
Navigateur (PWA SvelteKit, cache Firestore persistant, service worker)
   │  lectures ciblées + onSnapshot (match en direct uniquement)
   │  écritures directes « non sensibles » (buts, chrono) validées par les règles
   ▼
Firestore (europe-west9 Paris) ◄──── Cloud Functions (europe-west9, TypeScript)
   ▲                                   • appelables : créer match, parier, acheter,
   │                                     terminer, clôturer votes, rejoindre groupe…
Cloud Storage + CDN Hosting            • déclencheurs : agrégats de stats, nettoyage
(avatars, photos WebP)                 • planifiées : clôture auto des votes, purge RGPD
```

### 3.1 Modèle de données (Firestore)

Principes :
- **Une ouverture d'app lit 10 à 20 documents, pas l'historique.**
- Tout ce qui touche à l'argent virtuel ou au classement est écrit **uniquement par les fonctions**.
- Les identifiants sont déterministes quand l'unicité compte : `{matchId}_{playerId}`.

| Chemin | Contenu | Qui écrit |
|---|---|---|
| `users/{uid}` | pseudo, langue, année de naissance (≥ 15), consentements et leur date, `groupIds[]` | l'utilisateur (champs bornés) |
| `usernames/{pseudo}` | `uid` **seulement** (plus d'e-mail) | fonction `register` |
| `groups/{g}` | nom, `ownerId`, offre (`free`/`premium`), `inviteHash`, réglages, compteurs | fonctions et admins (champs bornés) |
| `groups/{g}/members/{uid}` | `role` (owner/admin/member/spectator), `playerId`, `joinedAt` | fonction `joinGroup`, admins pour le rôle |
| `groups/{g}/players/{pid}` | nom, `uid?`, invité, note de départ, `avatarPath` | membres (nom/invité), admins |
| `groups/{g}/matches/{mid}` | date, statut, équipes, cotes, score, `goals[]` (≤ 60), chrono, résultats, MOTM | membres : buts et chrono pendant le live ; fonctions : le reste |
| `groups/{g}/matches/{mid}/votes/{pid}` | notes, commentaires | le votant, pendant les votes ; lisible par le votant et les admins jusqu'à la clôture |
| `groups/{g}/matches/{mid}/bets/{pid}` | choix, mise, gain | fonction `placeBet` |
| `groups/{g}/wallets/{pid}` | `balance`, `version` | **fonctions uniquement** |
| `groups/{g}/ledger/{id}` | `pid`, `delta`, `reason` (match, victoire, mvp, pari, boutique, reset), `ref`, `at` | **fonctions uniquement**, ajout seul |
| `groups/{g}/cosmetics/{id}` | article, acheteur, cible, fin | fonction `buyItem` |
| `groups/{g}/stats/summary` | une ligne par joueur : matchs, V/N/D, buts, passes, note moyenne, MOTM, forme, badges | fonction à la clôture |
| `groups/{g}/stats/pairs` | face-à-face (≤ 60 joueurs actifs, soit environ 1 800 paires) | fonction à la clôture |
| `groups/{g}/seasons/{s}` | même format que `summary`, par saison (V2) | fonction |
| Storage `avatars/{g}/{pid}.webp`, `photos/{g}/{mid}.webp` | images de 512 px et 1 280 px max | membre (règles Storage : ≤ 1 Mo, `image/*`) |

**Index composites** (`firestore.indexes.json`) :
- `matches` : `status ASC, date DESC` pour le match courant et l'historique filtré.
- `matches` : `date DESC` avec pagination par 20 (`startAfter`).
- `ledger` : `pid ASC, at DESC` pour le détail du solde.
- Groupe de collections `members` : `uid ASC` pour « mes groupes », en secours de `users.groupIds`.

### 3.2 Où vit la logique sensible

Tout ce qui suit s'exécute dans des fonctions appelables, avec vérification du rôle, validation des entrées (zod), App Check et **transaction Firestore**.

| Fonction | Ce qu'elle garantit |
|---|---|
| `createMatch` | Calcule les cotes **côté serveur** à partir de `stats/summary`, puis les fige |
| `placeBet` | Vérifie que le match est ouvert, sans chrono ni but, et que `mise ≤ solde` ; débite le portefeuille et écrit le journal dans la même transaction |
| `buyItem` | Prix lu côté serveur ; vérifie et débite le solde ; écrit le journal |
| `endMatch` | Score et vainqueur (membres), passage en votes |
| `closeVotes` | Moyennes (1–10, hors auto-notation), MOTM, gains du match, règlement des paris, mise à jour de `stats/*`. **Idempotente** : écritures identifiées par `ref = matchId` |
| `reopenMatch` | Admin : écrit des lignes inverses dans le journal (on ne supprime jamais), recalcule les stats |
| `resetBalances` | Admin : lignes « reset » dans le journal |
| Planifiée toutes les heures | **Clôture automatique des votes 48 h après la fin du match** : supprime la dépendance à un admin, introduite par le correctif |

Calculs (statistiques, cotes, équilibrage, notes, badges) : ce sont des **fonctions pures** dans `packages/domain`, testées unitairement, utilisées par le serveur et par le client (aperçu uniquement).

### 3.3 Temps réel du match en direct
- Le client n'écoute que **le document du match en cours** et `groups/{g}` pendant le live. Tout le reste est lu à la demande et servi par le cache.
- Le chrono reste au format `{start, acc}` (aucune écriture par seconde). Les buts sont ajoutés avec `arrayUnion` sur le document du match.
- Coût : environ 30 événements par match × 8 spectateurs, soit environ 250 lectures par match. Ça fait environ 50 M lectures par mois à 500 k utilisateurs, donc environ 17 €.
- Hors connexion, les buts sont mis en file par le SDK et envoyés au retour du réseau, comme aujourd'hui.

### 3.4 Cache et stats
- `stats/summary` est **précalculé** à la clôture. Les onglets Stats, Classements, Carte joueur et Équilibrage lisent **1 document** au lieu de tout l'historique.
- Les filtres avancés (période, N derniers matchs) sont recalculés côté client à partir de l'historique paginé, chargé seulement à la demande. Ils pourront devenir une fonction « premium » plus tard.
- Côté cache :
  - Firestore `persistentLocalCache` sert la lecture hors ligne.
  - Le service worker (Workbox) précharge l'app shell.
  - Les images sont servies par le CDN avec `Cache-Control: immutable` et un nom versionné.

### 3.5 Sécurité
- Les règles lisent **un seul** document (`members/{uid}`) pour le rôle : moins de lectures facturées.
- **App Check** (reCAPTCHA v3, jeton de 24 h) bloque les scripts hors de l'app.
- **Limitation de débit** dans les fonctions, avec un compteur par uid et par action (par exemple 10 tentatives de mot de passe de groupe par heure).
- Connexion par pseudo : une fonction vérifie le mot de passe et renvoie un *custom token*. L'e-mail ne sort jamais du serveur.
- Aucun secret dans le front. Les clés de service sont dans GitHub Actions (OIDC) et Secret Manager.

---

## 4. RGPD et cadre légal

- **Hébergement en UE** : Firestore, Functions et Storage en `europe-west9` (Paris).
  - Si la base actuelle est en `nam5` (États-Unis), la migration crée une **nouvelle base UE dans le même projet**.
  - Firebase Auth reste un service mondial de Google : à déclarer dans la politique de confidentialité, sous les clauses contractuelles types.
- **Âge** : 15 ans et plus. À l'inscription, l'utilisateur déclare son année de naissance ; sous 15 ans, le compte est refusé et rien n'est stocké.
- **Consentement** : aucune donnée non nécessaire sans opt-in. La mesure d'audience est exemptée de consentement si elle respecte la recommandation CNIL (sans cookie, auto-hébergée ou proxifiée).
- **Droits** :
  - export JSON de mes données (fonction `exportMyData`) ;
  - suppression du compte (fonction `deleteMyAccount`) : le joueur reste dans l'historique du groupe, rendu anonyme (« Ancien joueur »).
- **Durées de conservation** :
  - comptes inactifs : 3 ans, après un e-mail de prévenance ;
  - journaux techniques : 30 jours ;
  - comptes anonymes : 90 jours ;
  - sauvegardes : 30 jours.
- **Mentions légales** : comme particulier, tu peux publier seulement le nom de l'hébergeur et confier ton identité à l'hébergeur (LCEN, art. 6-III-2).

### Monnaie virtuelle : risques et garde-fous
- En droit français, un jeu d'argent suppose **un sacrifice financier, du hasard et une espérance de gain**. Sans achat ni retrait en argent réel, les Ballons d'or n'en sont pas un.
- **Règle d'or : le premium ne doit jamais donner de Ballons d'or**, ni un avantage aux paris. Il donne seulement des cosmétiques et des stats. Ni coffre aléatoire payant, ni échange entre joueurs.
- Vocabulaire : utiliser « pronostics » plutôt que « paris » dans l'interface, et afficher la mention « monnaie fictive, sans valeur ».
- Stores (plus tard) : l'App Store classe le « jeu d'argent simulé » en 17+ ; Google Play impose de le déclarer dans le questionnaire de classification. Rien ne bloque pour la PWA.

---

## 5. Coûts détaillés de l'option A

| Poste | 10 k | 100 k | 500 k |
|---|---|---|---|
| Firestore lectures (≈ 400 par utilisateur et par mois) | 0 € (quota gratuit) | 13 € | 65 € |
| Firestore écritures et stockage | 0 € | 4 € | 20 € |
| Cloud Functions | 0 € | 5 € | 25 € |
| Storage et CDN images | 0 € | 6 € | 35 € |
| Hosting (app et pages publiques) | 0 € | 7 € | 30 € |
| Monitoring (Sentry Developer, puis Team) | 0 € | 0 € | 26 € |
| Domaine | 1 € | 1 € | 1 € |
| **Total** | **≈ 1–5 €** | **≈ 36–45 €** | **≈ 170–200 €** |

- **Garde-fous** : alertes de budget GCP à 10, 25, 50 et 100 €, et un tableau de bord des lectures par écran.
- **Monétisation** : déclenchée **avant 100 €/mois**, soit vers 250 000 utilisateurs.
  - Premium par groupe à environ 2,99 €/mois.
  - Ça laisse environ 2,20 € net par groupe après TVA et frais Stripe.
  - Il suffit d'environ **90 groupes payants sur 50 000 (0,2 %)** pour couvrir 200 €/mois.

---

## 6. Comptes à créer, et quand

| Quand | Compte | Pourquoi | Coût |
|---|---|---|---|
| Étape 2 (migration) | **Facturation Blaze** sur le projet Firebase existant | Cloud Functions et base UE | 0 € au départ, avec alertes de budget |
| Étape 3 (V1) | **Nom de domaine** | URL propre, e-mails, SEO | ≈ 10 €/an |
| Étape 4 | **Sentry** (offre Developer) | Erreurs et performance | 0 € |
| Étape 4 | Projets Firebase `foot5-dev` et `foot5-staging` | Environnements séparés | 0 € |
| V2 | Stripe | Premium | Commission seulement |

Vercel, Cloudflare et Supabase ne sont **pas nécessaires** avec l'option A.

---

## 7. Feuille de route (rappel)

1. ✅ Correctif urgent des règles (PR `fix/regles-firestore`)
2. **Cette étape** : audit et architecture → validation
3. Plan de migration détaillé : base UE en parallèle, script d'import idempotent, double écriture, retour arrière
4. V1 à parité : SvelteKit, composants du thème « vert nuit », fonctions serveur
5. Industrialisation : TypeScript strict, Vitest et Playwright, CI/CD dev/staging/prod, Sentry, sauvegardes planifiées (export Firestore quotidien, 30 jours)
6. V2 : notifications push, saisons, onboarding en moins de 30 s, partage, page publique, mesure d'audience CNIL

## 8. Décisions à valider

1. Stack A (Firebase restructuré) + SvelteKit : **oui / non**
2. Région `europe-west9` (Paris)
3. Clôture automatique des votes 48 h après le match
4. Votes visibles par tous seulement **après** la clôture (aujourd'hui, visibles en direct)
5. Mise maximale de 1000 conservée comme règle du jeu
6. « Paris » renommé « Pronostics » dans l'interface
