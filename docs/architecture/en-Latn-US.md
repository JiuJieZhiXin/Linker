# Architecture & Implementation Details

This document describes how Linker is implemented: design goals and overall architecture, the data model, the multilingual mechanism, real-time collaboration, and the frontend layering with its key mechanisms. Read it before diving into the code or building on it — it gets you the big picture faster.

Companion documents:

- [API Reference](../api/en-Latn-US.md): the full specification of the external contract — REST endpoints, WebSocket broadcast messages, and the complete error-code table; how the frontend and backend communicate defers to this document
- [README](../../README.en-Latn-US.md): product introduction, feature list, and quick start (head back here if you just want to use Linker)

## Glossary

One definition per line, for disambiguation; mechanism details are governed by the body sections.

| Term | Definition |
|---|---|
| Organization | A node in the tree structure; can contain identities and child organizations (see [Data Model](#data-model)) |
| Identity | A role defined within an organization (the minister/member kind), **not a job title**; translations into other languages must never use job-title words |
| Person | A global, flat entity, attached to identities via "assignment" |
| Assignment | The identity–person many-to-many association (`identity_person` rows) |
| Relationship | A line between two assignments (`person_person`), with forward/backward bidirectional labels |
| Assign | The action of establishing an assignment; "create and assign" = create the person and establish the assignment in one step |
| Database | One `.db` file, i.e. one independent database holding a complete graph |
| Authoritative language | Database-level config: the baseline language of names; the authoritative slot must be non-empty and is the end of the fallback chain (see [Multilingual Data Model](#multilingual-data-model)) |
| Enabled languages | Database-level config (ordered list); decides which languages the name form can record and which language columns the exported JSON carries |
| UI language | A pure frontend preference that affects display only; remembered per database, defaulting to follow the authoritative language |
| Language slot | One language's column in a `_l10n` side table; `NULL` = untranslated |
| Fallback chain | The lookup order for display names: UI-language slot → per-language fallback list (in order, enabled languages only; the three zh variants and the two en variants back each other up) → authoritative-language slot |
| Gap-filling | After switching the authoritative language, old records temporarily have no value in the new authoritative language; the next edit must fill the value back in on the spot |
| Optimistic update | A UI operation lands in the local cache and redraws first, syncs in the background, and rolls back and refetches on failure |
| Temp key / domKey | For objects created locally but not yet persisted: the Symbol key / the `tmp-N` DOM identifier; after persistence `adoptId` writes back the real id (see [Collaboration](#collaboration)) |

## Design Goals

- **Zero dependencies**: only Node built-ins `node:sqlite` + `node:http`, native frontend ES Modules with no build step — clone it and `node server.js` just runs; deployment has no external surface
- **Multi-database**: every `.db` under `data/` is an independent database; connections are lazily loaded and cached by name; databases are fully isolated from one another, and backup/migration is just one file
- **Offline-first (optimistic update)**: a UI operation lands in the local cache and redraws first, while the request syncs in the background; on failure it automatically rolls back and refetches — the user is never held to the network's pace
- **Collaboration**: after a successful REST write, changes are broadcast via WebSocket to the other clients of the same database, with the sender excluded by client id to prevent loopback
- **Multilingual data as a first-class citizen**: names have no notion of a "primary language column" — they are stored in per-language slots, and the authoritative language is just the end of the fallback chain

## Overall Architecture & Request Lifecycle

```
Browser ──HTTP──▶ server.js ──┬── static files (public/, home page and database pages)
                              ├── REST /:database/api/* ──▶ db.js (write methods wrapped by wrapDbForCollab)
                              └── WS   /:database/ws      ──▶ ws.js broadcast
```

The path of one write: frontend data.js first updates the local cache and redraws (optimistically), then sends the REST request with the `X-Lang` / `X-Client-Id` headers; once the server-side db method wrapped by `wrapDbForCollab` succeeds, a change message is broadcast per the `OP_BUILDERS` mapping (excluding the sender); when the frontend receives the broadcast, it mirrors the remote change into the local cache. On sync failure it rolls back (full refetch); conflicts are not merged — concurrent writes to the same resource are last-write-wins.

## Data Model

Primary keys are UUIDs, always generated by the backend. Main tables store only structure and foreign keys; **all names live in the `_l10n` side tables** (the authoritative slot is guaranteed non-empty, see the next section).

### Table List

| Table | Columns | Description |
|---|---|---|
| `organization` | `id` PK · self-referencing `parent_id` · `created_at` · `sort_order` | Organization-tree node |
| `identity` | `id` PK · `organization_id` → organization · `created_at` · `sort_order` | An identity within an organization |
| `person` | `id` PK · `created_at` | Person; flat, no tree |
| `identity_person` | composite PK `person_id`+`identity_id` · `created_at` · `sort_order` | Assignment (many-to-many); ordering applies only within an identity |
| `person_person` | `id` PK · `a_person_id`/`a_identity_id`/`b_person_id`/`b_identity_id` · `created_at` | Relationship; each end is an "assignment" |
| `meta` | `id` PK · `value` | Key-value metadata (`authoritative_lang` / `enabled_langs` / `bg_color`, etc.) |
| `organization_l10n` / `identity_l10n` / `person_l10n` | `id` PK → main table · one column per language | Name slots, one row per entity |
| `person_person_l10n` | composite PK `id`+`type`(forward/backward) · one column per language | Bidirectional label slots for relationships |
| `meta_l10n` | `id` (= the meta key) · one column per language | Slots for the display name (display_name) |

Language columns are named with codes like `zh_Hans_CN` (`-` replaced with `_`); `NULL` = not translated into that language.

### Migrations & Ordering

- **Sort fields**: `sort_order` is added to organization / identity / identity_person by the `ensureSortColumn` migration (legacy databases are backfilled by rowid); sibling order as a whole is rewritten by `reorderSiblings` (editing one row rewrites the entire column, in exchange for sort-free reads)
- **Language column evolution**: `ensureL10nColumns` adds language columns newly introduced in `LANGS` to the five l10n side tables — adding a language does not bump the schema version; it is routine evolution

### Cascade Rules

- Deleting a person: clears all of their assignments and the relationships for which they are an endpoint
- Deleting an organization: recursively deletes the entire subtree by default; with `promote=1` the children are kept and promoted into the deleted organization's place
- Deleting an identity: clears the assignments, and relationship endpoints are retargeted along (`personPerson:retarget` broadcast carries full data)

## Multilingual Data Model

Three language concepts, each with its own job:

| Concept | Stored where | Purpose |
|---|---|---|
| Authoritative language | `meta.authoritative_lang` (one per database) | The baseline language of names; the authoritative slot must be non-empty and is the end of the display fallback chain |
| Enabled languages | `meta.enabled_langs` (comma-separated string, ordered) | Decides which languages the name form can record and which columns the exported JSON carries; must contain the authoritative language, which always comes first |
| UI language | Frontend localStorage (`linker:locale` globally + `linker:view:<path>` per-database override) | Affects display only; never enters the database |

**Display fallback chain**: UI-language slot → per-language fallback list (in order, only enabled languages' slots are tried — e.g. zh-Hant-HK→zh-Hant-TW→zh-Hans-CN back one another up, as do en-Latn-GB and en-Latn-US) → authoritative-language slot → (the empty-string fallback is handled by the caller). The frontend cache holds all slots, so switching the UI language is a pure in-memory re-resolution (`reresolveAll`) with no backend hit; switching the enabled set likewise triggers a full re-resolution (the fallback chain's available nodes change with it).

**Write semantics**: write endpoints uniformly accept the `{authoritative, value, l10n}` superset + the `X-Lang` header —

- Create (`createPayload`): `authoritative` defaults back to `value`; the authoritative slot must end up non-empty, otherwise `authoritative_required`
- Update (`namePatch`): `l10n` upserts slot by slot, **an empty string clears a slot** (except the authoritative slot, which cannot be cleared)
- At database creation the authoritative language is seeded from the creator's `X-Lang`; existing databases were uniformly set to zh-Hans-CN during migration (one-time, already completed)

**Gap-filling rule**: after switching the authoritative language, old records temporarily have no name in the new authoritative language (display falls back to the old authoritative value); the next edit of such a record must fill the authoritative value back in on the spot before it can be saved.

The form's display shape (single input / authoritative + current + fallback-chain languages / all enabled languages) is decided by the frontend "text entry" three-way switch and does not affect the write endpoints — the interface contract is in the [api documentation](../api/en-Latn-US.md).

## Collaboration

- **Optimistic update**: every op in `data.js` first updates the local cache and calls `notify` to redraw, then fires `api()` in the background; on failure `loadAll()` does a full refetch to roll back
- **Temp keys (tempKey)**: objects created locally but not yet persisted use a Symbol as their key and also register a `domKey` (a `tmp-N` string, used for DOM attributes and color hashing); once the server returns the real id, `adoptId` writes it back and syncs the id/l10n of the assignment entries in the tree (otherwise the chip's color pick and language re-resolution would stay stuck at placeholder values)
- **Broadcast**: `ws.js` is an RFC 6455 subset (text broadcast + ping/pong + heartbeat); write methods → messages are mapped by `OP_BUILDERS`, and one write can produce several (e.g. shifting an assignment = assign + unassign + several retargets); all ops and fields are in the [api documentation](../api/en-Latn-US.md)
- **Conflict policy**: no merging — last-write-wins; when someone else's deletion hits an object you are editing, you are force-exited from edit mode (the modal stack is cleared)

## Frontend Architecture

Layered data flow: `events.js` (global event delegation) → `controls.js` / `data.js` (actions and data) → `html.js` (pure functions producing HTML/SVG text) → `view.js` (DOM mounting). The rendering layer is stateless; state comes in three kinds:

| State | Location | Description |
|---|---|---|
| Data cache `store` | `data.js` | Organization tree, persons, relationships, meta — a full mirror of the server |
| View state `vs` | `view.js` | Zoom/focus/fold; persisted per database to `linker:view:<path>` |
| Preferences | `settings.js` / localStorage | Purely local preferences such as the text-entry switch |

UI strings are looked up via `i18n.js` (a missing entry displays the key itself); static copy is marked with `data-i18n` and switched uniformly by `applyStatic()`; an inline script in `head` hides the page until entries are ready to prevent flashing.

## Form & Export Details

- **Name form shapes**: the shape is decided by the three-way "text entry" switch — bare (single input) / dual (authoritative + current + fallback-chain languages, option 2 "Show the authoritative language and fallback-chain languages") / full (all enabled languages); the authoritative row is always first, bolded, required, and cannot be cleared; editing a record whose authoritative slot is empty — and creating one — forces the authoritative row to show per the fill rules (see the notes below the table). bare/fill require the UI language to be in the enabled set; when it is not, they collapse to a "labeled authoritative single input"; dual is the exception — it still holds when the UI language ∉ the enabled set but an enabled fallback-chain language exists (row set = authoritative + chain languages, a non-standard multilingual edit, see the table)

| UI language | Enabled languages | Authoritative language | Authoritative slot empty | Option 1 | Option 2 | Option 3 | Scenario |
|---|---|---|---|---|---|---|---|
| A | includes A | A | Yes | A, unlabeled | A (+A's fallback-chain languages), unlabeled when only A | All, labeled | Normal create |
| A | includes A | A | No | A, unlabeled | A (+A's fallback-chain languages), unlabeled when only A | All, labeled | Normal edit |
| A | includes A | B | Yes | B and A, labeled | authoritative, A, and A's fallback-chain languages, labeled | All, labeled | Multilingual create or gap-filling edit |
| A | includes A | B | No | A, unlabeled | authoritative, A, and A's fallback-chain languages, labeled | All, labeled | Multilingual edit |
| A | excludes A | B | Yes | B, labeled | authoritative (+A's fallback-chain languages), labeled | All, labeled | Non-standard create |
| A | excludes A | B | No | B, labeled | authoritative (+A's fallback-chain languages), labeled | All, labeled | Non-standard edit |

Fallback-chain languages = the per-language fallback list ∩ the enabled set (`LANG_FALLBACK`, see [Multilingual Data Model](#multilingual-data-model)); row order: authoritative always first, then the current language, then in chain order. dual submits under the same rules as full (collapse the rendered rows; an empty string clears a slot).
Gap-filling shape fill: forced when the authoritative slot is empty + authoritative ≠ UI language + option 2 is not selected (always triggered on create) — only the authoritative + current rows, without chain languages; when authoritative = UI, the bare single input alone can fill the authoritative slot back in (on the server side `value` defaults back to `authoritative`), and multiple rows are not forced.

Implementation: settings.js nameModalMode
- **Title dialog** (database display name): no authoritative concept, so no bolded row; only enabled languages are editable (languages not in the enabled set do not appear in the dialog); title display falls back through the same chain as names (UI-language slot → per-language fallback list ∩ enabled set), falling back to the database name when the chain is exhausted; submission does not write authoritative. Shapes are shown in the table below ("all" = all enabled languages):

| UI language | Enabled languages | Option 1 | Option 2 | Option 3 |
|---|---|---|---|---|
| A | includes A | A, unlabeled | A + the fallback-chain languages of all enabled languages, labeled if multiple, unlabeled if only A | All, labeled |
| A | excludes A | read-only own name (not editable) | the fallback-chain languages of all enabled languages, labeled; the read-only database name if there are none | All, labeled |

  Row order: for option 3, the current language (when in the enabled set) is always first and the rest follow the enabled order (authoritative always first); when the UI language is not in the enabled set, everything follows the enabled order; option 2 follows fallback-chain order (A first); placeholder = the title display assuming this slot is empty (the database name as the chain-exhausted fallback)
- **Unique-row rule** (common to the name / title / relationship forms): when a multilingual shape renders down to a single row/group and that row is exactly the current UI language (authoritative = UI and the database has only the authoritative language enabled), the label is dropped — visually the same as the single input, but the submission semantics remain those of the original shape
- **Entry validation feedback**: a required field left empty → red outline on the corresponding input + auto-focus, plus a light toast that floats up at the bottom and auto-dismisses — never a silent rejection
- **Export file names** (PNG/SVG): `brand_display-name_timestamp.ext`, with the brand name following the UI language; "Current"-view exports append the organization name
- **Mobile**: inputs ≥16px to prevent iOS focus zoom

## Error Conventions

The backend returns only an error code (`{error: code}`, e.g. `org_not_found`); the error text is maintained in the frontend l10n entries (`error.*`) per the UI language; the error codes for validations such as "authoritative slot required" and "clearing forbidden" are `authoritative_required` and `authoritative_lang_invalid`. The complete error-code table is in [api/en-Latn-US.md](../api/en-Latn-US.md).

## Directory Structure

```
server.js        HTTP server: multi-database REST API + static frontend + collaboration broadcast wrapper (home page renders nothing; a failed POST redirects back with 302 to ?error=…)
db.js            SQLite data layer: schema (main tables + l10n side tables), CRUD, cascade deletes, VACUUM snapshots, multi-database cache
ws.js            Minimal WebSocket server (RFC 6455 subset: text broadcast + ping/pong + heartbeat)
public/
  index.html     Database page skeleton (header/sidebar/canvas container, data-i18n markers, inline anti-flash script)
  home.html      New-database home page (root path /, purely static)
  home.js        Home page script: language switching + form error hints (reuses the i18n framework)
  home.css       Home page styles
  html.js        Pure-function layer: HTML/SVG text and coordinate registration (layout, canvas, panels, menu/dialog contents)
  view.js        View layer: DOM mounting, view state (zoom/focus/fold), per-database view memory
  controls.js    Unified popup control management: context menu / export dropdown (with a nested submenu) / modals (name, relationship, background color, confirm) / language dialog and enabled-language overlay
  events.js      Event layer: global delegation (drag sessions, touch gestures, click routing, hover focus, keyboard)
  data.js        Data layer: backend communication, optimistic updates, temp-key mechanism, multilingual data parsing and re-parsing, mirror of remote changes
  export.js      Export implementation: PNG/SVG image assembly, JSON/DB downloads, file names
  settings.js    Text-entry mode (three-way, mutually exclusive, required choice) and name/relationship dialog shape decisions; switches persist in localStorage (determines the request body shape)
  i18n.js        i18n framework: l10n registration, t() dictionary lookup with interpolation, localStorage persistence, change notification, applyStatic
  l10n/          UI-language entries (a missing entry falls back to the key itself; all ten languages share the same key set)
  collab.js      Collaboration layer: WebSocket connect/reconnect, remote-change dispatch
  style.css      Styles (including mobile adaptation)
```
