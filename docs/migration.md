# EZFOOT — Plan de migration (étape 2)

> Statut : **proposition à valider**. Ce document décrit le plan d'exécution ; les scripts eux-mêmes seront écrits pendant l'étape 3, quand le schéma v2 existera.
> Prérequis : `docs/architecture.md` (validé le 24/10/2026).

## 0. En bref

- **On ne supprime rien.** Les données actuelles restent dans la base Firestore `(default)`. La nouvelle version écrit dans une **seconde base, `ezfoot`, dans le même projet et la même région (eur3)**. Revenir en arrière revient à rouvrir l'ancienne.
- **Une seule source de vérité à chaque instant.** Avant la bascule, c'est la v1, recopiée en continu vers la v2. Après la bascule, c'est la v2, et la v1 passe en lecture seule pendant 30 jours.
- **Tout le monde garde son compte, y compris les comptes anonymes.** Un jeton de transfert à usage unique fait passer la session de github.io vers ezfoot.app avec le même uid.
- **Rien ne bascule sans vérification chiffrée.** Le nombre de documents, chaque solde de Ballons d'or et chaque statistique doivent être identiques entre la v1 et la v2.
- **Coût de la migration : environ 0 à 2 €.**

## 1. Calendrier

| Quand | Phase | Durée |
|---|---|---|
| **Dès la validation de ce plan** | 0. Passage en Blaze, garde-fous de budget, sauvegardes automatiques | 1 h, de ton côté |
| Dès la validation de ce plan | 1. Première sauvegarde complète, déplacement de l'ancien site sur la branche `gh-pages` | 1 h |
| Pendant l'étape 3 (V1) | 2. Script de migration, testé en staging | inclus dans la V1 |
| Quand la V1 est à parité | 3. Double fonctionnement : bêta sur beta.ezfoot.app | 2 semaines, au moins 2 vrais matchs |
| J0, un jour sans match | 4. Bascule vers ezfoot.app | ≈ 2 h |
| J0 → J+30 | 5. Ancien site en lecture seule, retour arrière possible | 30 jours |
| J+30 | Fin : l'ancien site devient une simple redirection | 15 min |

---

## 2. Phase 0 : passage à l'offre Blaze et garde-fous

**Pourquoi maintenant ?**
- L'export Firestore, les sauvegardes planifiées et les Cloud Functions exigent l'offre Blaze.
- En passant tout de suite, la production actuelle est sauvegardée chaque jour **avant** d'écrire la moindre ligne de V1.
- Tant qu'on reste dans les quotas gratuits, la facture est de **0 €** : ils sont identiques à ceux de Spark.

**Ce que tu fais (environ 20 min) :**
1. Console Firebase → ⚙️ → *Utilisation et facturation* → *Détails et paramètres* → **Modifier l'offre → Blaze**. Crée un compte de facturation en **EUR**.
2. Console Google Cloud → *Facturation* → *Budgets et alertes* → **Créer un budget** :
   - champ d'application : le projet `foot5-68b18` uniquement ;
   - montant : **25 €/mois**, ton plafond ;
   - seuils d'alerte par e-mail : **10 €** (montant réel), 20 € et 25 € ;
   - cocher *Associer un sujet Pub/Sub* et créer le sujet `budget-alerts` (c'est lui qui déclenche le plafond automatique, voir plus bas).
3. Firestore → *Reprise après sinistre* :
   - activer **la récupération à un instant donné** (PITR, 7 jours) ;
   - créer **deux planifications de sauvegarde** : quotidienne (conservée 7 jours) et hebdomadaire (conservée 14 semaines).

**Ce que je prépare : le plafond.**

Un budget Google Cloud **prévient, il ne bloque pas**. Il existe une recette Google qui détache automatiquement le compte de facturation, mais Google prévient qu'elle peut **arrêter tous les services et supprimer des ressources**. On ne prend pas ce risque avec la base de production. Le plafond repose plutôt sur trois verrous qui **bornent l'usage sans toucher aux données** :

1. **Des quotas d'API sur Firestore.** Dans Google Cloud → *IAM et administration* → *Quotas*, on plafonne le nombre de requêtes Firestore par minute.
   - La limite est réglée pour qu'une journée entière à ce rythme ne dépasse pas environ 1 €, avec une marge de ×10 sur l'usage réel.
   - Au-delà, les requêtes sont refusées, mais rien n'est facturé et rien n'est perdu.
   - On relève la limite à mesure que le nombre d'utilisateurs augmente.
2. **Un interrupteur d'urgence.** Une fonction `budgetGuard` écoute le sujet `budget-alerts`.
   - À 25 €, elle écrit `ops/killswitch = true` et réduit les fonctions au minimum.
   - Les fonctions renvoient alors « service en pause », et l'app passe en lecture seule.
   - Tu le remets à `false` en un clic.
3. **Des limites de structure** :
   - chaque fonction a un nombre maximal d'instances (`maxInstances`), à 10 par défaut ;
   - App Check bloque les appels qui ne viennent pas de l'app ;
   - la conception à 10–20 lectures par ouverture empêche les boucles coûteuses.

| Risque | Parade |
|---|---|
| Une facture surprise (boucle de lectures, abus) | Quotas d'API, alerte à 10 €, interrupteur à 25 €, `maxInstances`, App Check |
| L'interrupteur met l'app en lecture seule | Alerte à 10 € pour agir avant ; remise en route en un clic |
| Un quota trop serré bloque l'app un soir de pic | Marge de ×10, vérification mensuelle des pics, relevé avant chaque palier de croissance |
| L'alerte arrive avec quelques heures de retard (délai de facturation Google) | Les seuils à 10 € et 20 € servent de marge, et les quotas bornent l'usage en temps réel |

---

## 3. Phase 1 : sauvegardes complètes

Il y aura **trois sauvegardes complètes** :
- **S0** dès la phase 0 ;
- **S1** juste avant la bêta (J-14) ;
- **S2** pendant la bascule, juste avant d'ouvrir l'écriture en v2.

Elles s'ajoutent aux sauvegardes automatiques.

| Élément | Comment | Où |
|---|---|---|
| Firestore `(default)` | `gcloud firestore export gs://ezfoot-backups/AAAA-MM-JJ-sN` | bucket en région UE, conservé 1 an |
| Comptes Firebase Auth (avec empreintes des mots de passe) | `firebase auth:export auth-sN.json` et les paramètres de hachage | **archive 7z chiffrée (AES-256) sur ton disque, jamais dans git ni dans le cloud public** |
| Code de l'ancien site | tag git `v1-final` | GitHub |
| Images en base64 | incluses dans l'export Firestore | — |

**Vérification de chaque sauvegarde** : réimport dans l'émulateur Firestore, puis comparaison du nombre de documents par collection avec la production. Une sauvegarde sans test de restauration ne compte pas.

**L'ancien site passe sur la branche `gh-pages`.** On réglera GitHub Pages pour servir cette branche, avec exactement les fichiers actuels. Personne ne verra de différence. Ça libère `main` pour la V1 (monorepo SvelteKit) sans casser le site en production.

---

## 4. Phase 2 : schéma v2 et script de migration

### 4.1 Où vont les données
- **Seconde base Firestore `ezfoot`**, dans le même projet et la même région (eur3).
- Les deux bases sont totalement séparées : chacune a ses propres règles, et le SDK choisit la base par son nom.
- La base `(default)` n'est **jamais modifiée** par la migration. Seule exception : ses règles passent en lecture seule pendant la phase 5.
- Coût : la base nommée ne profite pas du quota gratuit. Au volume actuel, c'est moins de 0,10 €/mois.

### 4.2 Correspondance v1 → v2

| v1 | v2 | Remarques |
|---|---|---|
| `groups/{g}` : name, owner, admins, k, banned | `groups/{g}` : name, `ownerId`, `sport: 'football'`, `defaultFormat`, `passwordHash` (= `k`), `banned` | Même id. Le format par défaut est déduit du plus grand effectif joué |
| `members/{uid}` : k, adm, auto | `members/{uid}` : `role`, `playerId` | Rôle calculé à partir de owner, admins et de l'ancien `adm` |
| `players/{pid}` | `players/{pid}` | **Mêmes ids**, toutes les références restent valides |
| `matches/{mid}` : teams, subs, teamNames | `sides.A/B` : `lineup`, `subs`, `name`, `color` | Noms vides ou « Équipe A/B » → Orange et Bleus |
| `goals[]` (`scorer: 'csc'` = but contre son camp) | `events[]` : `goal` ou `own_goal` | Minute et passeur conservés |
| `timer`, status `open` | `clock`, status `scheduled` ou `live` | `live` si le chrono a démarré |
| `winner: 'N'`, `odds.N` | `winner: 'draw'`, `odds.draw` | |
| `results`, `motm`, `score`, `names` | identiques | `names` = noms des joueurs au moment du match |
| `votes/{mid__pid}` | `matches/{mid}/votes/{pid}` | Plus `votedPids[]` sur le match |
| `pronos/{mid__pid}` | `matches/{mid}/predictions/{pid}` | Avec le gain calculé |
| Soldes calculés par `balanceOf()` | `ledger/*` (une ligne par gain, pronostic, achat, remise à zéro) + `wallets/{pid}` | L'historique complet est reconstruit, rien n'est résumé |
| `shop/{id}` | `cosmetics/{id}` + ligne de journal | |
| `avatars/{pid}`, `meta/photo_{mid}` (base64) | WebP dans R2 + `avatarKey` / `photoKey` | Base64 décodé, converti, envoyé |
| `meta/next`, `meta/state` | champs de `groups/{g}` (`nextMatch`, `currentMatchId`) | |
| `users/{uid}` : pseudo, email, groups | `users/{uid}` : pseudo, `groupIds` | **L'e-mail n'est pas copié** : il reste dans Firebase Auth |
| `usernames/{pseudo}` : uid, email | `usernames/{pseudo}` : uid | Idem |
| Calculé | `stats/all`, `stats/pairs_all` | Calculés par `packages/domain` |
| **Non migré** | collections racine d'avant les groupes, `claims`, `adminHash`, `private/admin`, `orgHash` | Restent dans `(default)`, intactes |

### 4.3 Le script (`tools/migrate`, TypeScript, firebase-admin)

| Étape | Rôle |
|---|---|
| `extract` | Lit `(default)` en **lecture seule**, depuis la production ou depuis un export |
| `transform` | Fonctions pures de `packages/domain/migration`, testées unitairement avec des jeux de données réels anonymisés |
| `load` | Écrit dans `ezfoot` avec les mêmes ids, par lots de 400, en écrasant à chaque passage. **Idempotent** : relancé 10 fois, il donne 10 fois le même résultat |
| `images` | base64 → WebP (sharp) → R2. Le nom du fichier est une empreinte du contenu, donc un fichier déjà présent n'est pas renvoyé |
| `verify` | Compare la v1 et la v2, puis produit un rapport (voir 4.4) |

Le mode `--dry-run` produit le rapport sans rien écrire. L'ordre d'exécution est toujours : **émulateur → staging (avec un export réel) → production**.

### 4.4 Critères de validation (« go / no-go »)

Pour obtenir les valeurs de référence, on exécute le code **actuel** de `index.html` (fonctions `balanceOf`, `computeStats`, `pronoStats`) dans Node sur les mêmes données.

| Contrôle | Seuil |
|---|---|
| Nombre de documents par collection et par groupe | 100 % identique (hors « non migré ») |
| Solde de chaque joueur : `wallets` v2 = `balanceOf()` v1 | **égalité stricte**, au Ballon d'or près |
| Stats de chaque joueur (matchs, V/N/D, buts, passes, note moyenne, MOTM) | égalité, à 0,01 près pour la note |
| Images | 100 % des clés R2 répondent HTTP 200 |
| Liens d'invitation au format v1 (`#g=…&k=…`) | ils ouvrent bien le groupe en v2 |

---

## 5. Phase 3 : double fonctionnement (bêta, environ 2 semaines)

- **La v1 reste la source de vérité.** Tout le monde continue à jouer sur `foudilso98-svg.github.io/foot5`.
- **Synchronisation continue v1 → v2.**
  - Une fonction `syncV1` réagit à chaque écriture dans `(default)/groups/**`, applique la même transformation que le script et recalcule les stats du groupe concerné.
  - Chaque nuit, le script complet est relancé, puis `verify` envoie son rapport par e-mail.
- **Bêta sur `beta.ezfoot.app`** (Cloudflare Pages), avec 3 à 5 potes volontaires.
  - Les vrais groupes y sont **en lecture seule**, pour éviter toute écriture concurrente.
  - Un groupe bac à sable permet de tout tester en écriture.
- Pour sortir de la bêta, il faut :
  - au moins 2 vrais matchs synchronisés sans écart ;
  - aucune erreur bloquante dans Sentry ;
  - la connexion testée sur 3 types de comptes (e-mail, pseudo, anonyme).

---

## 6. Phase 4 : bascule (J0)

**Préparation (J-7 à J-1)**
- **DNS Cloudflare** :
  - `ezfoot.app` pointe vers Pages, et `www` redirige vers `ezfoot.app` ;
  - `ezfoot.com` et `scorefootballdata.com` redirigent en 301 via une Redirect Rule gratuite.
- **Firebase** :
  - ajouter `ezfoot.app` et `beta.ezfoot.app` aux domaines autorisés d'Auth et aux référents de la clé API ;
  - pointer les modèles d'e-mail (mot de passe oublié) vers `ezfoot.app`.
- **J-3** : message WhatsApp au groupe, avec la date, ce qui change et le fait que tout le monde garde son compte et ses Ballons d'or.

**J0, dans l'ordre** (≈ 2 h, un jour sans match)

| # | Action | Contrôle |
|---|---|---|
| 1 | Déployer sur `gh-pages` la v1 avec un bandeau « EZFOOT arrive dans 1 h » | Le bandeau est visible |
| 2 | **Gel de la v1** : règles `(default)` en lecture seule (`allow write: if false`) | Une écriture de test est refusée |
| 3 | Sauvegarde **S2** (Firestore + Auth) | Export terminé et restauration testée |
| 4 | Dernier passage du script, puis `verify` | **Go / no-go** : 100 % des critères du 4.4. Sinon, on lève le gel, on s'arrête et on revient au point de départ |
| 5 | Arrêter `syncV1`, ouvrir l'écriture sur la base `ezfoot` | Un pronostic de test est accepté en v2 |
| 6 | Mettre `ezfoot.app` en production | Le site répond, Lighthouse ≥ 90 |
| 7 | Déployer sur `gh-pages` la page de transfert (voir plus bas) | Test sur 3 téléphones (e-mail, pseudo, anonyme) |
| 8 | Message WhatsApp « C'est en ligne », avec le lien | — |

**Transfert des sessions et des réglages vers ezfoot.app**

Le navigateur range les données par adresse de site. Une session ouverte sur github.io n'existe donc pas sur ezfoot.app. On la fait passer ainsi :
1. Sur l'ancien site, un bouton « Ouvrir EZFOOT » appelle la fonction `createTransfer`. L'utilisateur est authentifié par son jeton Firebase actuel, **même anonyme**.
2. La fonction enregistre `transfers/{empreinte}` avec l'uid, la liste des groupes (`foot5_groups`, `foot5_cur`), la langue et le thème (`foot5_lang`, `foot5_theme`). Ce document expire au bout de **10 minutes** et ne sert qu'une fois.
3. Le navigateur est redirigé vers `https://ezfoot.app/bienvenue#t=<jeton>`. Le fragment après `#` n'est jamais envoyé à un serveur.
4. La v2 appelle `redeemTransfer`, qui renvoie un *custom token* pour **le même uid** : l'utilisateur est connecté, avec ses groupes et ses réglages.
5. Les empreintes de mot de passe des groupes (`k`) restent sur le serveur. Elles ne passent jamais dans l'URL.

Les liens d'invitation v1 (`…/foot5/#g=…&k=…`) sont transmis tels quels à `ezfoot.app/rejoindre#g=…&k=…`, qui les accepte.

---

## 7. Phase 5 : ancien site en lecture seule (J0 → J+30)

- `foudilso98-svg.github.io/foot5` affiche la **v1 en lecture seule** : historique, stats et cartes restent consultables.
  - Un bandeau permanent indique « EZFOOT a déménagé », avec un bouton qui lance le transfert.
  - Les boutons d'écriture sont masqués. Les règles refusent de toute façon toute écriture.
- La surveillance quotidienne continue : erreurs Sentry, connexions réussies, rapport de cohérence de la v2.
- **À J+30**, `gh-pages` devient une page de redirection minimale, avec transfert de session et des liens d'invitation, conservée indéfiniment (GitHub Pages est gratuit).
- **La base `(default)` est conservée.** Sa suppression, ou son archivage en export puis sa suppression, ne se fera **qu'avec ton accord écrit**.

---

## 8. Retour arrière

| Fenêtre | Situation | Procédure | Durée cible |
|---|---|---|---|
| Avant J0 | La v1 est intacte et seule en production | Rien à faire. On arrête la bêta | — |
| J0, avant l'étape 5 | Rien n'a été écrit en v2 | Lever le gel de la v1 (règles du tag `v1-final`), retirer le bandeau | 10 min |
| J0 → J+30 | Des données ont été écrites en v2 | 1. Geler la v2 en lecture seule. 2. Lancer le script inverse `v2-to-v1` : il recopie dans `(default)` les matchs, votes, pronostics et achats créés depuis J0. 3. Rétablir les règles de la v1. 4. Remettre la v1 sur `gh-pages` et une page « maintenance » sur ezfoot.app | **≈ 1 h** |
| Après J+30 | Retour arrière déconseillé | Corriger en avant. Le script inverse reste disponible | — |

**Quand décide-t-on de revenir en arrière ?**
- une donnée perdue ou un solde faux pour au moins un joueur ;
- plus de 5 % des connexions qui échouent ;
- un bug qui empêche de jouer ou de voter un match.

Le script `v2-to-v1` est **testé en staging avant J0**, au même titre que le script principal.

---

## 9. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| Écart de solde après la migration (formule mal portée) | Moyenne | Comparaison stricte avec le code v1 exécuté dans Node. Aucune bascule tant qu'il reste un écart |
| Un utilisateur anonyme perd sa session | Faible | Jeton de transfert. Sinon, un admin relie le joueur au nouvel uid (fonction existante) |
| Un utilisateur ne passe jamais par l'ancien site | Moyenne | Les comptes e-mail ou pseudo retrouvent leurs groupes par `users/{uid}`. Les anonymes rejoignent avec un nouveau lien d'invitation |
| L'ancien service worker sert une version en cache | Faible | Le service worker v1 fonctionne « réseau d'abord ». La page de transfert le désinstalle (`unregister`) |
| Un match se joue pendant la bascule | Faible | J0 tombe un jour sans match, avec une annonce à J-3 |
| L'interrupteur à 25 € met l'app en lecture seule | Très faible | Alerte à 10 €, remise en route en un clic |
| Une fuite de l'export Auth (empreintes des mots de passe) | Faible | Archive chiffrée, hors cloud, supprimée après J+30 avec ton accord |

## 10. Coûts de la migration

| Poste | Coût |
|---|---|
| Exports Firestore (3 × ≈ 1 Mo) et bucket | < 0,10 € |
| Lectures et écritures du script (quelques milliers de documents par passage) | < 0,10 € |
| Base `ezfoot` pendant la bêta | < 0,10 €/mois |
| Sauvegardes planifiées et PITR | < 0,10 €/mois |
| Cloudflare Pages, R2 (< 1 Go), redirections | 0 € |
| **Total** | **≈ 0 à 2 €** |

## 11. Ce que je te demanderai, et quand

| Quand | Action (de ton côté) |
|---|---|
| Phase 0 | Passer en Blaze, créer le budget (25 €, alertes à 10, 20 et 25 €, sujet Pub/Sub), activer le PITR et les planifications de sauvegarde, appliquer les quotas Firestore (je te donne les valeurs) |
| Phase 1 | Installer Google Cloud SDK et Firebase CLI (je te donne les commandes), lancer l'export S0, conserver l'archive Auth chiffrée. Régler GitHub Pages sur la branche `gh-pages` |
| Phase 3 | Créer le projet Pages et le bucket R2 dans Cloudflare, ajouter `beta.ezfoot.app`, recruter 3 à 5 bêta-testeurs |
| J-3 | Envoyer le message d'annonce (je te le rédige) |
| J0 | Exécuter la checklist de la section 6 avec moi |
| J+30 | Valider le passage de l'ancien site en simple redirection |
