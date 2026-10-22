# Linker

[![Version](https://img.shields.io/badge/version-0.1.0-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![i18n](https://img.shields.io/badge/i18n-zh--CN%20%C2%B7%20zh--TW%20%C2%B7%20zh--HK%20%C2%B7%20en--US%20%C2%B7%20ja--JP%20%C2%B7%20ko--KR%20%C2%B7%20fr--FR%20%C2%B7%20ar--SA-orange)](public/l10n/)

**American English** · [简体中文](README.md) · [臺灣繁體中文](README.zh-TW.md) · [香港繁體中文](README.zh-HK.md) · [日本語](README.ja-JP.md) · [조선글](README.ko-KR.md) · [Français](README.fr-FR.md) · [العربية](README.ar-SA.md)

Organization · Identity · Person · relationship graph tool: who holds which identity in which organization, and how they relate to one another — one graph clears it all up.

## Features

### Organization & Relationship Graph

- **Organization tree canvas**: organizations are laid out in a tree; drag to adjust hierarchy and sibling order
- **Identities & tenure**: one person can hold multiple identities across multiple organizations; identities can be reordered and shifted wholesale to another organization, with the person and relationship lines moving along
- **Relationship lines**: pull a bidirectional relationship line from a person's color chip (e.g. "command ⇌ obey")

### Localization

- **UI language**: the UI can be switched among eight languages
- **Authoritative language**: each database's baseline language for names; untranslated names fall back to the authoritative value
- **Enabled languages**: which languages names can be entered in is configurable

### Collaboration

- **Multi-user real-time collaboration**: multiple people edit at the same time, with changes syncing instantly to all clients
- **Metadata**: each database can set a display name and a background color

### Export

- **PNG / SVG**: image export, each in Global and Current variants
- **JSON**: full data, including metadata and names in all enabled languages
- **DB**: a snapshot of the raw database file, ready to use directly as a backup

## Quick Start

```bash
node server.js          # optional --port / --host
```

- Root path `/`: new-database home page
- `http://localhost:PORT/<database-name>/` (e.g. `/smr/`): enter a database; existing databases open directly at their path

## Documentation

- [docs/architecture/en-US.md](docs/architecture/en-US.md): technical architecture, multilingual data storage, directory structure, error conventions
- [docs/api/en-US.md](docs/api/en-US.md): REST API and collaboration broadcast (WebSocket) interface documentation

## License

[Apache-2.0](LICENSE)

## Author

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## Acknowledgments

This project was developed with assistance from [Kimi](https://kimi.moonshot.cn/), an AI assistant developed by Moonshot AI（月之暗面）.
