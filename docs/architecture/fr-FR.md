# Architecture et détails d'implémentation

Ce document explique comment Linker est implémenté : objectifs de conception et architecture globale, modèle de données, mécanismes multilingues, collaboration en temps réel, couches front-end et mécanismes clés. Lisez-le avant de parcourir le code ou de faire du développement dérivé, il vous donnera plus vite une vue d'ensemble.

Documents complémentaires :

- [Documentation de l'API](../api/fr-FR.md) : la spécification complète du contrat externe — points de terminaison REST, messages de diffusion WebSocket, tableau complet des codes d'erreur ; la communication front-end/back-end s'y conforme
- [README](../../README.fr-FR.md) : présentation du produit, liste des fonctionnalités et démarrage rapide (pour une simple utilisation, retournez ici)

## Glossaire

Une ligne par définition, pour lever les ambiguïtés ; les détails des mécanismes se trouvent dans les sections du corps du texte.

| Terme | Définition |
|---|---|
| organisation | Nœud de la structure arborescente, peut contenir des identités et des sous-organisations (voir [Modèle de données](#modèle-de-données)) |
| identité | Rôle défini au sein d'une organisation (du genre ministre, membre), **pas un poste** ; les traductions vers d'autres langues se refusent les termes de type poste |
| personne | Entité globale et aplatie, rattachée aux identités par l'« affectation » |
| affectation | Association plusieurs-à-plusieurs identité-personne (ligne `identity_person`) |
| relation | Ligne entre deux affectations (`person_person`), avec des étiquettes bidirectionnelles forward/backward |
| affecter | Action d'établir une affectation ; « créer et affecter » = créer la personne tout en établissant l'affectation |
| base | Un fichier `.db`, c'est-à-dire une base de données indépendante contenant un graphe complet |
| langue de référence | Configuration au niveau de la base, langue de base des noms ; le slot de référence doit être non vide, c'est le terminus de la chaîne de repli (voir [Modèle de données multilingue](#modèle-de-données-multilingue)) |
| langues activées | Configuration au niveau de la base (liste ordonnée), détermine les langues saisissables du formulaire de nom et les colonnes de langue du JSON d'export |
| langue d'interface | Préférence purement front-end, n'affecte que l'affichage ; mémorisée par base, suit par défaut la langue de référence |
| slot linguistique | Une colonne d'une langue donnée dans la table annexe `_l10n` ; `NULL` = non traduit |
| chaîne de repli | Ordre de recherche du nom affiché : slot de la langue d'interface → slot de la langue de référence |
| comblement des vides | Après un changement de langue de référence, les anciens enregistrements n'ont pas de valeur dans la nouvelle langue de référence ; la prochaine édition doit obligatoirement la compléter sur-le-champ |
| mise à jour optimiste | L'opération d'interface écrit d'abord dans le cache local avec re-rendu, se synchronise en arrière-plan ; en cas d'échec, annulation et rechargement complet |
| clé temporaire / domKey | Clé Symbol d'un objet nouveau non encore écrit en base / identifiant DOM `tmp-N` ; après l'écriture en base, `adoptId` réécrit le vrai id (voir [Mécanismes de collaboration](#mécanismes-de-collaboration)) |

## Objectifs de conception

- **Zéro dépendance** : seulement le `node:sqlite` + `node:http` intégrés à Node, ES Modules natifs côté front-end sans étape de build — clonez puis `node server.js` et ça tourne, aucune surface externe en déploiement
- **Multi-bases** : chaque `.db` sous `data/` est une base indépendante, chargée paresseusement par nom avec mise en cache des connexions ; les bases sont totalement isolées les unes des autres, sauvegarder/migrer se résume à un fichier
- **Hors-ligne d'abord (mise à jour optimiste)** : l'opération d'interface écrit d'abord dans le cache local avec re-rendu, la requête se synchronise en arrière-plan ; en cas d'échec, annulation automatique et rechargement complet, l'utilisateur n'est pas prisonnier du rythme du réseau
- **Collaboration** : après le succès d'une écriture REST, les modifications sont diffusées par WebSocket aux autres clients de la même base, l'émetteur étant exclu par identifiant client pour éviter le renvoi en boucle
- **Le multilinguisme des données est citoyen de première classe** : les noms n'ont pas de notion de « colonne de langue principale », ils sont tous stockés par slot linguistique, la langue de référence n'est que le terminus de la chaîne de repli

## Architecture globale et cycle de vie d'une requête

```
Navigateur ──HTTP──▶ server.js ──┬── Fichiers statiques (public/, page d'accueil et page de base)
                                 ├── REST /:<nom-de-la-base>/api/* ──▶ db.js (méthodes d'écriture enveloppées par wrapDbForCollab)
                                 └── WS   /:<nom-de-la-base>/ws    ──▶ Diffusion ws.js
```

Cheminement d'une écriture : le front-end `data.js` modifie d'abord le cache local et repeint (optimiste), puis envoie la requête REST avec les en-têtes `X-Lang` / `X-Client-Id` ; côté serveur, les méthodes db enveloppées par `wrapDbForCollab` diffusent au succès les messages de modification selon la correspondance `OP_BUILDERS` (émetteur exclu) ; le front-end reçoit la diffusion et miroite les changements distants dans le cache local. En cas d'échec de synchronisation, annulation (rechargement complet), pas de fusion des conflits — pour des écritures concurrentes sur une même ressource, la dernière l'emporte.

## Modèle de données

Les clés primaires sont toutes des UUID, générés par le back-end. Les tables principales ne stockent que la structure et les clés étrangères, **tous les noms sont dans les tables annexes `_l10n`** (le slot de référence est garanti non vide, voir la section suivante).

### Liste des tables

| Table | Colonnes | Description |
|---|---|---|
| `organization` | `id` PK · `parent_id` auto-référence · `created_at` · `sort_order` | Nœud de l'arbre des organisations |
| `identity` | `id` PK · `organization_id` → organization · `created_at` · `sort_order` | Identité au sein d'une organisation |
| `person` | `id` PK · `created_at` | Personne, aplatie, sans arborescence |
| `identity_person` | clé primaire composée `person_id`+`identity_id` · `created_at` · `sort_order` | Affectation (plusieurs-à-plusieurs), le tri ne vaut que dans l'identité |
| `person_person` | `id` PK · `a_person_id`/`a_identity_id`/`b_person_id`/`b_identity_id` · `created_at` | Relation, chaque extrémité est une « affectation » |
| `meta` | `id` PK · `value` | Paires clé-valeur de méta-informations (`authoritative_lang` / `enabled_langs` / `bg_color`, etc.) |
| `organization_l10n` / `identity_l10n` / `person_l10n` | `id` PK → table principale · colonnes par langue | Slots de nom, une ligne par entité |
| `person_person_l10n` | clé primaire composée `id`+`type`(forward/backward) · colonnes par langue | Slots d'étiquette bidirectionnelle de la relation |
| `meta_l10n` | `id` (= clé meta) · colonnes par langue | Slots du nom d'affichage (display_name) |

Les colonnes de langue portent des noms comme `zh_CN` (le `-` du code de langue devient `_`), `NULL` = non traduit dans cette langue.

### Migrations et tri

- **Champ de tri** : `sort_order` est ajouté aux tables organization / identity / identity_person par la migration `ensureSortColumn` (les anciennes bases sont remplies rétrospectivement selon rowid) ; l'ordre entre nœuds de même niveau est réécrit globalement par `reorderSiblings` (modifier une ligne réécrit toute la colonne, en échange de lectures sans tri)
- **Évolution des colonnes de langue** : `ensureL10nColumns` complète les cinq tables annexes l10n avec les colonnes des langues nouvellement ajoutées à `LANGS` — ajouter une langue ne modifie pas le numéro de version de la structure des tables, c'est une évolution courante

### Règles de cascade

- Suppression d'une personne : efface toutes ses affectations et les relations dont elle est une extrémité
- Suppression d'une organisation : par défaut, suppression récursive de tout le sous-arbre ; avec `promote=1`, les niveaux inférieurs sont conservés et promus à la place de l'organisation supprimée
- Suppression d'une identité : efface les affectations, les extrémités de relation sont redirigées en même temps (`personPerson:retarget` diffuse des données complètes)

## Modèle de données multilingue

Trois concepts linguistiques, chacun avec son rôle :

| Concept | Où stocké | Rôle |
|---|---|---|
| langue de référence | `meta.authoritative_lang` (une par base) | Langue de base des noms ; le slot de référence doit être non vide, c'est le terminus de la chaîne de repli d'affichage |
| langues activées | `meta.enabled_langs` (chaîne à virgules, ordonnée) | Détermine les langues que le formulaire de nom peut enregistrer et les colonnes du JSON d'export ; doit contenir la langue de référence, toujours en première position |
| langue d'interface | localStorage côté front-end (`linker:locale` global + `linker:view:<chemin>` par surcharge de base) | N'affecte que l'affichage, n'entre pas en base |

**Chaîne de repli d'affichage** : slot de la langue d'interface → slot de la langue de référence → (le repli sur la chaîne vide est géré par l'appelant). Le cache front-end détient tous les slots ; changer de langue d'interface est une simple réanalyse en mémoire (`reresolveAll`), sans appel au back-end.

**Sémantique d'écriture** : les interfaces d'écriture acceptent toutes le sur-ensemble `{authoritative, value, l10n}` + l'en-tête `X-Lang` —

- Création (`createPayload`) : `authoritative` retombe par défaut sur `value` ; le slot de référence doit être finalement non vide, sinon `authoritative_required`
- Mise à jour (`namePatch`) : `l10n` fait un upsert slot par slot, **chaîne vide = effacement du slot** (sauf le slot de référence, dont l'effacement est refusé)
- À la création de la base, la langue de référence est semée selon le `X-Lang` du créateur ; lors de la migration des bases existantes, elle a été fixée uniformément à zh-CN (opération unique, déjà exécutée)

**Règle de comblement des vides** : après un changement de langue de référence, les anciens enregistrements n'ont momentanément pas de nom dans la nouvelle langue de référence (affichage replié sur l'ancienne valeur de référence), la prochaine édition de l'enregistrement doit compléter sur-le-champ la valeur de référence avant que la sauvegarde soit autorisée.

La forme d'affichage du formulaire de nom (champ unique / référence + courante / toutes les langues activées) est décidée par l'interrupteur « saisie de texte » côté front-end et n'affecte pas les interfaces d'écriture — le contrat des interfaces se trouve dans la [documentation de l'API](../api/fr-FR.md).

## Mécanismes de collaboration

- **Mise à jour optimiste** : chaque op de `data.js` modifie d'abord le cache local puis déclenche `notify` pour repeindre, ensuite `api()` en arrière-plan ; en cas d'échec, `loadAll()` recharge tout pour annuler
- **Clé temporaire (tempKey)** : les objets nouveaux non encore écrits en base utilisent une clé Symbol, avec enregistrement simultané du `domKey` (chaîne `tmp-N`, servant d'attribut DOM et de hachage de couleur) ; le vrai id renvoyé par le serveur est réécrit par `adoptId`, qui synchronise aussi les id/l10n des entrées d'affectation dans l'arbre (sinon la couleur de la pastille et la réanalyse linguistique restent bloquées sur les valeurs provisoires)
- **Diffusion** : `ws.js` est un sous-ensemble de RFC 6455 (diffusion de texte + ping/pong + battement de cœur) ; méthodes d'écriture → messages selon la correspondance `OP_BUILDERS`, une seule écriture pouvant en produire plusieurs (par ex. le déplacement d'une affectation = assign + unassign + plusieurs retarget), tous les op et tous les champs sont dans la [documentation de l'API](../api/fr-FR.md)
- **Stratégie de conflit** : pas de fusion, la dernière écriture l'emporte (last-write-wins) ; quand la suppression d'un tiers touche l'objet en cours d'édition, la sortie du mode édition est forcée (la pile de modales est vidée)

## Architecture front-end

Flux de données en couches : `events.js` (délégation d'événements globale) → `controls.js` / `data.js` (actions et données) → `html.js` (fonctions pures produisant le texte HTML/SVG) → `view.js` (montage DOM). La couche de rendu est sans état, les états se divisent en trois catégories :

| État | Emplacement | Description |
|---|---|---|
| Cache de données `store` | `data.js` | Arborescence des organisations, personnes, relations, meta — miroir complet du serveur |
| État de vue `vs` | `view.js` | Zoom / focus / repli, persisté par base dans `linker:view:<chemin>` |
| Préférences | `settings.js` / localStorage | Préférences purement locales comme l'interrupteur de saisie de texte |

Les termes d'interface sont cherchés via `i18n.js` (en cas de terme manquant, la clé elle-même est affichée) ; les textes statiques portent le marqueur `data-i18n` et sont basculés globalement par `applyStatic()` ; le script inline dans `head` masque la page en attendant la disponibilité des termes pour éviter le scintillement.

## Détails des formulaires et de l'export

- **Forme du formulaire de nom** : décidée par l'interrupteur « saisie de texte » à trois options — bare (champ unique) / dual (référence + courante) / full (toutes les langues activées) ; la ligne de référence est toujours en première position, en gras, obligatoire et non effaçable ; la création et l'édition dont le slot de référence est vide forcent l'affichage de la ligne de référence
- **Pop-up de titre** (nom d'affichage de la base) : non soumis à l'interrupteur de saisie de texte, sans notion de référence ni de gras ; en affichage multilingue la langue courante vient en premier, toute langue laissée vide retombe sur le nom de la base, le placeholder du champ est la valeur du nom de la base ; la soumission n'écrit pas authoritative
- **Retour de validation de saisie** : un champ obligatoire vide → cadre rouge sur le champ correspondant + focus automatique, une notification légère flotte en bas de l'écran puis disparaît automatiquement, sans refus silencieux
- **Nom de fichier d'export** (PNG/SVG) : `Marque_Affichage_Horodatage.ext`, le nom de marque suit la langue de l'interface ; l'export de la vue « Actuelle » ajoute le nom de l'organisation
- **Mobile** : champs de saisie ≥ 16px, contre le zoom de focus iOS

## Conventions d'erreurs

Le back-end ne renvoie que des codes d'erreur (`{error: code}`, par ex. `org_not_found`), les textes d'erreur sont gérés côté front-end par les termes l10n (`error.*`) selon la langue d'interface ; les codes d'erreur des validations comme « slot de référence obligatoire, effacement interdit » sont `authoritative_required` et `authoritative_lang_invalid`. Le tableau complet des codes d'erreur se trouve dans [api/fr-FR.md](../api/fr-FR.md).

## Arborescence des répertoires

```
server.js        Service HTTP : API REST multi-bases + front-end statique + enveloppe de diffusion de collaboration (page d'accueil zéro rendu, POST en échec → 302 vers ?error=…)
db.js            Couche de données SQLite : création des tables (tables principales + annexes l10n), CRUD, suppressions en cascade, instantanés VACUUM, cache multi-bases
ws.js            Serveur WebSocket minimaliste (sous-ensemble RFC 6455 : diffusion de texte + ping/pong + battement de cœur)
public/
  index.html     Squelette de la page de base (en-tête / barre latérale / conteneur de canevas, marqueurs data-i18n, script inline anti-scintillement)
  home.html      Page d'accueil de création de base (racine /, page purement statique)
  home.js        Script de la page d'accueil : changement de langue + messages d'erreur de formulaire (réutilise le framework i18n)
  home.css       Styles de la page d'accueil
  html.js        Couche de fonctions pures : texte HTML/SVG et registre de coordonnées (layout, canevas, panneaux, contenus de menus et pop-ups)
  view.js        Couche vue : montage DOM, état de vue (zoom / focus / repli), mémoire de vue par base
  controls.js    Gestion unifiée des contrôles flottants : menu contextuel / menu déroulant d'export (avec sous-menus) / modales (nom, relation, couleur de fond, confirmation) / pop-up de langue et calque des langues activées
  events.js      Couche événements : délégation globale (sessions de glisser-déposer, gestes tactiles, routage des clics, focus au survol, clavier)
  data.js        Couche données : communication back-end, mise à jour optimiste, mécanisme de clés temporaires, analyse et réanalyse multilingue des données, miroir des changements distants
  export.js      Implémentation de l'export : assemblage des images PNG/SVG, téléchargements JSON/DB, noms de fichier
  settings.js    Mode de saisie de texte (trois options mutuellement exclusives, l'une obligatoire) et décision de forme des modales de nom et de relation ; les interrupteurs sont stockés dans localStorage (déterminent la forme du corps de requête)
  i18n.js        Framework d'internationalisation : enregistrement l10n, interpolation de clés t(), persistance localStorage, notification de changement, applyStatic
  l10n/          Termes de langue d'interface (en cas de terme manquant, affichage de la clé elle-même ; huit langues alignées sur le même jeu de clés)
  collab.js      Couche de collaboration : connexion et reconnexion WebSocket, distribution des changements distants
  style.css      Styles (avec adaptation mobile)
```
