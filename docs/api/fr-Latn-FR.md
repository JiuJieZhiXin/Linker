# Documentation de l'API

URL de base : `http://<host>:<port>/<nom-de-la-base>/api/…` (nom de base limité à `\w-` ; chaque `.db` sous `data/` est une base). Exception : l'interface de création de base est à la racine `/api/create`.

Codes de langue : `zh-Hans-CN` `zh-Hant-TW` `zh-Hant-HK` `en-Latn-GB` `en-Latn-US` `ja-Jpan-JP` `ko-Kore-KR` `th-Thai-TH` `fr-Latn-FR` `ar-Arab-SA` (dans les noms de colonnes des tables annexes l10n, le `-` devient `_`, par ex. `zh_Hans_CN`).

## En-têtes de requête

| En-tête | Obligatoire | Rôle |
|---|---|---|
| `X-Lang` | Non | Code de langue de l'interface courante : cible d'écriture du slot `value`, graine de la langue de référence à la création de la base ; valeur absente ou invalide → repli sur la langue par défaut |
| `X-Client-Id` | Non | Identifiant de client de collaboration : le serveur s'en sert pour exclure le renvoi à l'émetteur lors de la diffusion ; un client qui ne l'envoie pas reçoit les diffusions de ses propres écritures |

## Conventions générales

- Succès : `200` (`{data: …}` ou `{ok: true}`) ; création : `201 {data: …}`
- Échec : `{error: code}` (`4xx/5xx` + JSON), le code se trouve dans la ligne « Erreurs » de chaque entrée et dans le [tableau complet des codes d'erreur](#tableau-complet-des-codes-derreur) en fin de document
- **Charge utile de nom (pour la création)** `{authoritative?, value?, l10n?}` :
  - `authoritative` : valeur du slot de langue de référence, finalement obligatoirement non vide (par défaut repli sur `value`)
  - `value` : slot de la langue d'interface courante (`X-Lang` détermine dans quelle langue écrire)
  - `l10n` : `{code de langue: valeur}` fusionné slot par slot (chaînes vides ignorées)
- **Correctif de nom (pour renommage / mise à jour)** `{authoritative?, value?, l10n?}` : `l10n` fait un upsert slot par slot, **chaîne vide = effacement du slot** (sauf le slot de référence) ; si `authoritative` est présent, il doit être non vide

---

## Création de base

### 1. Créer une base de données

`POST /api/create` (à la racine, hors de toute base)

**Paramètres d'entrée** (body, `application/json` ou `application/x-www-form-urlencoded`)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `name` | string | Oui | Nom de la base, limité à `\w-` |

**Retour** : aucun corps de réponse JSON, redirection `302` systématique :

| Scénario | Location |
|---|---|
| Succès | `/<name>/` (entrée dans la nouvelle base) |
| Nom de base invalide | `/?error=illegal` |
| La base existe déjà | `/?error=exists&name=<name>` |

**Remarque** : la graine de langue de référence = le `X-Lang` du créateur.

**Erreurs** : pas via JSON, exprimées par le paramètre `error` du 302 (`illegal` / `exists`).

---

## Organisations

### 2. Arborescence des organisations

`GET /api/organizations`

**Paramètres d'entrée** : aucun

**Retour** `200` :

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**Erreurs** : `db_not_found`

### 3. Créer une organisation

`POST /api/organizations`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `parentId` | string | Non | Id de l'organisation parente ; par défaut = organisation de premier niveau |
| `index` | number | Non | Position d'insertion parmi les nœuds de même niveau (par défaut en fin) |
| `…charge utile de nom` | — | Oui | `{authoritative?, value?, l10n?}`, voir les conventions générales |

**Retour** `201` : `{"data": {"id": "uuid"}}`

**Erreurs** : `400 name_required`, `400 authoritative_required`, `404 parent_not_found`

### 4. Déplacer une organisation

`POST /api/organizations/move` (changement de parent / tri entre nœuds de même niveau ; interdiction de déplacer dans soi-même ou un descendant)

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | Oui | Id de l'organisation |
| `parentId` | string \| null | Oui | Id de la nouvelle organisation parente ; `null` = remonter au premier niveau |
| `index` | number | Non | Position dans la liste cible de même niveau |

**Retour** `200` : `{"data": {"ok": true}}`

**Erreurs** : `400 move_to_self`, `400 org_not_found`, `400 target_org_not_found`, `400 move_to_descendant`

### 5. Supprimer une organisation

`DELETE /api/organizations?id=<id>`

**Paramètres d'entrée** (query)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | Oui | Id de l'organisation |
| `promote` | `1` | Non | Par défaut : suppression récursive de tout le sous-arbre ; `promote=1` : conserve les sous-organisations, promues à la place de l'organisation supprimée |

**Retour** `200` : `{"ok": true}`

**Erreurs** : `404 org_not_found`

### 6. Renommer une organisation

`POST /api/organizations/rename`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | Oui | Id de l'organisation |
| `…correctif de nom` | — | Oui | `{authoritative?, value?, l10n?}`, voir les conventions générales |

**Retour** `200` : `{"ok": true}`

**Erreurs** : `400 authoritative_required`, `400 name_required`, `404 org_not_found`

---

## Identités

### 7. Créer une identité

`POST /api/identities`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `organizationId` | string | Oui | Id de l'organisation d'appartenance |
| `index` | number | Non | Position d'insertion dans l'organisation (par défaut en fin) |
| `…charge utile de nom` | — | Oui | Voir les conventions générales |

**Retour** `201` : `{"data": {"id": "uuid"}}`

**Erreurs** : `400 name_required`, `400 authoritative_required`, `404 org_not_found`

### 8. Trier les identités

`POST /api/identities/move` (tri au sein d'une organisation uniquement, sans changer d'organisation)

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | Oui | Id de l'identité |
| `index` | number | Oui | Nouvelle position dans l'organisation |

**Retour** `200` : `{"data": {"ok": true}}`

**Erreurs** : `400 identity_not_found`

### 9. Déplacer une identité vers une autre organisation

`POST /api/identities/move-organization`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `identityId` | string | Oui | Id de l'identité |
| `organizationId` | string | Oui | Id de l'organisation cible |
| `index` | number | Non | Position dans l'organisation cible |

**Remarque** : les affectations et les relations référencent `identity_id` sans changement et suivent automatiquement.

**Retour** `200` : `{"data": {"ok": true}}`

**Erreurs** : `400 identity_not_found`, `400 target_org_not_found`, `400 same_target_org`

### 10. Supprimer une identité

`DELETE /api/identities?id=<id>`

**Paramètres d'entrée** (query) : `id` (string, obligatoire) — id de l'identité

**Retour** `200` : `{"ok": true}` (effacement en cascade des affectations et des extrémités de relation)

**Erreurs** : `404 identity_not_found`

### 11. Renommer une identité

`POST /api/identities/rename`

**Paramètres d'entrée** (body) : `id` (string, obligatoire) + correctif de nom

**Retour** `200` : `{"ok": true}`

**Erreurs** : `400 authoritative_required`, `400 name_required`, `404 identity_not_found`

---

## Personnes

### 12. Liste des personnes

`GET /api/persons`

**Paramètres d'entrée** : aucun

**Retour** `200` : `{"data": [{"id": "uuid"}]}` (les noms sont dans la table annexe l10n, récupérés via `GET /api/l10n`)

**Erreurs** : `db_not_found`

### 13. Créer une personne (affectation en une étape possible)

`POST /api/persons`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `…charge utile de nom` | — | Oui | Voir les conventions générales |
| `identityId` | string | Non | Si fourni = « créer et affecter » en une étape à cette identité |
| `index` | number | Non | Position d'insertion dans cette identité (à utiliser avec `identityId`) |

**Retour** `201` : création pure `{"data": {"id": "uuid"}}` ; avec affectation `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**Erreurs** : `400 name_required`, `400 authoritative_required`, `404 identity_not_found`

### 14. Supprimer une personne

`DELETE /api/persons?id=<id>`

**Paramètres d'entrée** (query) : `id` (string, obligatoire) — id de la personne

**Retour** `200` : `{"ok": true}` (effacement en cascade des affectations et des relations)

**Erreurs** : `404 person_not_found`

### 15. Renommer une personne

`POST /api/persons/rename`

**Paramètres d'entrée** (body) : `id` (string, obligatoire) + correctif de nom

**Retour** `200` : `{"ok": true}`

**Erreurs** : `400 authoritative_required`, `400 name_required`, `404 person_not_found`

---

## Affectations (lien identité-personne)

### 16. Créer une affectation

`POST /api/assignments`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `personId` | string | Oui | Id de la personne |
| `identityId` | string | Oui | Id de l'identité |
| `index` | number | Non | Position d'insertion dans l'identité (par défaut en fin) |

**Remarque** : idempotent, une création répétée n'a pas d'effet de bord.

**Retour** `200` : `{"data": {"personId": "uuid", "identityId": "uuid"}}`

**Erreurs** : `404 person_or_identity_not_found`

### 17. Dissocier une affectation

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**Paramètres d'entrée** (query) : `personId`, `identityId` (tous deux obligatoires)

**Retour** `200` : `{"ok": true}` (succès retourné même si le lien n'existe pas)

**Erreurs** : aucun code d'erreur dédié

### 18. Trier les affectations

`POST /api/assignments/move`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `personId` | string | Oui | Id de la personne |
| `identityId` | string | Oui | Id de l'identité |
| `index` | number | Oui | Nouvelle position dans l'identité |

**Retour** `200` : `{"data": {"ok": true}}`

**Erreurs** : `400 assignment_not_found`

### 19. Déplacer une affectation (entre identités)

`POST /api/assignments/move-identity`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `personId` | string | Oui | Id de la personne |
| `fromIdentityId` | string | Oui | Id de l'identité d'origine |
| `toIdentityId` | string | Oui | Id de l'identité cible (même personne) |
| `index` | number | Non | Position dans l'identité cible |

**Remarque** : les extrémités de relation suivent (le `data.ids` de la réponse est la liste des ids de relations redirigées).

**Retour** `200` : `{"data": {"ok": true, "ids": ["uuid"]}}`

**Erreurs** : `400 from_assignment_not_found`, `400 same_target_identity`, `400 target_identity_not_found`

---

## Relations person-persons

### 20. Liste des relations

`GET /api/person-persons`

**Paramètres d'entrée** : aucun

**Retour** `200` : `{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}` (les étiquettes sont récupérées via `GET /api/l10n`)

**Erreurs** : `db_not_found`

### 21. Créer une relation

`POST /api/person-persons`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `aPersonId` | string | Oui | Id de la personne de l'extrémité A |
| `aIdentityId` | string | Oui | Id de l'identité de l'extrémité A (la personne doit déjà l'occuper) |
| `bPersonId` | string | Oui | Id de la personne de l'extrémité B |
| `bIdentityId` | string | Oui | Id de l'identité de l'extrémité B |
| `forward` | object | Oui | Charge utile de nom dans le sens A→B (slot de référence obligatoire) |
| `backward` | object | Oui | Charge utile de nom dans le sens B→A (slot de référence obligatoire) |

**Retour** `201` : `{"data": {"id": "uuid"}}`

**Erreurs** : `400 authoritative_required` (slot de référence vide dans l'un des sens), `400 relation_with_self`, `400 endpoint_not_assigned`

### 22. Supprimer une relation

`DELETE /api/person-persons?id=<id>`

**Paramètres d'entrée** (query) : `id` (string, obligatoire)

**Retour** `200` : `{"ok": true}` (succès retourné même si la relation n'existe pas)

**Erreurs** : aucun code d'erreur dédié

### 23. Mettre à jour l'étiquette d'une relation

`POST /api/person-persons/update`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | Oui | Id de la relation |
| `forward` | object | Non | Correctif de nom directionnel (si absent, cette direction reste inchangée) |
| `backward` | object | Non | Idem |

**Retour** `200` : `{"ok": true}`

**Erreurs** : `400 name_required` (les deux directions absentes), `400 authoritative_required`, `404 relation_not_found`

---

## Métadonnées meta

### 24. Lire les métadonnées

`GET /api/meta`

**Paramètres d'entrée** : aucun

**Retour** `200` :

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]}}
```

**Erreurs** : `db_not_found`

### 25. Définir les métadonnées

`PUT /api/meta`

**Paramètres d'entrée** (body)

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `key` | string | Oui | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| Autres champs | — | Selon key | Voir le tableau ci-dessous |

| key | Sémantique de la charge utile |
|---|---|
| `display_name` | Correctif de nom : `description→value`, `value→slot de la langue courante`, `l10n→slot par slot` ; tout vide = effacement de la configuration |
| `bg_color` | `{value}` ou `{description}` : chaîne rgba ; vide = suppression de la ligne, retour au transparent par défaut |
| `authoritative_lang` | `{value}` : code de langue ; la nouvelle langue de référence est automatiquement ajoutée au jeu des langues activées et le basculement émet en rafale deux diffusions meta |
| `enabled_langs` | `{value}` : tableau ou chaîne à virgules ; le serveur complète automatiquement avec la langue de référence, toujours en première position |

**Retour** `200` : `{"data": …}` (authoritative/enabled renvoient `{"id": key, "value": …}` ; les deux autres renvoient le résultat de l'écriture)

**Erreurs** : `400 bad_key`, `400 authoritative_lang_invalid`, `400 enabled_langs_invalid`, `400 authoritative_required`

---

## Slots l10n

### 26. Slots linguistiques complets

`GET /api/l10n`

**Paramètres d'entrée** : aucun

**Retour** `200` : `{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}` — chaque tableau contient des lignes, une ligne = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_Hans_CN"?: "…", …}` (pour les colonnes de langue, seuls les slots non vides sont listés)

**Erreurs** : `db_not_found`

---

## Export

### 27. Export JSON

`GET /api/export/json`

**Paramètres d'entrée** : aucun

**Retour** `200` :

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**Remarque** : `l10n` ne contient que les colonnes des **langues activées**.

**Erreurs** : `db_not_found`

### 28. Export DB

`GET /api/export/db`

**Paramètres d'entrée** : aucun

**Retour** `200` : `Content-Type: application/octet-stream` — fichier brut de la base (instantané cohérent via VACUUM INTO), directement sauvegardable en `.db`

**Erreurs** : `db_not_found`

---

## Diffusion de collaboration WebSocket

- Connexion : `/<nom-de-la-base>/ws?cid=<id-du-client>`
- Après le succès d'une écriture REST, le serveur diffuse aux autres clients de la même base un message JSON texte ; chaque message porte le champ `clientId` (le `X-Client-Id` de l'émetteur), et un message portant son propre `clientId` est ignoré (la mise à jour optimiste l'a déjà affiché)
- Conventions de types des champs : `id` / `personId` / `identityId` / `organizationId` sont des chaînes uuid ; `index` est un number ou null ; `l10n` est une table de slots `{code de langue: valeur}` ou null ; `lang` est le `X-Lang` de l'écrivain

### Organisations

#### organization:create

**Déclencheur** : `POST /api/organizations`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la nouvelle organisation |
| `parentId` | string \| null | Id de l'organisation parente (null = premier niveau) |
| `index` | number \| null | Position d'insertion parmi les nœuds de même niveau |
| `l10n` | object \| null | Slots de nom initiaux |

#### organization:move

**Déclencheur** : `POST /api/organizations/move`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'organisation |
| `parentId` | string \| null | Id de la nouvelle organisation parente (null = remonter au premier niveau) |
| `index` | number \| null | Position cible parmi les nœuds de même niveau |

#### organization:delete

**Déclencheur** : `DELETE /api/organizations`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'organisation supprimée |
| `mode` | string | Vaut `promote` uniquement quand les sous-organisations sont conservées et promues ; champ absent = suppression récursive de tout le sous-arbre |

#### organization:rename

**Déclencheur** : `POST /api/organizations/rename`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'organisation |
| `authoritative` | string \| undefined | Nouvelle valeur du slot de référence (si absent, inchangé) |
| `value` | string \| undefined | Nouvelle valeur du slot de la langue courante de l'écrivain |
| `l10n` | object \| undefined | Upsert slot par slot (chaîne vide = effacement du slot, sauf le slot de référence) |
| `lang` | string | Le `X-Lang` de l'écrivain |

### Identités

#### identity:create

**Déclencheur** : `POST /api/identities`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la nouvelle identité |
| `organizationId` | string | Id de l'organisation d'appartenance |
| `index` | number \| null | Position d'insertion dans l'organisation |
| `l10n` | object \| null | Slots de nom initiaux |

#### identity:move

**Déclencheur** : `POST /api/identities/move`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'identité |
| `index` | number \| null | Nouvelle position dans l'organisation |

#### identity:move-organization

**Déclencheur** : `POST /api/identities/move-organization`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'identité |
| `organizationId` | string | Id de l'organisation cible |
| `index` | number \| null | Position dans l'organisation cible |

#### identity:delete

**Déclencheur** : `DELETE /api/identities`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de l'identité supprimée (effacement en cascade des affectations et des extrémités de relation) |

#### identity:rename

**Déclencheur** : `POST /api/identities/rename` — champs identiques à `organization:rename` (`id` = id de l'identité).

### Personnes

#### person:create

**Déclencheur** : `POST /api/persons` (la création pure et la création avec affectation en une étape diffusent toutes deux ce message ; avec `identityId`, **un message `assign` supplémentaire** est émis en rafale, `index` étant la position d'affectation)

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la nouvelle personne |
| `l10n` | object \| null | Slots de nom initiaux |

#### person:delete

**Déclencheur** : `DELETE /api/persons`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la personne supprimée (effacement en cascade des affectations et des relations) |

#### person:rename

**Déclencheur** : `POST /api/persons/rename` — champs identiques à `organization:rename` (`id` = id de la personne).

### Affectations

#### assign

**Déclencheur** : `POST /api/assignments`, ou deuxième message de la rafale de `POST /api/persons` avec `identityId`

| Champ | Type | Description |
|---|---|---|
| `personId` | string | Id de la personne |
| `identityId` | string | Id de l'identité |
| `index` | number \| null | Position d'insertion dans l'identité |

#### unassign

**Déclencheur** : `DELETE /api/assignments`, ou deuxième message de la rafale de `move-identity`

| Champ | Type | Description |
|---|---|---|
| `personId` | string | Id de la personne |
| `identityId` | string | Id de l'identité |

#### assign:move

**Déclencheur** : `POST /api/assignments/move`

| Champ | Type | Description |
|---|---|---|
| `personId` | string | Id de la personne |
| `identityId` | string | Id de l'identité |
| `index` | number | Nouvelle position dans l'identité |

**Séquence en rafale de move-identity** : `POST /api/assignments/move-identity` déclenche **trois messages ou plus** — d'abord `assign` (identité cible, avec `index`), puis `unassign` (identité d'origine), puis un `personPerson:retarget` par relation suivie.

### Relations

#### personPerson:create

**Déclencheur** : `POST /api/person-persons`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la nouvelle relation |
| `data` | object | Complet : `{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`, le récepteur remplace l'intégralité |

#### personPerson:delete

**Déclencheur** : `DELETE /api/person-persons`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la relation supprimée |

#### personPerson:update

**Déclencheur** : `POST /api/person-persons/update`

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la relation |
| `forward` | object \| undefined | Correctif d'étiquette dans le sens direct (si absent, inchangé) |
| `backward` | object \| undefined | Correctif d'étiquette dans le sens inverse |
| `lang` | string | Le `X-Lang` de l'écrivain |

#### personPerson:retarget

**Déclencheur** : redirection suivie des extrémités de relation après `move-identity` ou la suppression d'une identité ou d'une personne

| Champ | Type | Description |
|---|---|---|
| `id` | string | Id de la relation |
| `data` | object | Relation complète après redirection des extrémités (même `data` que `personPerson:create`), le récepteur remplace l'intégralité |

### Métadonnées

#### meta

**Déclencheur** : `PUT /api/meta` (lors du basculement de authoritative_lang, **deux messages en rafale** : d'abord `authoritative_lang` puis `enabled_langs`)

| Champ | Type | Description |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | Nouvelle valeur ; `enabled_langs` est une chaîne à virgules ; `display_name`/`bg_color` correspondent à meta.value |
| `l10n` | object \| undefined | `display_name` uniquement : table de slots (chaîne vide = effacement du slot) |
| `lang` | string \| undefined | `display_name` uniquement : le `X-Lang` de l'écrivain |

---

## Tableau complet des codes d'erreur

| code | HTTP | Scénario |
|---|---|---|
| `db_not_found` | 404 | La base n'existe pas |
| `not_found` | 404 | Chemin d'API inconnu |
| `org_not_found` | 404/400 | L'organisation n'existe pas (suppression/renommage 404 ; déplacement 400) |
| `parent_not_found` | 404 | Le parent de la nouvelle organisation n'existe pas |
| `target_org_not_found` | 400 | L'organisation cible du déplacement n'existe pas |
| `move_to_self` | 400 | Déplacement d'une organisation dans elle-même |
| `move_to_descendant` | 400 | Déplacement d'une organisation dans son propre descendant |
| `identity_not_found` | 404/400 | L'identité n'existe pas |
| `same_target_org` | 400 | L'identité est déplacée dans l'organisation d'origine |
| `person_not_found` | 404 | La personne n'existe pas |
| `person_or_identity_not_found` | 404 | Une extrémité de l'affectation n'existe pas |
| `assignment_not_found` | 400 | L'affectation n'existe pas (tri) |
| `from_assignment_not_found` | 400 | L'identité d'origine du déplacement n'a pas cette affectation |
| `same_target_identity` | 400 | La cible du déplacement est l'identité d'origine |
| `target_identity_not_found` | 400 | L'identité cible du déplacement n'existe pas |
| `relation_not_found` | 404 | La relation n'existe pas |
| `relation_with_self` | 400 | Les deux extrémités de la relation sont la même affectation |
| `endpoint_not_assigned` | 400 | La personne de l'extrémité n'occupe pas l'identité correspondante |
| `name_required` | 400 | Nom vide / aucune des trois clés du correctif |
| `authoritative_required` | 400 | Slot de référence vide ou tentative de l'effacer |
| `authoritative_lang_invalid` | 400 | Code de langue de référence invalide |
| `enabled_langs_invalid` | 400 | Code de langues activées invalide |
| `bad_key` | 400 | Clé inconnue pour PUT meta |
| `internal_error` | 500 | Exception non interceptée (les détails ne vont qu'au journal serveur) |
