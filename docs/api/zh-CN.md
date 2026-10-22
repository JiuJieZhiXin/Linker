# API 接口文档

Base URL：`http://<host>:<port>/<库名>/api/…`（库名限 `\w-`；`data/` 下每个 `.db` 一个库）。例外：建库接口在根路径 `/api/create`。

语言代码：`zh-CN` `zh-TW` `zh-HK` `en-US` `ja-JP` `ko-KR` `fr-FR` `ar-SA`（l10n 附表列名把 `-` 换成 `_`，如 `zh_CN`）。

## 请求头

| 头 | 必填 | 作用 |
|---|---|---|
| `X-Lang` | 否 | 当前界面语言代码：`value` 槽的写入目标、建库时作准语言的种子；缺省/非法回退默认语言 |
| `X-Client-Id` | 否 | 协作客户端标识：服务端广播时按它排除回环；不带的客户端会收到自己写入的广播 |

## 通用约定

- 成功：`200`（`{data: …}` 或 `{ok: true}`）；创建：`201 {data: …}`
- 失败：`{error: code}`（`4xx/5xx` + JSON），code 见每条「错误」与文末[错误码总表](#错误码总表)
- **名称负载（新建用）** `{authoritative?, value?, l10n?}`：
  - `authoritative`：作准语言槽值，最终必须非空（缺省回退 `value`）
  - `value`：当前界面语言槽（由 `X-Lang` 决定写入哪个语言）
  - `l10n`：`{语言代码: 值}` 逐槽合并（空串忽略）
- **名称补丁（重命名/更新用）** `{authoritative?, value?, l10n?}`：`l10n` 逐槽 upsert，**空串清槽**（作准槽除外）；`authoritative` 出现必须非空

---

## 建库

### 1. 新建数据库

`POST /api/create`（根路径，不在库下）

**入参**（body，`application/json` 或 `application/x-www-form-urlencoded`）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 库名，限 `\w-` |

**返回**：无 JSON 响应体，一律 `302` 重定向：

| 场景 | Location |
|---|---|
| 成功 | `/<name>/`（进入新库） |
| 库名不合法 | `/?error=illegal` |
| 库已存在 | `/?error=exists&name=<name>` |

**说明**：作准语言种子 = 创建者的 `X-Lang`。

**错误**：不经 JSON，由 302 的 `error` 参数表达（`illegal` / `exists`）。

---

## 组织 organizations

### 2. 组织树

`GET /api/organizations`

**入参**：无

**返回** `200`：

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**错误**：`db_not_found`

### 3. 新建组织

`POST /api/organizations`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `parentId` | string | 否 | 父组织 id；缺省 = 一级组织 |
| `index` | number | 否 | 同级插入位置（缺省末尾） |
| `…名称负载` | — | 是 | `{authoritative?, value?, l10n?}`，见通用约定 |

**返回** `201`：`{"data": {"id": "uuid"}}`

**错误**：`400 name_required`、`400 authoritative_required`、`404 parent_not_found`

### 4. 移动组织

`POST /api/organizations/move`（换父级 / 同级排序；禁止移入自身或后代）

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 组织 id |
| `parentId` | string \| null | 是 | 新父组织 id；`null` = 提到一级 |
| `index` | number | 否 | 目标同级列表中的位置 |

**返回** `200`：`{"data": {"ok": true}}`

**错误**：`400 move_to_self`、`400 org_not_found`、`400 target_org_not_found`、`400 move_to_descendant`

### 5. 删除组织

`DELETE /api/organizations?id=<id>`

**入参**（query）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 组织 id |
| `promote` | `1` | 否 | 缺省：递推删除整棵子树；`promote=1`：保留下级，提升到被删组织原位 |

**返回** `200`：`{"ok": true}`

**错误**：`404 org_not_found`

### 6. 重命名组织

`POST /api/organizations/rename`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 组织 id |
| `…名称补丁` | — | 是 | `{authoritative?, value?, l10n?}`，见通用约定 |

**返回** `200`：`{"ok": true}`

**错误**：`400 authoritative_required`、`400 name_required`、`404 org_not_found`

---

## 身份 identities

### 7. 新建身份

`POST /api/identities`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `organizationId` | string | 是 | 所属组织 id |
| `index` | number | 否 | 组织内插入位置（缺省末尾） |
| `…名称负载` | — | 是 | 见通用约定 |

**返回** `201`：`{"data": {"id": "uuid"}}`

**错误**：`400 name_required`、`400 authoritative_required`、`404 org_not_found`

### 8. 身份排序

`POST /api/identities/move`（仅组织内排序，不改组织）

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 身份 id |
| `index` | number | 是 | 组织内新位置 |

**返回** `200`：`{"data": {"ok": true}}`

**错误**：`400 identity_not_found`

### 9. 身份跨组织移动

`POST /api/identities/move-organization`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `identityId` | string | 是 | 身份 id |
| `organizationId` | string | 是 | 目标组织 id |
| `index` | number | 否 | 目标组织内位置 |

**说明**：担任与关系引用 `identity_id` 不变，自动随迁。

**返回** `200`：`{"data": {"ok": true}}`

**错误**：`400 identity_not_found`、`400 target_org_not_found`、`400 same_target_org`

### 10. 删除身份

`DELETE /api/identities?id=<id>`

**入参**（query）：`id`（string，必填）——身份 id

**返回** `200`：`{"ok": true}`（级联清担任与关系端点）

**错误**：`404 identity_not_found`

### 11. 重命名身份

`POST /api/identities/rename`

**入参**（body）：`id`（string，必填）+ 名称补丁

**返回** `200`：`{"ok": true}`

**错误**：`400 authoritative_required`、`400 name_required`、`404 identity_not_found`

---

## 人物 persons

### 12. 人物列表

`GET /api/persons`

**入参**：无

**返回** `200`：`{"data": [{"id": "uuid"}]}`（名称在 l10n 附表，经 `GET /api/l10n` 取）

**错误**：`db_not_found`

### 13. 新建人物（可一步指派）

`POST /api/persons`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `…名称负载` | — | 是 | 见通用约定 |
| `identityId` | string | 否 | 传入 = 一步「新建并指派」到该身份 |
| `index` | number | 否 | 该身份内的插入位置（配 `identityId` 使用） |

**返回** `201`：纯建 `{"data": {"id": "uuid"}}`；带指派 `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**错误**：`400 name_required`、`400 authoritative_required`、`404 identity_not_found`

### 14. 删除人物

`DELETE /api/persons?id=<id>`

**入参**（query）：`id`（string，必填）——人物 id

**返回** `200`：`{"ok": true}`（级联清担任与关系）

**错误**：`404 person_not_found`

### 15. 重命名人物

`POST /api/persons/rename`

**入参**（body）：`id`（string，必填）+ 名称补丁

**返回** `200`：`{"ok": true}`

**错误**：`400 authoritative_required`、`400 name_required`、`404 person_not_found`

---

## 担任 assignments（身份-人物关联）

### 16. 建立担任

`POST /api/assignments`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `identityId` | string | 是 | 身份 id |
| `index` | number | 否 | 身份内插入位置（缺省末尾） |

**说明**：幂等，重复建立不产生副作用。

**返回** `200`：`{"data": {"personId": "uuid", "identityId": "uuid"}}`

**错误**：`404 person_or_identity_not_found`

### 17. 解除担任

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**入参**（query）：`personId`、`identityId`（均必填）

**返回** `200`：`{"ok": true}`（关联不存在也返回成功）

**错误**：无专用错误码

### 18. 担任排序

`POST /api/assignments/move`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `identityId` | string | 是 | 身份 id |
| `index` | number | 是 | 身份内新位置 |

**返回** `200`：`{"data": {"ok": true}}`

**错误**：`400 assignment_not_found`

### 19. 平移担任（跨身份）

`POST /api/assignments/move-identity`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `fromIdentityId` | string | 是 | 原身份 id |
| `toIdentityId` | string | 是 | 目标身份 id（同一人物） |
| `index` | number | 否 | 目标身份内位置 |

**说明**：关系端点随迁（响应 `data.ids` 为随迁重定向的关系 id 列表）。

**返回** `200`：`{"data": {"ok": true, "ids": ["uuid"]}}`

**错误**：`400 from_assignment_not_found`、`400 same_target_identity`、`400 target_identity_not_found`

---

## 关系 person-persons

### 20. 关系列表

`GET /api/person-persons`

**入参**：无

**返回** `200`：`{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}`（标签经 `GET /api/l10n` 取）

**错误**：`db_not_found`

### 21. 新建关系

`POST /api/person-persons`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `aPersonId` | string | 是 | A 端人物 id |
| `aIdentityId` | string | 是 | A 端身份 id（该人物须已担任） |
| `bPersonId` | string | 是 | B 端人物 id |
| `bIdentityId` | string | 是 | B 端身份 id |
| `forward` | object | 是 | A→B 方向名称负载（作准槽必填） |
| `backward` | object | 是 | B→A 方向名称负载（作准槽必填） |

**返回** `201`：`{"data": {"id": "uuid"}}`

**错误**：`400 authoritative_required`（任一方向作准槽为空）、`400 relation_with_self`、`400 endpoint_not_assigned`

### 22. 删除关系

`DELETE /api/person-persons?id=<id>`

**入参**（query）：`id`（string，必填）

**返回** `200`：`{"ok": true}`（关系不存在也返回成功）

**错误**：无专用错误码

### 23. 更新关系标签

`POST /api/person-persons/update`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 关系 id |
| `forward` | object | 否 | 方向名称补丁（不传则不动该方向） |
| `backward` | object | 否 | 同上 |

**返回** `200`：`{"ok": true}`

**错误**：`400 name_required`（两方向全缺）、`400 authoritative_required`、`404 relation_not_found`

---

## 元信息 meta

### 24. 读取元信息

`GET /api/meta`

**入参**：无

**返回** `200`：

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]}}
```

**错误**：`db_not_found`

### 25. 设置元信息

`PUT /api/meta`

**入参**（body）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | 是 | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| 其余字段 | — | 视 key | 见下表 |

| key | 负载语义 |
|---|---|
| `display_name` | 名称补丁：`description→value`、`value→当前语言槽`、`l10n→逐槽`；全空 = 清除配置 |
| `bg_color` | `{value}` 或 `{description}`：rgba 字符串；空 = 删行恢复默认全透明 |
| `authoritative_lang` | `{value}`：语言代码；新作准自动纳入启用集，并随本次切换连发两条 meta 广播 |
| `enabled_langs` | `{value}`：数组或逗号串；服务端自动补作准语言、恒在首位 |

**返回** `200`：`{"data": …}`（authoritative/enabled 返回 `{"id": key, "value": …}`；另两个返回写入结果）

**错误**：`400 bad_key`、`400 authoritative_lang_invalid`、`400 enabled_langs_invalid`、`400 authoritative_required`

---

## l10n 槽

### 26. 全量语言槽

`GET /api/l10n`

**入参**：无

**返回** `200`：`{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}`——各为行数组，行 = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_CN"?: "…", …}`（语言列只列非空槽）

**错误**：`db_not_found`

---

## 导出 export

### 27. JSON 导出

`GET /api/export/json`

**入参**：无

**返回** `200`：

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**说明**：`l10n` 只含**启用语言**的列。

**错误**：`db_not_found`

### 28. DB 导出

`GET /api/export/db`

**入参**：无

**返回** `200`：`Content-Type: application/octet-stream`——原始库文件（VACUUM INTO 一致性快照），可直接保存为 `.db`

**错误**：`db_not_found`

---

## WebSocket 协作广播

- 连接：`/<库名>/ws?cid=<客户端id>`
- REST 写入成功后，服务端向同库其他客户端广播文本 JSON 消息；每条消息都带 `clientId` 字段（发起者的 `X-Client-Id`），收到自己 `clientId` 的消息直接跳过（乐观更新已先行上屏）
- 字段类型约定：`id` / `personId` / `identityId` / `organizationId` 为 uuid 字符串；`index` 为 number 或 null；`l10n` 为 `{语言代码: 值}` 槽表或 null；`lang` 为写入方的 `X-Lang`

### 组织

#### organization:create

**触发**：`POST /api/organizations`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 新组织 id |
| `parentId` | string \| null | 父组织 id（null = 一级） |
| `index` | number \| null | 同级插入位置 |
| `l10n` | object \| null | 初始名称槽 |

#### organization:move

**触发**：`POST /api/organizations/move`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 组织 id |
| `parentId` | string \| null | 新父组织 id（null = 提到一级） |
| `index` | number \| null | 目标同级位置 |

#### organization:delete

**触发**：`DELETE /api/organizations`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 被删组织 id |
| `mode` | string | 仅保留下级提升时为 `promote`；字段缺省 = 递推删除整棵子树 |

#### organization:rename

**触发**：`POST /api/organizations/rename`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 组织 id |
| `authoritative` | string \| undefined | 作准槽新值（未传则不变） |
| `value` | string \| undefined | 写入方当前语言槽新值 |
| `l10n` | object \| undefined | 逐槽 upsert（空串清槽，作准槽除外） |
| `lang` | string | 写入方的 `X-Lang` |

### 身份

#### identity:create

**触发**：`POST /api/identities`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 新身份 id |
| `organizationId` | string | 所属组织 id |
| `index` | number \| null | 组织内插入位置 |
| `l10n` | object \| null | 初始名称槽 |

#### identity:move

**触发**：`POST /api/identities/move`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 身份 id |
| `index` | number \| null | 组织内新位置 |

#### identity:move-organization

**触发**：`POST /api/identities/move-organization`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 身份 id |
| `organizationId` | string | 目标组织 id |
| `index` | number \| null | 目标组织内位置 |

#### identity:delete

**触发**：`DELETE /api/identities`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 被删身份 id（级联清担任与关系端点） |

#### identity:rename

**触发**：`POST /api/identities/rename`——字段同 `organization:rename`（`id` 为身份 id）。

### 人物

#### person:create

**触发**：`POST /api/persons`（纯建与一步建并指派都会广播本条；带 `identityId` 时**额外连发一条 `assign`**，`index` 为指派位置）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 新人物 id |
| `l10n` | object \| null | 初始名称槽 |

#### person:delete

**触发**：`DELETE /api/persons`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 被删人物 id（级联清担任与关系） |

#### person:rename

**触发**：`POST /api/persons/rename`——字段同 `organization:rename`（`id` 为人物 id）。

### 担任

#### assign

**触发**：`POST /api/assignments`，或 `POST /api/persons` 带 `identityId` 的第二步连发

| 字段 | 类型 | 说明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身份 id |
| `index` | number \| null | 身份内插入位置 |

#### unassign

**触发**：`DELETE /api/assignments`，或 `move-identity` 的第二步连发

| 字段 | 类型 | 说明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身份 id |

#### assign:move

**触发**：`POST /api/assignments/move`

| 字段 | 类型 | 说明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身份 id |
| `index` | number | 身份内新位置 |

**move-identity 的连发序列**：`POST /api/assignments/move-identity` 触发**三条以上消息**——先 `assign`（目标身份，含 `index`），再 `unassign`（原身份），随后每条随迁关系各发一条 `personPerson:retarget`。

### 关系

#### personPerson:create

**触发**：`POST /api/person-persons`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 新关系 id |
| `data` | object | 全量：`{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`，接收端整替换 |

#### personPerson:delete

**触发**：`DELETE /api/person-persons`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 被删关系 id |

#### personPerson:update

**触发**：`POST /api/person-persons/update`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 关系 id |
| `forward` | object \| undefined | 正向标签补丁（未传则不动） |
| `backward` | object \| undefined | 反向标签补丁 |
| `lang` | string | 写入方的 `X-Lang` |

#### personPerson:retarget

**触发**：关系端点随 `move-identity` / 身份或人物删除后的随迁重定向

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 关系 id |
| `data` | object | 端点改指后的全量关系（同 `personPerson:create` 的 `data`），接收端整替换 |

### 元信息

#### meta

**触发**：`PUT /api/meta`（authoritative_lang 切换时**连发两条**：先 `authoritative_lang` 再 `enabled_langs`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | 新值；`enabled_langs` 为逗号串；`display_name`/`bg_color` 为 meta.value |
| `l10n` | object \| undefined | 仅 `display_name`：槽表（空串清槽） |
| `lang` | string \| undefined | 仅 `display_name`：写入方的 `X-Lang` |

---

## 错误码总表

| code | HTTP | 场景 |
|---|---|---|
| `db_not_found` | 404 | 库不存在 |
| `not_found` | 404 | 未知 API 路径 |
| `org_not_found` | 404/400 | 组织不存在（删除/重命名 404；移动 400） |
| `parent_not_found` | 404 | 新建组织的父级不存在 |
| `target_org_not_found` | 400 | 移动目标组织不存在 |
| `move_to_self` | 400 | 组织移到自身 |
| `move_to_descendant` | 400 | 组织移入自己的后代 |
| `identity_not_found` | 404/400 | 身份不存在 |
| `same_target_org` | 400 | 身份移入原属组织 |
| `person_not_found` | 404 | 人物不存在 |
| `person_or_identity_not_found` | 404 | 担任端点不存在 |
| `assignment_not_found` | 400 | 担任不存在（排序） |
| `from_assignment_not_found` | 400 | 平移担任的原身份无此担任 |
| `same_target_identity` | 400 | 平移担任目标 = 原身份 |
| `target_identity_not_found` | 400 | 平移担任的目标身份不存在 |
| `relation_not_found` | 404 | 关系不存在 |
| `relation_with_self` | 400 | 关系两端为同一担任 |
| `endpoint_not_assigned` | 400 | 关系端点人物未担任对应身份 |
| `name_required` | 400 | 名称为空 / 补丁三键全无 |
| `authoritative_required` | 400 | 作准槽为空或试图清空 |
| `authoritative_lang_invalid` | 400 | 非法作准语言代码 |
| `enabled_langs_invalid` | 400 | 非法启用语言代码 |
| `bad_key` | 400 | PUT meta 未知 key |
| `internal_error` | 500 | 未捕获异常（细节只进服务端日志） |
