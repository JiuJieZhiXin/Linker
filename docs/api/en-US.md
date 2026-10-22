# API Reference

Base URL: `http://<host>:<port>/<database-name>/api/…` (database names limited to `\w-`; each `.db` under `data/` is one database). Exception: the create-database endpoint lives at the root path `/api/create`.

Language codes: `zh-CN` `zh-TW` `zh-HK` `en-US` `ja-JP` `ko-KR` `fr-FR` `ar-SA` (in l10n side-table column names, `-` is replaced with `_`, e.g. `zh_CN`).

## Request Headers

| Header | Required | Purpose |
|---|---|---|
| `X-Lang` | No | Current UI language code: the write target of the `value` slot and the seed of the authoritative language at database creation; missing/invalid falls back to the default language |
| `X-Client-Id` | No | Collaboration client id: the server excludes it when broadcasting to prevent loopback; clients not sending it receive broadcasts of their own writes |

## Common Conventions

- Success: `200` (`{data: …}` or `{ok: true}`); created: `201 {data: …}`
- Failure: `{error: code}` (`4xx/5xx` + JSON); see the "Errors" line of each entry and the [error code table](#error-code-table) at the end
- **Name payload (for creation)** `{authoritative?, value?, l10n?}`:
  - `authoritative`: the authoritative-slot value; must end up non-empty (defaults to `value`)
  - `value`: the current UI language slot (which language is written is decided by `X-Lang`)
  - `l10n`: `{language-code: value}`, merged slot by slot (empty strings ignored)
- **Name patch (for rename/update)** `{authoritative?, value?, l10n?}`: `l10n` upserts slot by slot, **an empty string clears a slot** (except the authoritative slot); if `authoritative` is present it must be non-empty

---

## Database Creation

### 1. Create a Database

`POST /api/create` (root path, not under any database)

**Input** (body, `application/json` or `application/x-www-form-urlencoded`)

| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Database name, limited to `\w-` |

**Response**: no JSON response body; always a `302` redirect:

| Scenario | Location |
|---|---|
| Success | `/<name>/` (enter the new database) |
| Illegal name | `/?error=illegal` |
| Database already exists | `/?error=exists&name=<name>` |

**Notes**: authoritative language seed = the creator's `X-Lang`.

**Errors**: not via JSON — expressed by the `error` parameter of the 302 (`illegal` / `exists`).

---

## Organizations (`organizations`)

### 2. Organization Tree

`GET /api/organizations`

**Input**: none

**Response** `200`:

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**Errors**: `db_not_found`

### 3. Create an Organization

`POST /api/organizations`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `parentId` | string | No | Parent organization id; default = top-level organization |
| `index` | number | No | Insertion position among siblings (default: end) |
| `…name payload` | — | Yes | `{authoritative?, value?, l10n?}`, see Common Conventions |

**Response** `201`: `{"data": {"id": "uuid"}}`

**Errors**: `400 name_required`, `400 authoritative_required`, `404 parent_not_found`

### 4. Move an Organization

`POST /api/organizations/move` (reparent / reorder among siblings; moving into itself or its own descendants is forbidden)

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Organization id |
| `parentId` | string \| null | Yes | New parent organization id; `null` = promote to top level |
| `index` | number | No | Position in the target sibling list |

**Response** `200`: `{"data": {"ok": true}}`

**Errors**: `400 move_to_self`, `400 org_not_found`, `400 target_org_not_found`, `400 move_to_descendant`

### 5. Delete an Organization

`DELETE /api/organizations?id=<id>`

**Input** (query)

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Organization id |
| `promote` | `1` | No | Default: recursively delete the entire subtree; `promote=1`: keep the children, promoting them into the deleted organization's place |

**Response** `200`: `{"ok": true}`

**Errors**: `404 org_not_found`

### 6. Rename an Organization

`POST /api/organizations/rename`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Organization id |
| `…name patch` | — | Yes | `{authoritative?, value?, l10n?}`, see Common Conventions |

**Response** `200`: `{"ok": true}`

**Errors**: `400 authoritative_required`, `400 name_required`, `404 org_not_found`

---

## Identities (`identities`)

### 7. Create an Identity

`POST /api/identities`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `organizationId` | string | Yes | Owning organization id |
| `index` | number | No | Insertion position within the organization (default: end) |
| `…name payload` | — | Yes | See Common Conventions |

**Response** `201`: `{"data": {"id": "uuid"}}`

**Errors**: `400 name_required`, `400 authoritative_required`, `404 org_not_found`

### 8. Reorder an Identity

`POST /api/identities/move` (reordering within an organization only; does not change organizations)

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Identity id |
| `index` | number | Yes | New position within the organization |

**Response** `200`: `{"data": {"ok": true}}`

**Errors**: `400 identity_not_found`

### 9. Move an Identity to Another Organization

`POST /api/identities/move-organization`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `identityId` | string | Yes | Identity id |
| `organizationId` | string | Yes | Target organization id |
| `index` | number | No | Position within the target organization |

**Notes**: assignments and relationships reference `identity_id`, which stays unchanged and moves along automatically.

**Response** `200`: `{"data": {"ok": true}}`

**Errors**: `400 identity_not_found`, `400 target_org_not_found`, `400 same_target_org`

### 10. Delete an Identity

`DELETE /api/identities?id=<id>`

**Input** (query): `id` (string, required) — identity id

**Response** `200`: `{"ok": true}` (cascades to clear assignments and relationship endpoints)

**Errors**: `404 identity_not_found`

### 11. Rename an Identity

`POST /api/identities/rename`

**Input** (body): `id` (string, required) + name patch

**Response** `200`: `{"ok": true}`

**Errors**: `400 authoritative_required`, `400 name_required`, `404 identity_not_found`

---

## Persons (`persons`)

### 12. Person List

`GET /api/persons`

**Input**: none

**Response** `200`: `{"data": [{"id": "uuid"}]}` (names live in the l10n side tables; fetch them via `GET /api/l10n`)

**Errors**: `db_not_found`

### 13. Create a Person (with Optional One-Step Assign)

`POST /api/persons`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `…name payload` | — | Yes | See Common Conventions |
| `identityId` | string | No | If provided = one-step "create and assign" to that identity |
| `index` | number | No | Insertion position within that identity (use with `identityId`) |

**Response** `201`: plain creation `{"data": {"id": "uuid"}}`; with assignment `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**Errors**: `400 name_required`, `400 authoritative_required`, `404 identity_not_found`

### 14. Delete a Person

`DELETE /api/persons?id=<id>`

**Input** (query): `id` (string, required) — person id

**Response** `200`: `{"ok": true}` (cascades to clear assignments and relationships)

**Errors**: `404 person_not_found`

### 15. Rename a Person

`POST /api/persons/rename`

**Input** (body): `id` (string, required) + name patch

**Response** `200`: `{"ok": true}`

**Errors**: `400 authoritative_required`, `400 name_required`, `404 person_not_found`

---

## Assignments (`assignments`, identity–person links)

### 16. Create an Assignment

`POST /api/assignments`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `personId` | string | Yes | Person id |
| `identityId` | string | Yes | Identity id |
| `index` | number | No | Insertion position within the identity (default: end) |

**Notes**: idempotent — creating the same assignment again has no side effects.

**Response** `200`: `{"data": {"personId": "uuid", "identityId": "uuid"}}`

**Errors**: `404 person_or_identity_not_found`

### 17. Remove an Assignment

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**Input** (query): `personId`, `identityId` (both required)

**Response** `200`: `{"ok": true}` (returns success even if the link does not exist)

**Errors**: no dedicated error code

### 18. Reorder an Assignment

`POST /api/assignments/move`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `personId` | string | Yes | Person id |
| `identityId` | string | Yes | Identity id |
| `index` | number | Yes | New position within the identity |

**Response** `200`: `{"data": {"ok": true}}`

**Errors**: `400 assignment_not_found`

### 19. Shift an Assignment (Across Identities)

`POST /api/assignments/move-identity`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `personId` | string | Yes | Person id |
| `fromIdentityId` | string | Yes | Source identity id |
| `toIdentityId` | string | Yes | Target identity id (same person) |
| `index` | number | No | Position within the target identity |

**Notes**: relationship endpoints move along (`data.ids` in the response is the list of relationship ids redirected by the move).

**Response** `200`: `{"data": {"ok": true, "ids": ["uuid"]}}`

**Errors**: `400 from_assignment_not_found`, `400 same_target_identity`, `400 target_identity_not_found`

---

## Relationships (`person-persons`)

### 20. Relationship List

`GET /api/person-persons`

**Input**: none

**Response** `200`: `{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}` (labels fetched via `GET /api/l10n`)

**Errors**: `db_not_found`

### 21. Create a Relationship

`POST /api/person-persons`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `aPersonId` | string | Yes | Person id of end A |
| `aIdentityId` | string | Yes | Identity id of end A (that person must already hold the identity) |
| `bPersonId` | string | Yes | Person id of end B |
| `bIdentityId` | string | Yes | Identity id of end B |
| `forward` | object | Yes | Name payload for the A→B direction (authoritative slot required) |
| `backward` | object | Yes | Name payload for the B→A direction (authoritative slot required) |

**Response** `201`: `{"data": {"id": "uuid"}}`

**Errors**: `400 authoritative_required` (authoritative slot of either direction empty), `400 relation_with_self`, `400 endpoint_not_assigned`

### 22. Delete a Relationship

`DELETE /api/person-persons?id=<id>`

**Input** (query): `id` (string, required)

**Response** `200`: `{"ok": true}` (returns success even if the relationship does not exist)

**Errors**: no dedicated error code

### 23. Update Relationship Labels

`POST /api/person-persons/update`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Relationship id |
| `forward` | object | No | Label patch for the forward direction (if absent, that direction stays unchanged) |
| `backward` | object | No | Same as above |

**Response** `200`: `{"ok": true}`

**Errors**: `400 name_required` (both directions absent), `400 authoritative_required`, `404 relation_not_found`

---

## Meta (`meta`)

### 24. Read Meta

`GET /api/meta`

**Input**: none

**Response** `200`:

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]}}
```

**Errors**: `db_not_found`

### 25. Set Meta

`PUT /api/meta`

**Input** (body)

| Param | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| Other fields | — | Depends on `key` | See the table below |

| key | Payload semantics |
|---|---|
| `display_name` | Name patch: `description→value`, `value→current language slot`, `l10n→slot by slot`; all empty = clear the setting |
| `bg_color` | `{value}` or `{description}`: an rgba string; empty = delete the row and restore the default of full transparency |
| `authoritative_lang` | `{value}`: a language code; the new authoritative language is automatically added to the enabled set, and the switch sends two meta broadcasts in a row |
| `enabled_langs` | `{value}`: array or comma-separated string; the server automatically adds the authoritative language, which always comes first |

**Response** `200`: `{"data": …}` (for authoritative/enabled returns `{"id": key, "value": …}`; the other two return the write result)

**Errors**: `400 bad_key`, `400 authoritative_lang_invalid`, `400 enabled_langs_invalid`, `400 authoritative_required`

---

## l10n Slots

### 26. All Language Slots

`GET /api/l10n`

**Input**: none

**Response** `200`: `{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}` — each value is an array of rows, where a row = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_CN"?: "…", …}` (only non-empty slots are listed for the language columns)

**Errors**: `db_not_found`

---

## Export (`export`)

### 27. JSON Export

`GET /api/export/json`

**Input**: none

**Response** `200`:

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**Notes**: `l10n` contains only columns for the **enabled languages**.

**Errors**: `db_not_found`

### 28. DB Export

`GET /api/export/db`

**Input**: none

**Response** `200`: `Content-Type: application/octet-stream` — the raw database file (a consistent snapshot via VACUUM INTO), ready to save directly as `.db`

**Errors**: `db_not_found`

---

## WebSocket Collaboration Broadcast

- Connection: `/<database-name>/ws?cid=<client-id>`
- After a successful REST write, the server broadcasts a text JSON message to the other clients of the same database; every message carries a `clientId` field (the sender's `X-Client-Id`), and a message whose `clientId` is your own is skipped outright (the optimistic update has already been rendered)
- Field type conventions: `id` / `personId` / `identityId` / `organizationId` are uuid strings; `index` is a number or null; `l10n` is a `{language-code: value}` slot table or null; `lang` is the writer's `X-Lang`

### Organizations

#### organization:create

**Triggered by**: `POST /api/organizations`

| Field | Type | Description |
|---|---|---|
| `id` | string | New organization id |
| `parentId` | string \| null | Parent organization id (null = top level) |
| `index` | number \| null | Insertion position among siblings |
| `l10n` | object \| null | Initial name slots |

#### organization:move

**Triggered by**: `POST /api/organizations/move`

| Field | Type | Description |
|---|---|---|
| `id` | string | Organization id |
| `parentId` | string \| null | New parent organization id (null = promote to top level) |
| `index` | number \| null | Position among target siblings |

#### organization:delete

**Triggered by**: `DELETE /api/organizations`

| Field | Type | Description |
|---|---|---|
| `id` | string | Deleted organization id |
| `mode` | string | `promote` only when children are kept and promoted; field absent = recursively delete the entire subtree |

#### organization:rename

**Triggered by**: `POST /api/organizations/rename`

| Field | Type | Description |
|---|---|---|
| `id` | string | Organization id |
| `authoritative` | string \| undefined | New authoritative-slot value (unchanged if absent) |
| `value` | string \| undefined | New value of the writer's current language slot |
| `l10n` | object \| undefined | Slot-by-slot upsert (an empty string clears a slot, except the authoritative slot) |
| `lang` | string | The writer's `X-Lang` |

### Identities

#### identity:create

**Triggered by**: `POST /api/identities`

| Field | Type | Description |
|---|---|---|
| `id` | string | New identity id |
| `organizationId` | string | Owning organization id |
| `index` | number \| null | Insertion position within the organization |
| `l10n` | object \| null | Initial name slots |

#### identity:move

**Triggered by**: `POST /api/identities/move`

| Field | Type | Description |
|---|---|---|
| `id` | string | Identity id |
| `index` | number \| null | New position within the organization |

#### identity:move-organization

**Triggered by**: `POST /api/identities/move-organization`

| Field | Type | Description |
|---|---|---|
| `id` | string | Identity id |
| `organizationId` | string | Target organization id |
| `index` | number \| null | Position within the target organization |

#### identity:delete

**Triggered by**: `DELETE /api/identities`

| Field | Type | Description |
|---|---|---|
| `id` | string | Deleted identity id (cascades to clear assignments and relationship endpoints) |

#### identity:rename

**Triggered by**: `POST /api/identities/rename` — fields same as `organization:rename` (`id` is the identity id).

### Persons

#### person:create

**Triggered by**: `POST /api/persons` (broadcast both for plain creation and for one-step create-and-assign; with `identityId` an **additional `assign`** is sent right after, whose `index` is the assignment position)

| Field | Type | Description |
|---|---|---|
| `id` | string | New person id |
| `l10n` | object \| null | Initial name slots |

#### person:delete

**Triggered by**: `DELETE /api/persons`

| Field | Type | Description |
|---|---|---|
| `id` | string | Deleted person id (cascades to clear assignments and relationships) |

#### person:rename

**Triggered by**: `POST /api/persons/rename` — fields same as `organization:rename` (`id` is the person id).

### Assignments

#### assign

**Triggered by**: `POST /api/assignments`, or the second message of the sequence when `POST /api/persons` carries `identityId`

| Field | Type | Description |
|---|---|---|
| `personId` | string | Person id |
| `identityId` | string | Identity id |
| `index` | number \| null | Insertion position within the identity |

#### unassign

**Triggered by**: `DELETE /api/assignments`, or the second message of the `move-identity` sequence

| Field | Type | Description |
|---|---|---|
| `personId` | string | Person id |
| `identityId` | string | Identity id |

#### assign:move

**Triggered by**: `POST /api/assignments/move`

| Field | Type | Description |
|---|---|---|
| `personId` | string | Person id |
| `identityId` | string | Identity id |
| `index` | number | New position within the identity |

**Message sequence for move-identity**: `POST /api/assignments/move-identity` triggers **three or more messages** — first `assign` (target identity, including `index`), then `unassign` (source identity), then one `personPerson:retarget` per moved relationship.

### Relationships

#### personPerson:create

**Triggered by**: `POST /api/person-persons`

| Field | Type | Description |
|---|---|---|
| `id` | string | New relationship id |
| `data` | object | Full data: `{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`; the receiver replaces it wholesale |

#### personPerson:delete

**Triggered by**: `DELETE /api/person-persons`

| Field | Type | Description |
|---|---|---|
| `id` | string | Deleted relationship id |

#### personPerson:update

**Triggered by**: `POST /api/person-persons/update`

| Field | Type | Description |
|---|---|---|
| `id` | string | Relationship id |
| `forward` | object \| undefined | Forward label patch (unchanged if absent) |
| `backward` | object \| undefined | Backward label patch |
| `lang` | string | The writer's `X-Lang` |

#### personPerson:retarget

**Triggered by**: retargeting of relationship endpoints after `move-identity` / identity or person deletion

| Field | Type | Description |
|---|---|---|
| `id` | string | Relationship id |
| `data` | object | Full relationship after the endpoints are repointed (same as the `data` of `personPerson:create`); the receiver replaces it wholesale |

### Meta

#### meta

**Triggered by**: `PUT /api/meta` (when switching authoritative_lang, **two messages are sent in a row**: first `authoritative_lang`, then `enabled_langs`)

| Field | Type | Description |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | New value; `enabled_langs` is a comma-separated string; `display_name`/`bg_color` are meta.value |
| `l10n` | object \| undefined | Only for `display_name`: slot table (an empty string clears a slot) |
| `lang` | string \| undefined | Only for `display_name`: the writer's `X-Lang` |

---

## Error Code Table

| code | HTTP | Scenario |
|---|---|---|
| `db_not_found` | 404 | Database does not exist |
| `not_found` | 404 | Unknown API path |
| `org_not_found` | 404/400 | Organization does not exist (404 for delete/rename; 400 for move) |
| `parent_not_found` | 404 | Parent organization does not exist when creating an organization |
| `target_org_not_found` | 400 | Move target organization does not exist |
| `move_to_self` | 400 | Moving an organization into itself |
| `move_to_descendant` | 400 | Moving an organization into its own descendant |
| `identity_not_found` | 404/400 | Identity does not exist |
| `same_target_org` | 400 | Moving an identity into its current organization |
| `person_not_found` | 404 | Person does not exist |
| `person_or_identity_not_found` | 404 | Assignment endpoint does not exist |
| `assignment_not_found` | 400 | Assignment does not exist (reorder) |
| `from_assignment_not_found` | 400 | The source identity of the shift has no such assignment |
| `same_target_identity` | 400 | Shift target equals the source identity |
| `target_identity_not_found` | 400 | The shift's target identity does not exist |
| `relation_not_found` | 404 | Relationship does not exist |
| `relation_with_self` | 400 | Both ends of the relationship are the same assignment |
| `endpoint_not_assigned` | 400 | The relationship endpoint person does not hold the corresponding identity |
| `name_required` | 400 | Name is empty / all three patch keys absent |
| `authoritative_required` | 400 | Authoritative slot is empty or an attempt to clear it |
| `authoritative_lang_invalid` | 400 | Invalid authoritative language code |
| `enabled_langs_invalid` | 400 | Invalid enabled language code |
| `bad_key` | 400 | Unknown key for PUT meta |
| `internal_error` | 500 | Uncaught exception (details go to the server log only) |
