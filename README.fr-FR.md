# Linker

[![Version](https://img.shields.io/badge/version-0.1.0-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![Licence](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![Dépendances](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![Langues](https://img.shields.io/badge/i18n-zh--CN%20%C2%B7%20zh--TW%20%C2%B7%20zh--HK%20%C2%B7%20en--US%20%C2%B7%20ja--JP%20%C2%B7%20ko--KR%20%C2%B7%20fr--FR%20%C2%B7%20ar--SA-orange)](public/l10n/)

**Français** · [简体中文](README.md) · [臺灣繁體中文](README.zh-TW.md) · [香港繁體中文](README.zh-HK.md) · [American English](README.en-US.md) · [日本語](README.ja-JP.md) · [조선글](README.ko-KR.md) · [العربية](README.ar-SA.md)

Outil de graphe d'organisations, d'identités, de personnes et de relations : qui occupe quelle identité dans quelle organisation et quelle relation les lie les uns aux autres — tout se lit en un coup d'œil.

## Caractéristiques

### Graphe d'organisations et de relations

- **Canevas en arbre** : les organisations sont disposées en arbre ; le glisser-déposer ajuste la hiérarchie et l'ordre entre nœuds de même niveau
- **Identités et affectations** : une personne peut occuper plusieurs identités dans plusieurs organisations ; les identités peuvent être triées et déplacées entièrement vers une autre organisation, la personne et ses lignes de relation suivant
- **Lignes de relation** : tirez une ligne bidirectionnelle depuis la pastille de couleur d'une personne (par ex. « commandement ⇌ obéissance »)

### Multilinguisme

- **Langue de l'interface** : l'interface prend en charge huit langues et permet de basculer en un clic
- **Langue de référence** : langue de base des noms de chaque base de données ; les noms sans traduction retombent sur la valeur de référence
- **Langues activées** : dans quelles langues les noms peuvent être saisis est configurable

### Collaboration

- **Collaboration multi-utilisateurs en temps réel** : plusieurs personnes éditent simultanément, chaque modification se synchronise instantanément chez tous les clients
- **Métadonnées** : chaque base de données peut avoir un nom d'affichage et une couleur de fond

### Export

- **PNG / SVG** : export d'images, chacun en versions « Globale » et « Actuelle »
- **JSON** : données complètes, avec métadonnées et noms dans toutes les langues activées
- **DB** : instantané du fichier brut de la base de données, directement utilisable comme sauvegarde

## Démarrage rapide

```bash
node server.js          # --port / --host optionnels
```

- Racine `/` : page d'accueil de création de base de données
- `http://localhost:PORT/<nom-de-la-base>/` (par ex. `/smr/`) : entre dans une base de données ; les bases existantes s'ouvrent directement à leur chemin

## Documentation

- [docs/architecture/fr-FR.md](docs/architecture/fr-FR.md) : architecture technique, stockage multilingue des données, arborescence des répertoires, conventions d'erreurs
- [docs/api/fr-FR.md](docs/api/fr-FR.md) : documentation des API REST et des interfaces de diffusion de collaboration (WebSocket)

## Licence

[Apache-2.0](LICENSE)

## Auteur

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## Remerciements

Ce projet a été développé avec l'aide de [Kimi](https://kimi.moonshot.cn/), un assistant IA développé par Moonshot AI（月之暗面）.
