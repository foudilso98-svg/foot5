# EZFOOT — Audit et architecture cible (étape 1)

> Statut : **proposition à valider**. Aucun code de la refonte n'est écrit avant validation.
> Date : 24/10/2026. Les tarifs sont des ordres de grandeur tirés des grilles publiques (1 $ ≈ 0,92 €). Ils sont à revérifier avant tout engagement.

## 0. En bref

**Recommandation : une stack hybride.**
- **Firebase** pour les données : Auth, Firestore eur3 (la base actuelle), Cloud Functions en TypeScript.
- **Cloudflare** pour la diffusion : Pages pour le front, R2 pour les images, DNS déjà en place.
- **Front** en SvelteKit + TypeScript.

**Pourquoi ce choix :**
- On garde les comptes, les mots de passe et la base existants, donc la migration se fait sans risque.
- On ne paie ni la bande passante du front ni celle des images.
- Coût estimé : **≈ 4 €/mois à 10 000 utilisateurs, ≈ 59 € à 100 000, ≈ 245 € à 500 000**, e-mails d'authentification compris (§3.6). Le seuil de 100 €/mois tombe vers 190 000 utilisateurs, et le premium doit être prêt avant.

**Ce qui compte le plus, quelle que soit la stack :**
- Soldes, cotes, gains, notes et homme du match calculés **sur le serveur**.
- Une ouverture d'app qui lit **10 à 20 documents** au lieu de tout l'historique.

---

## 1. Audit de l'existant

### 1.1 À garder
- Le parcours complet du match (compos → direct → votes → podium), le ton, le design « vert nuit » et le partage WhatsApp.
- Le chrono au format `{start, acc}` : chaque client calcule l'heure lui-même, sans aucune écriture par seconde. C'est le bon modèle de temps réel.
- La PWA (service worker réseau d'abord, cache Firestore persistant) et la barre de score réduite hors de l'onglet Match.

### 1.2 Failles restantes après le correctif (PR #1)

| # | Sujet | Constat | Gravité |
|---|---|---|---|
| S1 | Soldes | `balanceOf()` recalcule le solde dans le navigateur à partir de tout l'historique. Le serveur ne peut rien vérifier : un tricheur peut miser ou acheter au-delà de son solde. Le plafond est de 1000 par pari. | **Critique** |
| S2 | Cotes | Calculées par le client. Elles sont bornées et figées par les règles, mais un membre qui crée le match peut encore inverser les cotes A et B. | Élevée |
| S3 | E-mails | `usernames/{pseudo}` expose l'e-mail à tout utilisateur connecté, parce que la connexion par pseudo en a besoin. | **Élevée (RGPD)** |
| S4 | Débit | Aucune limitation : on peut tester des mots de passe de groupe en boucle ou spammer des écritures. | Moyenne |
| S5 | Invitations | Le lien d'invitation contient `k`, l'empreinte du mot de passe, qui sert elle-même d'identifiant. Le lien n'est ni révocable ni limité dans le temps, et il reste dans l'historique du navigateur ou de WhatsApp. | Moyenne |
| S6 | Clôture des votes | Réservée aux admins depuis le correctif. Si aucun admin n'est là, les votes restent ouverts. | Faible (gêne) |
| S7 | Origine | La liste des groupes, la langue, le thème et **l'identifiant des comptes anonymes** sont stockés dans le `localStorage` de `foudilso98-svg.github.io`. Ils ne suivront pas automatiquement sur ezfoot.app. | Élevée (migration) |
| S8 | Secrets | La clé API Firebase dans le front est publique par conception : rien à corriger. Il n'y a aucun autre secret côté client. | OK |

### 1.3 Coûts actuels et projection

**Aujourd'hui** : 1 groupe sur l'offre Spark, donc **0 €**. Chaque ouverture lit environ 200 documents, très loin du quota de 50 000 lectures par jour.

Le problème est structurel :
- le client écoute **5 collections entières et sans limite** (`players`, `matches`, `votes`, `pronos`, `shop`) ;
- chaque `isMember()` des règles ajoute 2 à 3 lectures facturées ;
- les photos sont stockées en base64 dans Firestore (jusqu'à 800 Ko par document), donc chaque affichage est facturé et rien n'est mis en cache sur un CDN.

Projection sans changement, avec environ 1 100 documents lus par ouverture après un an d'historique, 20 ouvertures par utilisateur et par mois, et une lecture eur3 à environ 0,055 € les 100 000 :

| Utilisateurs | Lectures / mois | Coût des lectures seules |
|---|---|---|
| 10 000 | 220 M | ≈ 120 € |
| 100 000 | 2,2 Md | ≈ 1 200 € |
| 500 000 | 11 Md | ≈ **6 000 €**, et ça augmente chaque mois avec l'historique |

### 1.4 Maintenabilité
- Un seul fichier de 250 Ko, un état global `S`, du HTML construit par concaténation, aucun test de la logique métier.
- Le chiffre « 5 » et les équipes A/B sont codés en dur.
- Restent aussi des champs hérités à nettoyer pendant la migration : `adminHash`, `claims`, `orgHash`, et les collections racine d'avant les groupes.

---

## 2. Stacks comparées

Hypothèses communes :
- 10 utilisateurs par groupe, 1 match par groupe et par semaine.
- Au pic du dimanche soir, environ 3 000 matchs en direct avec 8 spectateurs chacun.
- Avatars en WebP 512 px (environ 40 Ko) et photos de match d'environ 200 Ko.
- Charge de dev estimée en jours, pour un développeur seul.

| Critère | **A. Firebase + Cloudflare** (recommandé) | B. Supabase (Francfort) + Cloudflare Pages | C. Tout Cloudflare (Workers, D1, Durable Objects, R2) |
|---|---|---|---|
| Coût à 10 k | **≈ 4 €** | ≈ 25 € (l'offre Pro est nécessaire pour les sauvegardes et pour éviter la mise en veille) | ≈ 5 € |
| Coût à 100 k | **≈ 32 €** | ≈ 100–130 € | ≈ 15 € |
| Coût à 500 k | **≈ 185 €** | ≈ **1 700 €**, dont environ 1 200 € d'Auth (0,003 $ par utilisateur actif au-delà de 100 k) | ≈ 60–100 € |
| Charge de dev V1 | **≈ 45 j** | ≈ 55 j (migration des mots de passe comprise) | ≈ 80 j (Auth, temps réel et hors ligne à écrire) |
| Temps réel | Natif (`onSnapshot`), facturé à la lecture | Natif, facturé à la connexion et au message | WebSocket sur Durable Objects, à coder |
| Hors ligne en lecture | **Natif** (cache persistant) | À coder (IndexedDB) | À coder |
| Stats et classements | Agrégats précalculés par des fonctions | **SQL**, le plus confortable | SQL (SQLite) |
| Migration | **Rien à migrer** : mêmes comptes, mêmes uid, même base | Import des mots de passe Firebase (scrypt modifié) : risqué | Idem B, plus le portage de toute la logique |
| Dépendance fournisseur | Forte (Firestore) | Faible (Postgres standard) | Forte (runtime Workers), et plafond de 10 Go par base D1 |

### Pourquoi A
1. **Budget** : c'est la seule option sous 25 € à 10 k et sous 100 € jusqu'à environ 270 k utilisateurs, avec une authentification gratuite. Cloudflare Pages et R2 suppriment les frais de bande passante, qui sont le poste qui grossit le plus vite chez Google.
2. **Migration sans perte** : la base eur3 est déjà en Europe. On transforme les données **dans le même projet**, sans changer de fournisseur ni de mot de passe.
3. **Moins de code** : le temps réel et le hors ligne sont fournis. Le temps gagné va dans la logique serveur, les tests et le RGPD.

**Garder une sortie possible** : toute la logique métier (stats, cotes, soldes, notes, équilibrage) vit dans un paquet TypeScript pur, `packages/domain`, sans aucun import Firebase. Si Firestore devenait trop cher, l'option C (en gardant Firebase Auth, qui vérifie aussi les jetons côté Workers) resterait possible sans réécrire le métier.

> ⚠️ **À vérifier** : Firebase Auth (e-mail, anonyme) reste gratuit tant qu'on **n'active pas Identity Platform**. Au-delà de 50 k utilisateurs actifs, celui-ci coûterait environ 0,005 $ par utilisateur et par mois. On n'active aucune fonction qui l'impose (MFA, SAML…).

### Front : SvelteKit + TypeScript
- **Proche de l'existant** : un composant Svelte ressemble au HTML/CSS/JS d'aujourd'hui, sans hooks ni état complexe. On peut reprendre `index.html` écran par écran.
- **Léger** : le framework est compilé et envoie peu de JavaScript. C'est ce qu'il faut pour un premier affichage en moins de 2 s en 4G et un Lighthouse ≥ 90.
- **Un seul projet** : il produit à la fois l'app (SPA statique) et les pages publiques pré-rendues pour le SEO. Il se déploie sur Cloudflare Pages sans serveur Node à maintenir.

---

## 3. Architecture cible

```
ezfoot.app (Cloudflare DNS + Pages : app SPA + pages publiques, CDN, HTTP/3)
   │
   ├─ img.ezfoot.app (R2 + cache CDN) ◄── envoi par URL signée, délivrée par une fonction
   │
   └─ Navigateur (PWA SvelteKit, cache Firestore persistant, Workbox)
        │  lectures ciblées ; onSnapshot sur le match en direct uniquement
        │  écritures directes non sensibles (événements, chrono), validées par les règles
        ▼
   Firestore eur3 ◄──── Cloud Functions 2e gén. (europe-west1, TypeScript)
   Firebase Auth         • appelables : inscription, connexion par pseudo, rejoindre un groupe,
   App Check               créer un match, pronostiquer, acheter, terminer, clôturer, export, suppression
                         • déclencheurs : agrégats de stats, nettoyage
                         • planifiées : clôture auto des votes, purge RGPD, sauvegarde quotidienne
```

### 3.1 Modèle de données : multi-formats et multi-sports

Principes :
- **Aucun « 5 » ni « A/B » figé dans le métier.** Le sport et le format sont des données. Les règles propres à chaque sport (événements possibles, nul autorisé, durée par défaut) sont décrites dans `packages/domain/sports/*.ts`. Ajouter un sport revient à ajouter un fichier de configuration, sans migration.
- **Une ouverture d'app lit 10 à 20 documents.** L'historique est paginé.
- Tout ce qui touche aux Ballons d'or ou au classement est écrit **uniquement par les fonctions**.
- L'e-mail n'existe **que dans Firebase Auth**, jamais dans Firestore.

| Chemin | Contenu | Écrit par |
|---|---|---|
| `users/{uid}` | pseudo, langue, année de naissance (≥ 15), consentements datés, `groupIds[]` | l'utilisateur (champs bornés) |
| `usernames/{pseudo}` | `uid` **uniquement** | fonction `register` |
| `groups/{g}` | nom, `sport` (`football`), `defaultFormat`, `ownerId`, offre (`free`/`premium`), réglages, compteurs, `version` | fonctions et admins (champs bornés) |
| `groups/{g}/members/{uid}` | `role` (owner / admin / member / spectator), `playerId`, `joinedAt` | fonction `joinGroup` ; les admins pour le rôle |
| `groups/{g}/invites/{id}` | empreinte du jeton, `expiresAt`, `maxUses`, `uses` | admins, via une fonction |
| `groups/{g}/players/{pid}` | nom, `uid?`, invité, note de départ, `avatarKey` | membres (nom, invité) ; admins |
| `groups/{g}/matches/{mid}` | voir le détail ci-dessous | membres pendant le direct (événements, chrono) ; fonctions pour le reste |
| `…/matches/{mid}/votes/{pid}` | notes, commentaires | le votant pendant les votes ; visible seulement du votant et des admins jusqu'à la clôture. Le compteur « X/Y ont voté » reste visible de tous grâce à `matches.votedPids[]`, que la fonction met à jour sans jamais exposer les notes |
| `…/matches/{mid}/predictions/{pid}` | choix, mise, gain | fonction `placePrediction` |
| `groups/{g}/wallets/{pid}` | `balance`, `version` | **fonctions uniquement** |
| `groups/{g}/ledger/{id}` | `pid`, `delta`, `reason` (match, victoire, mvp, prono, boutique, reset, correction), `ref`, `at` | **fonctions uniquement**, ajout seul |
| `groups/{g}/cosmetics/{id}` | article, acheteur, cible, date de fin | fonction `buyItem` |
| `groups/{g}/stats/{scope}` | `scope` = `all` ou `season_{id}`. Une ligne par joueur : matchs, V/N/D, stats d'événements, note moyenne, MOTM, forme, badges | fonction, à la clôture |
| `groups/{g}/stats/pairs_{scope}` | face-à-face, limité à 60 joueurs actifs (environ 1 800 paires) | fonction |
| `groups/{g}/seasons/{s}` | nom, dates (V2) | admins |
| R2 `a/{g}/{pid}-{v}.webp`, `p/{g}/{mid}-{v}.webp` | images de 512 px et de 1 280 px maximum | URL signée (≤ 1 Mo, `image/webp` ou `image/jpeg`) |

**Document `matches/{mid}`** :

```ts
{
  sport: 'football',
  format: { perSide: 5 | 7 | 11 | null, label: '5v5' },  // null = libre
  date: '2026-10-24', kickoffAt?: Timestamp, seasonId?: string,
  status: 'scheduled' | 'live' | 'voting' | 'closed' | 'cancelled',
  sides: {                                   // 2 côtés pour le foot ; effectifs inégaux autorisés
    A: { name: 'Orange', color: 'orange', lineup: [pid], subs: [pid] },
    B: { name: 'Bleus',  color: 'blue',   lineup: [pid], subs: [pid] },
  },
  clock: { start: number | null, acc: number },
  events: [{ id, type: 'goal' | 'own_goal' /* selon le sport */, side, pid, assistPid?, minute?, at }],  // ≤ 200
  score: { A: number, B: number }, winner: 'A' | 'B' | 'draw',
  odds: { A, draw, B },                      // calculées et figées par le serveur
  results: { [pid]: { avg, count } }, motm: [pid], closedAt?,
  schemaVersion: 2,
}
```

Pour les effectifs inégaux : la force d'une équipe est la moyenne des notes de ses joueurs, multipliée par un facteur d'effectif. Ce facteur est une fonction pure, testée, et réglable pour chaque sport. Les cotes et l'équilibrage l'utilisent tous les deux.

**Index composites** (`firestore.indexes.json`) :
- `matches` : `status ASC, date DESC` (match courant, historique filtré)
- `matches` : `seasonId ASC, date DESC` (saisons, en V2)
- `matches` : `date DESC`, paginé par 20 avec `startAfter`
- `ledger` : `pid ASC, at DESC` (détail du solde)
- groupe de collections `members` : `uid ASC` (« mes groupes », en secours de `users.groupIds`)

### 3.2 Logique sensible côté serveur

Chaque fonction est appelable. Elle vérifie le rôle, valide les entrées (zod), contrôle App Check, applique une limite de débit par uid et par action, et travaille dans une **transaction Firestore**.

| Fonction | Ce qu'elle garantit |
|---|---|
| `createMatch` | Calcule les cotes **côté serveur** à partir de `stats/all`, puis les fige |
| `placePrediction` | Le match est `scheduled`, aucun événement n'a eu lieu, et `mise ≤ solde`. Débite le portefeuille et écrit le journal dans la même transaction |
| `buyItem` | Prix lu côté serveur ; vérifie et débite le solde |
| `endMatch` | Score et vainqueur cohérents avec le sport, puis passage aux votes |
| `closeVotes` | Moyennes (1–10, sans auto-notation), MOTM, gains du match, règlement des pronostics, mise à jour de `stats/*` et de `groups.version`. **Idempotente** : une seule écriture par `ref = matchId` |
| `reopenMatch` | Admin. Écrit des lignes inverses dans le journal (on n'efface jamais), puis recalcule |
| `resetBalances` | Admin. Écrit des lignes `reset` dans le journal |
| `loginWithPseudo` | Vérifie le mot de passe côté serveur et renvoie un *custom token*. **L'e-mail ne sort jamais du serveur** |
| `joinGroup` | Mot de passe ou jeton d'invitation. 10 essais par heure au maximum |
| Planifiée (toutes les heures) | **Clôture automatique des votes 48 h après la fin du match** (règle S6). Un admin peut clôturer plus tôt avec un bouton : c'est la même fonction `closeVotes`, appelée à la main |

Les calculs eux-mêmes (stats, cotes, équilibrage, notes, badges) sont des **fonctions pures** de `packages/domain`. Elles sont couvertes par des tests unitaires. Le client les utilise aussi, mais seulement pour afficher un aperçu.

### 3.3 Temps réel du match en direct
- Le client n'écoute que **le document du match en direct** et `groups/{g}`. La barre de score réduite réutilise la même écoute.
- Le chrono reste au format `{start, acc}`. Les événements sont ajoutés avec `arrayUnion`. Hors ligne, le SDK les garde en file et les envoie au retour du réseau, comme aujourd'hui.
- Coût : environ 30 événements × 8 spectateurs, soit environ 250 lectures par match. À 500 k utilisateurs, ça fait environ 50 M lectures par mois, soit environ 28 €.

### 3.4 Cache et stats
- **Stats précalculées** : `stats/all` est recalculé à chaque clôture. Les onglets Stats, Classements, Carte joueur, Badges et Équilibrage lisent **1 document**.
- **Contrôle de version** : à l'ouverture, le client lit `groups/{g}`. Si `version` n'a pas changé, il sert les stats et l'historique depuis le cache local, sans relire Firestore. Ça devrait diviser par environ 2 les lectures restantes ; c'est une marge de sécurité qui n'est pas comptée dans les coûts.
- **Historique paginé** par 20. Les filtres avancés (période, N derniers matchs) sont calculés côté client sur les pages déjà chargées. Ils pourront devenir une fonction premium.
- **Images** : R2 servies par le CDN avec `Cache-Control: immutable`. Le nom de fichier change quand l'image change.
- **Service worker** : Workbox, avec l'app précachée et une mise à jour proposée à l'utilisateur.

### 3.5 Sécurité
- **Une seule lecture pour les droits** : les règles lisent seulement `members/{uid}` pour connaître le rôle, au lieu de 2 à 3 documents aujourd'hui.
- **App Check** (reCAPTCHA v3, jeton de 24 h) sur Firestore et sur les fonctions.
- **Turnstile** (Cloudflare, gratuit) sur l'inscription et sur « rejoindre un groupe ».
- **Limitation de débit** par uid et par action dans les fonctions (compteurs Firestore avec TTL).
- **Invitations** par jeton aléatoire, révocable, avec date d'expiration et nombre d'utilisations limité. Le mot de passe du groupe reste possible en option.
- **Aucun secret dans le front.** Les clés R2 et les comptes de service sont dans Secret Manager, et le déploiement passe par GitHub Actions en OIDC.

### 3.6 E-mails d'authentification envoyés par EZFOOT

**Problème.** Firebase refuse de modifier les modèles d'e-mail de ce projet (« Il n'est actuellement pas possible de mettre à jour les modèles d'e-mail de ce projet »). Les e-mails partent donc de `noreply@foot5-68b18.firebaseapp.com` :
- risque d'arriver en spam ;
- aucune image de marque ;
- lien vers une page `firebaseapp.com`.

**Solution.** On n'utilise plus l'envoi de Firebase. Une Cloud Function **génère le lien** avec l'Admin SDK et **envoie elle-même l'e-mail** via un service transactionnel.

| Envoi | Expéditeur | Langue | Présentation |
|---|---|---|---|
| `EZFOOT <noreply@ezfoot.app>` | « Répondre à » : `contact@ezfoot.app` | FR ou EN, selon la langue de l'utilisateur | Thème vert nuit, logo texte EZFOOT |

#### Comment ça marche

```
App (ezfoot.app)                 Cloud Function (europe-west1)                    Service d'e-mail (Brevo)
« Mot de passe oublié » ──────► requestPasswordReset(email, lang)
                                  1. App Check + Turnstile
                                  2. limite : 3/h par adresse, 10/h par IP
                                  3. compte inexistant → rien, même réponse
                                  4. generatePasswordResetLink(email)
                                  5. extrait oobCode → https://ezfoot.app/auth/action?mode=…&oobCode=…&lang=fr
                                  6. modèle FR/EN ─────────────────────────────► envoi depuis noreply@ezfoot.app
◄────── toujours : « Si le compte existe, un e-mail a été envoyé. »
```

| Fonction | Déclenchement | Lien généré (Admin SDK) |
|---|---|---|
| `requestPasswordReset` | « Mot de passe oublié », **sans être connecté** | `generatePasswordResetLink` |
| `sendVerificationEmail` | après l'inscription, ou « Renvoyer l'e-mail » ; **connecté** | `generateEmailVerificationLink` |
| `requestEmailChange` | changement d'adresse dans Réglages ; **connecté depuis moins de 5 min** | `generateVerifyAndChangeEmailLink` vers la nouvelle adresse, plus un **avis à l'ancienne adresse** |

- **Langue** : `users/{uid}.lang` si le compte existe, sinon la langue de l'interface envoyée avec la demande.
- **Service d'e-mail interchangeable** : le code n'appelle pas Brevo directement mais une interface `Mailer`. Changer de service (voir le comparatif plus bas) reste un simple réglage.

#### Page d'action sur ezfoot.app
- On ne garde que le code `oobCode` du lien produit par Firebase. Le lien envoyé pointe vers **`https://ezfoot.app/auth/action`** et n'utilise jamais la page de `firebaseapp.com`. Aucun réglage n'est nécessaire dans la console Firebase.
- La page de l'app (même design, FR/EN) utilise le SDK client :
  - **réinitialisation** : `verifyPasswordResetCode` affiche l'adresse masquée (`f•••@gmail.com`), puis `confirmPasswordReset` enregistre le nouveau mot de passe ;
  - **vérification d'adresse et changement d'adresse** : `applyActionCode`.
- Les cas d'erreur ont chacun un message clair : lien expiré (validité fixée par Firebase, environ 1 h pour un mot de passe), lien déjà utilisé, lien invalide. Chacun propose un bouton « Renvoyer un e-mail ».

#### Limitation de débit et confidentialité
- **3 demandes par adresse et par heure** pour chaque action. Le compteur est stocké dans `rateLimits/{sha256(action + adresse)}`, jamais l'adresse elle-même, et il expire grâce à la TTL de Firestore.
- **10 demandes par IP et par heure**, avec App Check et Turnstile, contre l'envoi massif d'e-mails à une victime.
- **Toujours la même réponse** : « Si le compte existe, un e-mail a été envoyé ». Le temps de réponse est aussi rendu constant (au moins 800 ms), pour ne pas révéler par le délai quels comptes existent.
- **Plafond quotidien de 250 envois**, réglable, tant qu'on est sur l'offre gratuite de Brevo (limitée à 300 par jour). Au-delà, l'app affiche la même réponse et une alerte part vers `contact@ezfoot.app`.
- **Pas de suivi** : suivi des ouvertures et des clics **désactivé** chez Brevo. Les liens ne sont pas réécrits et aucun pixel n'est ajouté (RGPD).

#### Modèles d'e-mail
- HTML en tableaux sur 600 px, styles en ligne, `color-scheme: dark`.
- Couleurs : fond `#0B0F0C`, carte `#141A16`, texte `#F2F5F0`, bouton `#3DDC84` avec texte `#06170D`.
- Logo : `https://ezfoot.app/logo-texte@2x.png`, affiché à 130 × 30.
- Une version texte brut accompagne toujours la version HTML.
- 3 modèles × 2 langues, plus l'avis de changement d'adresse.
- Ils vivent dans `packages/domain/emails` et sont couverts par des tests d'aperçu (rendu figé).

#### Comparatif des services (tarifs publics, vérifiés le 24/10/2026)

| | **Brevo** (recommandé) | Resend | Postmark |
|---|---|---|---|
| Offre gratuite | 300 e-mails par jour (≈ 9 000 par mois) | 3 000 par mois, 100 par jour | 100 par mois |
| 1 000 e-mails par mois | **0 €** | 0 $ | 15 $ (Basic, 10 000 inclus) |
| 10 000 e-mails par mois | 0 € s'ils restent sous 300 par jour, sinon ≈ 29 $ (Starter 20 000) | 20 $ (Pro, 50 000 inclus) | 15 $ |
| 100 000 e-mails par mois | ≈ 69–82 $ | 35 $ | 126–177 $ |
| Hébergement des données | **UE** (France, Allemagne, Belgique) | Envoi possible depuis l'Irlande, mais compte, métadonnées et journaux **aux États-Unis** | **États-Unis**, aucune offre UE prévue |
| Points forts | Société française, données en UE, offre gratuite large, API et SMTP | API la plus simple, le moins cher en gros volume | Meilleure réputation de délivrabilité |
| Points faibles | Plafond de 300 par jour en gratuit, plus cher en gros volume | Transfert de données hors UE | Cher en petit volume, données aux États-Unis |

**Recommandation : Brevo.**
- Les adresses e-mail des utilisateurs restent dans l'UE, sans transfert à justifier dans la politique de confidentialité.
- L'offre gratuite couvre EZFOOT jusqu'à environ 60 000 utilisateurs (≈ 0,1 e-mail par utilisateur et par mois).
- En gros volume, Resend coûte environ 2 fois moins cher. On réexaminera ce choix vers 50 000 utilisateurs, et l'interface `Mailer` rend le changement simple.
- *À vérifier à l'ouverture du compte* : si l'offre gratuite ajoute la mention Brevo dans les e-mails transactionnels, l'offre Starter (≈ 9 €/mois) la retire.

#### Risques

| Risque | Parade |
|---|---|
| Firebase envoie encore son propre e-mail « adresse modifiée » depuis `noreply@foot5…` | À vérifier en staging. L'Admin SDK ne sait pas générer le lien « annuler le changement » : notre avis à l'ancienne adresse invite à contacter `contact@ezfoot.app` et à réinitialiser le mot de passe |
| Pic d'inscriptions supérieur à 300 par jour (offre gratuite) | Plafond à 250 par jour avec alerte ; passer à Starter (≈ 9 €) en 2 minutes |
| E-mails classés en spam au début | SPF, DKIM et DMARC alignés ; test sur mail-tester.com ≥ 9/10 avant la mise en production ; DMARC durci progressivement |
| Fuite de la clé API Brevo | Clé dans Secret Manager, droits limités à l'envoi transactionnel, rotation possible à tout moment |

---

## 4. RGPD et cadre légal

**Hébergement**
- Firestore est en eur3 (Europe), Functions en europe-west1 et R2 avec juridiction UE.
- Firebase Auth et Cloudflare sont des sous-traitants mondiaux, encadrés par les clauses contractuelles types et le Data Privacy Framework. Ils sont à citer dans la politique de confidentialité.

**Âge** : 15 ans et plus.
- À l'inscription, l'utilisateur déclare son année de naissance.
- Sous 15 ans, l'inscription est refusée et rien n'est conservé.

**Consentement**
- Aucun traceur non essentiel.
- La mesure d'audience est configurée pour l'exemption CNIL (sans cookie, données agrégées, conservation de 13 mois au maximum).

**Droits des utilisateurs**
- `exportMyData` : export de toutes ses données en JSON.
- `deleteMyAccount` : supprime le compte. Le joueur reste dans l'historique du groupe sous le nom « Ancien joueur », sans lien avec la personne.

**Conservation des données**

| Donnée | Durée |
|---|---|
| Comptes inactifs | 3 ans, après un e-mail d'avertissement |
| Comptes anonymes | 90 jours |
| Journaux techniques | 30 jours |
| Sauvegardes | 30 jours |

**Mentions légales**
- Particulier non professionnel : le site publie seulement l'identité des hébergeurs (Cloudflare, Google) et `contact@ezfoot.app`.
- Ton identité est confiée aux hébergeurs uniquement (LCEN, art. 6-III-2).

### Monnaie virtuelle : risques et garde-fous
- **Jeux d'argent** : en droit français, un jeu d'argent suppose à la fois un sacrifice financier, du hasard et une espérance de gain. Sans achat ni retrait en argent réel, les Ballons d'or n'en sont pas.
- **Règle d'or** : le premium ne donne **jamais** de Ballons d'or ni d'avantage pour les pronostics. Il ne donne que des cosmétiques et des stats.
- **Ce qu'on s'interdit** : coffre aléatoire payant, échange de Ballons d'or entre joueurs, toute conversion en argent.
- **Vocabulaire** : « pronostics » plutôt que « paris », avec la mention « monnaie fictive, sans valeur ».
- **Mineurs** : le public de 15 à 17 ans est autorisé, puisqu'il n'y a pas d'argent en jeu.
  - Pas de pub pour des opérateurs de paris, et aucun partenariat de ce type.
  - L'âge déclaré est conservé pour pouvoir le prouver.
- **Stores (plus tard)** :
  - App Store : le « jeu d'argent simulé » impose une classification 17+.
  - Google Play : il faut le déclarer dans le questionnaire de classification.
  - Rien de tout ça ne bloque la PWA.
- **Nom** : vérifier que « EZFOOT » est disponible à l'INPI et à l'EUIPO (classes 9, 41 et 42) avant de lancer la communication. Coût d'un dépôt : environ 190 € pour une classe à l'INPI.

---

## 5. Coûts détaillés de l'option A

| Poste | 10 k | 100 k | 500 k |
|---|---|---|---|
| Firestore lectures (≈ 400 par utilisateur et par mois ; base `ezfoot` sans quota gratuit, voir `migration.md` 4.1) | ≈ 2 € | ≈ 22 € | ≈ 110 € |
| Firestore écritures et stockage | ≈ 1 € | ≈ 6 € | ≈ 28 € |
| Cloud Functions | 0 € | ≈ 3 € | ≈ 18 € |
| R2 (stockage, sans frais de sortie) | 0 € | ≈ 0,5 € | ≈ 2 € |
| Cloudflare Pages, DNS, Turnstile | 0 € | 0 € | 0 € |
| Sentry (Developer, puis Team) | 0 € | 0 € | ≈ 26 € |
| Domaine ezfoot.app (≈ 14 $/an) | ≈ 1 € | ≈ 1 € | ≈ 1 € |
| E-mails d'authentification (Brevo, ≈ 0,1 e-mail par utilisateur et par mois, §3.6) | 0 € (offre gratuite) | ≈ 27 € (Starter 20 000) | ≈ 60 € |
| Cloudflare Email Routing (`contact@ezfoot.app`) | 0 € | 0 € | 0 € |
| **Total** | **≈ 4 €** | **≈ 59 €** | **≈ 245 €** |

*Levier* : passer les e-mails à Resend vers 50 000 utilisateurs ramènerait ce poste à ≈ 18 €/mois (soit ≈ 50 € et ≈ 203 € au total), au prix d'un transfert de données vers les États-Unis.

**Garde-fous**
- Alertes de budget Google Cloud à 5, 25, 50 et 100 €.
- Compteur de lectures par écran, mesuré en staging.
- Plafond d'instances sur les fonctions.

**Monétisation (à préparer avant 100 €/mois, soit vers 190 k utilisateurs)**
- Premium par groupe à 2,99 €/mois TTC, soit environ 2,20 € net après TVA et frais Stripe.
- À 500 k utilisateurs (environ 50 000 groupes), il faut environ **115 groupes payants (0,25 %)** pour couvrir 250 €/mois.

---

## 6. Comptes à créer, et quand

| Quand | Compte ou action | Pourquoi | Coût |
|---|---|---|---|
| Étape 2 | Passer le projet Firebase en **Blaze** | Cloud Functions, sauvegardes planifiées | 0 € dans les quotas, avec des alertes |
| Étape 2 | **Cloudflare Pages** et **R2** (compte existant ; R2 demande une carte) | Héberger ezfoot.app et les images | 0 € |
| **Dès maintenant** | **Cloudflare Email Routing** : `contact@ezfoot.app` → `foudil.so98@gmail.com` | Recevoir les réponses et le support | 0 € |
| Étape 3 (V1), après Blaze | **Brevo** (compte particulier) avec le domaine `ezfoot.app` authentifié | E-mails d'authentification (§3.6) | 0 € jusqu'à 300 e-mails par jour |
| Étape 4 | Projets Firebase `ezfoot-dev` et `ezfoot-staging` | Environnements séparés | 0 € |
| Étape 4 | **Sentry** (offre Developer) | Erreurs et performance | 0 € |
| V2 | Google Search Console | SEO de la page publique | 0 € |
| V2 | Stripe | Premium | Commission uniquement |

Supabase et Vercel ne sont **pas nécessaires**.

---

## 7. Points de vigilance pour l'étape 2 (migration)

- **Changement de domaine** : la liste des groupes, les réglages et la session anonyme sont dans le `localStorage` de github.io (S7).
  - L'ancienne adresse sera remplacée par une page de redirection qui transmet ces données à ezfoot.app dans le fragment d'URL. Le fragment n'est jamais envoyé à un serveur.
  - Les comptes e-mail ou pseudo retrouvent leurs groupes par `users/{uid}`.
- **Sans perte** : la migration écrit le schéma v2 à côté du v1, sans rien supprimer. Les deux versions de l'app fonctionnent en parallèle, et on peut revenir en arrière en rebasculant le DNS. Le détail sera dans `docs/migration.md`.

## 8. Feuille de route
1. ✅ Correctif des règles (PR #1)
2. **Cette étape** : audit et architecture, puis validation
3. Plan de migration (`docs/migration.md`) et bascule vers ezfoot.app
4. V1 à parité, renommée EZFOOT : SvelteKit, composants du thème « vert nuit », nouveau logo, fonctions serveur, **e-mails d'authentification envoyés par EZFOOT et page d'action sur ezfoot.app** (§3.6, annexe B)
5. Industrialisation :
   - TypeScript strict
   - Vitest pour la logique métier, Playwright pour les parcours clés
   - CI/CD dev / staging / prod
   - Sentry
   - export Firestore quotidien, conservé 30 jours
6. V2 :
   - notifications push
   - saisons
   - onboarding en moins de 30 s
   - partage WhatsApp
   - page publique SEO
   - mesure d'audience exemptée de consentement

## 9. Décisions (validées le 24/10/2026)
1. ✅ Stack A : Firebase (Auth, Firestore eur3, Functions) + Cloudflare (Pages, R2) + SvelteKit
2. ✅ Clôture automatique des votes 48 h après le match, **avec un bouton admin pour clôturer avant**
3. ✅ Notes visibles par tous seulement après la clôture, **mais le compteur « X/Y ont voté » reste visible pendant les votes**
4. ✅ Mise maximale de 1000 Ballons d'or conservée comme règle du jeu
5. ✅ « Paris » renommé « Pronostics » dans l'interface
6. ✅ Invitations par jeton révocable, le mot de passe du groupe devenant facultatif
7. ✅ Passage à l'offre Blaze, avec une alerte de budget et un plafond : voir `docs/migration.md`, phase 0
8. ✅ E-mails d'authentification envoyés par EZFOOT via **Brevo**, derrière une interface `Mailer` commune pour pouvoir changer de service ; page d'action sur ezfoot.app ; `contact@ezfoot.app` via Cloudflare Email Routing (§3.6, annexe B). **Livrés avant la V1, dans l'app actuelle, juste après le passage en Blaze.**

---

## Annexe : hypothèses du coût Supabase à 500 k

**Supabase ne facture ni les lectures ni les écritures.** Il facture l'offre, la puissance du serveur (compute), les utilisateurs actifs (MAU) au-delà de 100 000, les connexions et messages Realtime, et la bande passante. Le volume de requêtes ne compte donc que pour choisir la taille du serveur.

Hypothèses : les mêmes que pour Firebase, pour pouvoir comparer.

| Hypothèse | Valeur |
|---|---|
| Utilisateurs actifs dans le mois (MAU) | **500 000**, c'est-à-dire tous les inscrits (hypothèse prudente) |
| Lectures par utilisateur et par jour | ≈ 13 requêtes (≈ 400 par mois), dont le direct |
| Écritures par utilisateur et par jour | ≈ 1 (≈ 30 par mois : votes, pronostics, buts, achats) |
| Charge moyenne / pic | 7 M requêtes par jour ≈ 80 req/s en moyenne, ≈ 800 req/s au pic du soir |
| Connexions Realtime au pic | ≈ 24 000 (3 000 matchs × 8 spectateurs) |
| Messages Realtime | ≈ 215 000 matchs par mois × 250 messages ≈ 54 M |
| Bande passante | ≈ 65 Ko par jour et par utilisateur ≈ 1 To par mois |

| Poste (tarifs publics Supabase) | Calcul | $/mois |
|---|---|---|
| Offre Pro | forfait | 25 |
| **Auth MAU** | (500 000 − 100 000 inclus) × 0,00325 $ | **1 300** |
| Compute Large (pour ≈ 800 req/s) | forfait | 110 |
| Realtime : connexions | (24 000 − 500 incluses) / 1 000 × 10 $ | 235 |
| Realtime : messages | (54 M − 5 M inclus) × 2,50 $ / M | 123 |
| Bande passante | (1 000 − 250 Go inclus) × 0,09 $ | 68 |
| **Total** | | **≈ 1 860 $ ≈ 1 710 €** |

**Ce qui fait le prix :** l'authentification représente 70 % du total.

**Avec une hypothèse plus réaliste :** si seulement 40 % des inscrits viennent chaque mois (200 000 MAU), les deux options baissent :
- Supabase passe à environ **800 €** : 325 $ d'Auth, le pic Realtime se réduisant d'autant ;
- Firebase passe à environ **80 €**.

L'écart reste d'un facteur 8 à 10, parce que Firebase Auth est gratuit (e-mail et anonyme).

**L'option « Firebase Auth + Supabase »** (authentification tierce) est possible. Mais d'après la grille actuelle, ses MAU tiers semblent facturés aussi : ça reste à vérifier avant de la retenir.

---

## Annexe B : e-mails d'EZFOOT, mise en place

### B.1 Ordre des étapes

| # | Quand | Qui | Étape | Vérification |
|---|---|---|---|---|
| 1 | **Dès maintenant**, sans code | toi | Cloudflare Email Routing : `contact@ezfoot.app` → Gmail (B.3) | Un e-mail envoyé à `contact@ezfoot.app` arrive dans Gmail |
| 2 | Après Blaze (phase 0 de la migration) | toi | Compte Brevo, authentification du domaine, DNS (B.2, B.4) | Brevo affiche « Domaine authentifié » |
| 3 | Après l'étape 2 | toi | Clé API Brevo enregistrée dans Secret Manager (B.4, point 6) | Je confirme que la fonction lit la clé en staging |
| 4 | Après ta validation | moi | Modèles FR/EN, 3 fonctions, page `/auth/action`, limitation de débit, tests | Tests unitaires et de bout en bout verts dans l'émulateur |
| 5 | En staging | toi et moi | Envoi réel vers Gmail, Outlook, iCloud et mail-tester.com | Score ≥ 9/10 ; SPF, DKIM et DMARC « PASS » dans « Afficher l'original » de Gmail |
| 6 | En production | moi | L'app appelle nos fonctions ; plus aucun appel à `sendPasswordResetEmail` | Réinitialisation de bout en bout sur ton compte |
| 7 | 4 semaines après | toi | DMARC passe de `p=none` à `p=quarantine` (B.2) | Rapports DMARC sans échec |

Les étapes 4 à 6 peuvent être livrées **avant la V1**, dans l'app actuelle : elles n'ont besoin que de Blaze et d'une petite modification de `index.html`. À toi de décider.

### B.2 Enregistrements DNS de ezfoot.app (Cloudflare → DNS → Enregistrements)

| Type | Nom | Contenu | Proxy | Qui le crée |
|---|---|---|---|---|
| MX | `@` | `route1.mx.cloudflare.net` (priorité attribuée par Cloudflare) | — | **automatique** (Email Routing) |
| MX | `@` | `route2.mx.cloudflare.net` | — | automatique |
| MX | `@` | `route3.mx.cloudflare.net` | — | automatique |
| TXT | `cf2024-1._domainkey` | clé DKIM de Cloudflare | — | automatique |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` | — | **toi** : modifie l'enregistrement SPF créé par Email Routing ; il ne doit en exister **qu'un seul** |
| TXT | `@` | `brevo-code:XXXXXXXX` (code affiché par Brevo) | — | toi |
| CNAME | `brevo1._domainkey` | `b1.ezfoot-app.dkim.brevo.com` (**valeur exacte affichée par Brevo**) | **DNS uniquement (nuage gris)** | toi |
| CNAME | `brevo2._domainkey` | `b2.ezfoot-app.dkim.brevo.com` (idem) | **DNS uniquement (nuage gris)** | toi |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com; adkim=r; aspf=r` | — | toi ; à l'étape 7, remplacer `p=none` par `p=quarantine` |

Remarques :
- **Le code Brevo et les cibles DKIM sont propres à ton compte.** Les valeurs ci-dessus montrent le format habituel. Copie celles qu'affiche Brevo, ou envoie-moi une capture et je te confirme la liste finale.
- **DKIM en un seul enregistrement** : selon la date de création du compte, Brevo peut demander un unique enregistrement TXT DKIM (`mail._domainkey`) au lieu des deux CNAME. Dans ce cas, prends celui-là.
- **CNAME DKIM proxifiés** : avec le nuage orange, l'authentification échoue. Ils doivent rester en gris.
- **SPF** : Brevo indique que SPF n'est plus nécessaire pour l'alignement. Ajouter `include:spf.brevo.com` ne coûte rien et couvre les deux cas. On reste à 2 consultations DNS sur les 10 autorisées.
- **DMARC** : une seule ligne `_dmarc`. Si Cloudflare propose « DMARC Management » (gratuit), il peut remplacer l'adresse `rua` par la sienne pour afficher les rapports dans le tableau de bord. C'est au choix.

### B.3 Cloudflare Email Routing (étape 1, ≈ 10 min)
1. Cloudflare → `ezfoot.app` → **Email** → **Email Routing** → **Commencer**.
2. **Adresse personnalisée** : `contact` → **Action** : *Envoyer vers un e-mail* → `foudil.so98@gmail.com`.
3. Cloudflare envoie un e-mail de confirmation à Gmail : clique sur le lien de validation.
4. Accepte l'ajout automatique des enregistrements MX, SPF et DKIM (**Ajouter les enregistrements et activer**).
5. Ajoute une deuxième adresse, `noreply` → *Supprimer* (*Drop*), pour que les réponses envoyées par erreur à `noreply@` soient ignorées proprement. Les vraies réponses vont vers `contact@` grâce au « Répondre à ».
6. *(Facultatif)* Pour répondre **depuis** `contact@ezfoot.app` dans Gmail : *Paramètres → Comptes → Envoyer des e-mails en tant que*, avec le SMTP de Brevo. On le fera après l'étape 2.

### B.4 Brevo (étape 2, ≈ 20 min)
1. Crée un compte sur brevo.com : **particulier**, offre **gratuite**, adresse `contact@ezfoot.app` (elle arrive déjà dans Gmail grâce à l'étape 1).
2. **Expéditeurs, domaines et IP dédiées** → **Domaines** → **Ajouter un domaine** → `ezfoot.app` → choisis **l'authentification manuelle** (garde le contrôle de ton DNS) → recopie les enregistrements dans Cloudflare (B.2) → **Vérifier**.
3. **Expéditeurs** → **Ajouter** : nom `EZFOOT`, adresse `noreply@ezfoot.app`.
4. **Transactionnel** → **Paramètres** : **désactive le suivi des ouvertures et des clics**.
5. **Paramètres** → **Clés API et SMTP** → **Générer une clé API** nommée `ezfoot-functions`. Ne la colle **nulle part** : ni dans le code, ni dans un e-mail, ni dans notre conversation.
6. Dans un terminal :
   ```
   firebase functions:secrets:set BREVO_API_KEY --project foot5-68b18
   ```
   Colle la clé quand la commande la demande. Elle est stockée dans Secret Manager (6 versions de secret gratuites, puis ≈ 0,06 $ par version et par mois).
7. Brevo → **Sécurité** → **IP autorisées** : **désactive le blocage des IP inconnues**. Les Cloud Functions n'ont pas d'adresse IP fixe. Sans ça, Brevo refuse les envois (erreur 401). La clé reste protégée par Secret Manager.
8. Console Firebase → **Firestore** → **TTL** → **Créer une règle** : groupe de collections `rateLimits`, champ `expireAt`. Les compteurs de limitation s'effacent alors tout seuls (gratuit).

### B.5 Coût mensuel

| Poste | Aujourd'hui → 10 k utilisateurs | 100 k | 500 k |
|---|---|---|---|
| Brevo | 0 € (jusqu'à 300 e-mails par jour) | ≈ 27 € | ≈ 60 € |
| Cloudflare Email Routing, DNS, DMARC Management | 0 € | 0 € | 0 € |
| Cloud Functions et Secret Manager (quelques milliers d'appels) | 0 € | < 1 € | ≈ 2 € |
| **Total e-mails** | **0 €** | **≈ 28 €** | **≈ 62 €** |
