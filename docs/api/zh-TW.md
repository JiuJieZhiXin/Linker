# API 介面文件

Base URL：`http://<host>:<port>/<庫名>/api/…`（庫名限 `\w-`；`data/` 下每個 `.db` 一個庫）。例外：建庫介面在根路徑 `/api/create`。

語言代碼：`zh-CN` `zh-TW` `zh-HK` `en-US` `ja-JP` `ko-KR` `fr-FR` `ar-SA`（l10n 附表欄名把 `-` 換成 `_`，如 `zh_CN`）。

## 請求頭

| 頭 | 必填 | 作用 |
|---|---|---|
| `X-Lang` | 否 | 當前介面語言代碼：`value` 槽的寫入目標、建庫時作準語言的種子；未帶/非法回退預設語言 |
| `X-Client-Id` | 否 | 協作用戶端識別：伺服端廣播時按它排除回環；不帶的用戶端會收到自己寫入的廣播 |

## 通用約定

- 成功：`200`（`{data: …}` 或 `{ok: true}`）；建立：`201 {data: …}`
- 失敗：`{error: code}`（`4xx/5xx` + JSON），code 見每條「錯誤」與文末[錯誤碼總表](#錯誤碼總表)
- **名稱負載（新增用）** `{authoritative?, value?, l10n?}`：
  - `authoritative`：作準語言槽值，最終必須非空（預設回退 `value`）
  - `value`：當前介面語言槽（由 `X-Lang` 決定寫入哪個語言）
  - `l10n`：`{語言代碼: 值}` 逐槽合併（空字串忽略）
- **名稱補丁（重新命名/更新用）** `{authoritative?, value?, l10n?}`：`l10n` 逐槽 upsert，**空字串清槽**（作準槽除外）；`authoritative` 出現必須非空

---

## 建庫

### 1. 新增資料庫

`POST /api/create`（根路徑，不在庫下）

**入參**（body，`application/json` 或 `application/x-www-form-urlencoded`）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `name` | string | 是 | 庫名，限 `\w-` |

**回傳**：無 JSON 回應主體，一律 `302` 重新導向：

| 場景 | Location |
|---|---|
| 成功 | `/<name>/`（進入新庫） |
| 庫名不合法 | `/?error=illegal` |
| 庫已存在 | `/?error=exists&name=<name>` |

**說明**：作準語言種子 = 建立者的 `X-Lang`。

**錯誤**：不走 JSON，由 302 的 `error` 參數表達（`illegal` / `exists`）。

---

## 組織 organizations

### 2. 組織樹

`GET /api/organizations`

**入參**：無

**回傳** `200`：

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**錯誤**：`db_not_found`

### 3. 新增組織

`POST /api/organizations`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `parentId` | string | 否 | 父組織 id；預設 = 一級組織 |
| `index` | number | 否 | 同層插入位置（預設末尾） |
| `…名稱負載` | — | 是 | `{authoritative?, value?, l10n?}`，見通用約定 |

**回傳** `201`：`{"data": {"id": "uuid"}}`

**錯誤**：`400 name_required`、`400 authoritative_required`、`404 parent_not_found`

### 4. 移動組織

`POST /api/organizations/move`（換父級 / 同層排序；禁止移入自身或後代）

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | 是 | 組織 id |
| `parentId` | string \| null | 是 | 新父組織 id；`null` = 提到一級 |
| `index` | number | 否 | 目標同層列表中的位置 |

**回傳** `200`：`{"data": {"ok": true}}`

**錯誤**：`400 move_to_self`、`400 org_not_found`、`400 target_org_not_found`、`400 move_to_descendant`

### 5. 刪除組織

`DELETE /api/organizations?id=<id>`

**入參**（query）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | 是 | 組織 id |
| `promote` | `1` | 否 | 預設：遞推刪除整棵子樹；`promote=1`：保留下級，提升到被刪組織原位 |

**回傳** `200`：`{"ok": true}`

**錯誤**：`404 org_not_found`

### 6. 重新命名組織

`POST /api/organizations/rename`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | 是 | 組織 id |
| `…名稱補丁` | — | 是 | `{authoritative?, value?, l10n?}`，見通用約定 |

**回傳** `200`：`{"ok": true}`

**錯誤**：`400 authoritative_required`、`400 name_required`、`404 org_not_found`

---

## 身分 identities

### 7. 新增身分

`POST /api/identities`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `organizationId` | string | 是 | 所屬組織 id |
| `index` | number | 否 | 組織內插入位置（預設末尾） |
| `…名稱負載` | — | 是 | 見通用約定 |

**回傳** `201`：`{"data": {"id": "uuid"}}`

**錯誤**：`400 name_required`、`400 authoritative_required`、`404 org_not_found`

### 8. 身分排序

`POST /api/identities/move`（僅組織內排序，不改組織）

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | 是 | 身分 id |
| `index` | number | 是 | 組織內新位置 |

**回傳** `200`：`{"data": {"ok": true}}`

**錯誤**：`400 identity_not_found`

### 9. 身分跨組織移動

`POST /api/identities/move-organization`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `identityId` | string | 是 | 身分 id |
| `organizationId` | string | 是 | 目標組織 id |
| `index` | number | 否 | 目標組織內位置 |

**說明**：擔任與關係參照 `identity_id` 不變，自動隨遷。

**回傳** `200`：`{"data": {"ok": true}}`

**錯誤**：`400 identity_not_found`、`400 target_org_not_found`、`400 same_target_org`

### 10. 刪除身分

`DELETE /api/identities?id=<id>`

**入參**（query）：`id`（string，必填）——身分 id

**回傳** `200`：`{"ok": true}`（級聯清擔任與關係端點）

**錯誤**：`404 identity_not_found`

### 11. 重新命名身分

`POST /api/identities/rename`

**入參**（body）：`id`（string，必填）+ 名稱補丁

**回傳** `200`：`{"ok": true}`

**錯誤**：`400 authoritative_required`、`400 name_required`、`404 identity_not_found`

---

## 人物 persons

### 12. 人物列表

`GET /api/persons`

**入參**：無

**回傳** `200`：`{"data": [{"id": "uuid"}]}`（名稱在 l10n 附表，經 `GET /api/l10n` 取）

**錯誤**：`db_not_found`

### 13. 新增人物（可一步指派）

`POST /api/persons`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `…名稱負載` | — | 是 | 見通用約定 |
| `identityId` | string | 否 | 傳入 = 一步「新增並指派」到該身分 |
| `index` | number | 否 | 該身分內的插入位置（配 `identityId` 使用） |

**回傳** `201`：純建 `{"data": {"id": "uuid"}}`；帶指派 `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**錯誤**：`400 name_required`、`400 authoritative_required`、`404 identity_not_found`

### 14. 刪除人物

`DELETE /api/persons?id=<id>`

**入參**（query）：`id`（string，必填）——人物 id

**回傳** `200`：`{"ok": true}`（級聯清擔任與關係）

**錯誤**：`404 person_not_found`

### 15. 重新命名人物

`POST /api/persons/rename`

**入參**（body）：`id`（string，必填）+ 名稱補丁

**回傳** `200`：`{"ok": true}`

**錯誤**：`400 authoritative_required`、`400 name_required`、`404 person_not_found`

---

## 擔任 assignments（身分-人物關聯）

### 16. 建立擔任

`POST /api/assignments`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `identityId` | string | 是 | 身分 id |
| `index` | number | 否 | 身分內插入位置（預設末尾） |

**說明**：冪等，重複建立不產生副作用。

**回傳** `200`：`{"data": {"personId": "uuid", "identityId": "uuid"}}`

**錯誤**：`404 person_or_identity_not_found`

### 17. 解除擔任

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**入參**（query）：`personId`、`identityId`（均必填）

**回傳** `200`：`{"ok": true}`（關聯不存在也回傳成功）

**錯誤**：無專用錯誤碼

### 18. 擔任排序

`POST /api/assignments/move`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `identityId` | string | 是 | 身分 id |
| `index` | number | 是 | 身分內新位置 |

**回傳** `200`：`{"data": {"ok": true}}`

**錯誤**：`400 assignment_not_found`

### 19. 平移擔任（跨身分）

`POST /api/assignments/move-identity`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `personId` | string | 是 | 人物 id |
| `fromIdentityId` | string | 是 | 原身分 id |
| `toIdentityId` | string | 是 | 目標身分 id（同一人物） |
| `index` | number | 否 | 目標身分內位置 |

**說明**：關係端點隨遷（回應 `data.ids` 為隨遷重導向的關係 id 列表）。

**回傳** `200`：`{"data": {"ok": true, "ids": ["uuid"]}}`

**錯誤**：`400 from_assignment_not_found`、`400 same_target_identity`、`400 target_identity_not_found`

---

## 關係 person-persons

### 20. 關係列表

`GET /api/person-persons`

**入參**：無

**回傳** `200`：`{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}`（標籤經 `GET /api/l10n` 取）

**錯誤**：`db_not_found`

### 21. 新增關係

`POST /api/person-persons`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `aPersonId` | string | 是 | A 端人物 id |
| `aIdentityId` | string | 是 | A 端身分 id（該人物須已擔任） |
| `bPersonId` | string | 是 | B 端人物 id |
| `bIdentityId` | string | 是 | B 端身分 id |
| `forward` | object | 是 | A→B 方向名稱負載（作準槽必填） |
| `backward` | object | 是 | B→A 方向名稱負載（作準槽必填） |

**回傳** `201`：`{"data": {"id": "uuid"}}`

**錯誤**：`400 authoritative_required`（任一方向作準槽為空）、`400 relation_with_self`、`400 endpoint_not_assigned`

### 22. 刪除關係

`DELETE /api/person-persons?id=<id>`

**入參**（query）：`id`（string，必填）

**回傳** `200`：`{"ok": true}`（關係不存在也回傳成功）

**錯誤**：無專用錯誤碼

### 23. 更新關係標籤

`POST /api/person-persons/update`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | 是 | 關係 id |
| `forward` | object | 否 | 方向名稱補丁（不傳則不動該方向） |
| `backward` | object | 否 | 同上 |

**回傳** `200`：`{"ok": true}`

**錯誤**：`400 name_required`（兩方向全缺）、`400 authoritative_required`、`404 relation_not_found`

---

## 中繼資料 meta

### 24. 讀取中繼資料

`GET /api/meta`

**入參**：無

**回傳** `200`：

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]}}
```

**錯誤**：`db_not_found`

### 25. 設定中繼資料

`PUT /api/meta`

**入參**（body）

| 參數 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `key` | string | 是 | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| 其餘欄位 | — | 視 key | 見下表 |

| key | 負載語義 |
|---|---|
| `display_name` | 名稱補丁：`description→value`、`value→當前語言槽`、`l10n→逐槽`；全空 = 清除設定 |
| `bg_color` | `{value}` 或 `{description}`：rgba 字串；空 = 刪列回復預設全透明 |
| `authoritative_lang` | `{value}`：語言代碼；新作準自動納入啟用集，並隨本次切換連發兩條 meta 廣播 |
| `enabled_langs` | `{value}`：陣列或逗號串；伺服端自動補作準語言、恆在首位 |

**回傳** `200`：`{"data": …}`（authoritative/enabled 回傳 `{"id": key, "value": …}`；另兩個回傳寫入結果）

**錯誤**：`400 bad_key`、`400 authoritative_lang_invalid`、`400 enabled_langs_invalid`、`400 authoritative_required`

---

## l10n 槽

### 26. 全量語言槽

`GET /api/l10n`

**入參**：無

**回傳** `200`：`{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}`——各為列陣列，列 = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_CN"?: "…", …}`（語言欄只列非空槽）

**錯誤**：`db_not_found`

---

## 匯出 export

### 27. JSON 匯出

`GET /api/export/json`

**入參**：無

**回傳** `200`：

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**說明**：`l10n` 只含**啟用語言**的欄。

**錯誤**：`db_not_found`

### 28. DB 匯出

`GET /api/export/db`

**入參**：無

**回傳** `200`：`Content-Type: application/octet-stream`——原始庫檔案（VACUUM INTO 一致性快照），可直接存為 `.db`

**錯誤**：`db_not_found`

---

## WebSocket 協作廣播

- 連線：`/<庫名>/ws?cid=<用戶端id>`
- REST 寫入成功後，伺服端向同庫其他用戶端廣播文字 JSON 訊息；每條訊息都帶 `clientId` 欄位（發起者的 `X-Client-Id`），收到自己 `clientId` 的訊息直接跳過（樂觀更新已先行上屏）
- 欄位型別約定：`id` / `personId` / `identityId` / `organizationId` 為 uuid 字串；`index` 為 number 或 null；`l10n` 為 `{語言代碼: 值}` 槽表或 null；`lang` 為寫入方的 `X-Lang`

### 組織

#### organization:create

**觸發**：`POST /api/organizations`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 新組織 id |
| `parentId` | string \| null | 父組織 id（null = 一級） |
| `index` | number \| null | 同層插入位置 |
| `l10n` | object \| null | 初始名稱槽 |

#### organization:move

**觸發**：`POST /api/organizations/move`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 組織 id |
| `parentId` | string \| null | 新父組織 id（null = 提到一級） |
| `index` | number \| null | 目標同層位置 |

#### organization:delete

**觸發**：`DELETE /api/organizations`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 被刪組織 id |
| `mode` | string | 僅保留下級提升時為 `promote`；欄位省略 = 遞推刪除整棵子樹 |

#### organization:rename

**觸發**：`POST /api/organizations/rename`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 組織 id |
| `authoritative` | string \| undefined | 作準槽新值（未傳則不變） |
| `value` | string \| undefined | 寫入方當前語言槽新值 |
| `l10n` | object \| undefined | 逐槽 upsert（空字串清槽，作準槽除外） |
| `lang` | string | 寫入方的 `X-Lang` |

### 身分

#### identity:create

**觸發**：`POST /api/identities`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 新身分 id |
| `organizationId` | string | 所屬組織 id |
| `index` | number \| null | 組織內插入位置 |
| `l10n` | object \| null | 初始名稱槽 |

#### identity:move

**觸發**：`POST /api/identities/move`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 身分 id |
| `index` | number \| null | 組織內新位置 |

#### identity:move-organization

**觸發**：`POST /api/identities/move-organization`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 身分 id |
| `organizationId` | string | 目標組織 id |
| `index` | number \| null | 目標組織內位置 |

#### identity:delete

**觸發**：`DELETE /api/identities`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 被刪身分 id（級聯清擔任與關係端點） |

#### identity:rename

**觸發**：`POST /api/identities/rename`——欄位同 `organization:rename`（`id` 為身分 id）。

### 人物

#### person:create

**觸發**：`POST /api/persons`（純建與一步建並指派都會廣播本條；帶 `identityId` 時**額外連發一條 `assign`**，`index` 為指派位置）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 新人物 id |
| `l10n` | object \| null | 初始名稱槽 |

#### person:delete

**觸發**：`DELETE /api/persons`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 被刪人物 id（級聯清擔任與關係） |

#### person:rename

**觸發**：`POST /api/persons/rename`——欄位同 `organization:rename`（`id` 為人物 id）。

### 擔任

#### assign

**觸發**：`POST /api/assignments`，或 `POST /api/persons` 帶 `identityId` 的第二步連發

| 欄位 | 型別 | 說明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |
| `index` | number \| null | 身分內插入位置 |

#### unassign

**觸發**：`DELETE /api/assignments`，或 `move-identity` 的第二步連發

| 欄位 | 型別 | 說明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |

#### assign:move

**觸發**：`POST /api/assignments/move`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |
| `index` | number | 身分內新位置 |

**move-identity 的連發序列**：`POST /api/assignments/move-identity` 觸發**三條以上訊息**——先 `assign`（目標身分，含 `index`），再 `unassign`（原身分），隨後每條隨遷關係各發一條 `personPerson:retarget`。

### 關係

#### personPerson:create

**觸發**：`POST /api/person-persons`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 新關係 id |
| `data` | object | 全量：`{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`，接收端整替換 |

#### personPerson:delete

**觸發**：`DELETE /api/person-persons`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 被刪關係 id |

#### personPerson:update

**觸發**：`POST /api/person-persons/update`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 關係 id |
| `forward` | object \| undefined | 正向標籤補丁（未傳則不動） |
| `backward` | object \| undefined | 反向標籤補丁 |
| `lang` | string | 寫入方的 `X-Lang` |

#### personPerson:retarget

**觸發**：關係端點隨 `move-identity` / 身分或人物刪除後的隨遷重導向

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 關係 id |
| `data` | object | 端點改指後的全量關係（同 `personPerson:create` 的 `data`），接收端整替換 |

### 中繼資料

#### meta

**觸發**：`PUT /api/meta`（authoritative_lang 切換時**連發兩條**：先 `authoritative_lang` 再 `enabled_langs`）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | 新值；`enabled_langs` 為逗號串；`display_name`/`bg_color` 為 meta.value |
| `l10n` | object \| undefined | 僅 `display_name`：槽表（空字串清槽） |
| `lang` | string \| undefined | 僅 `display_name`：寫入方的 `X-Lang` |

---

## 錯誤碼總表

| code | HTTP | 場景 |
|---|---|---|
| `db_not_found` | 404 | 庫不存在 |
| `not_found` | 404 | 未知 API 路徑 |
| `org_not_found` | 404/400 | 組織不存在（刪除/重新命名 404；移動 400） |
| `parent_not_found` | 404 | 新增組織的父級不存在 |
| `target_org_not_found` | 400 | 移動目標組織不存在 |
| `move_to_self` | 400 | 組織移到自身 |
| `move_to_descendant` | 400 | 組織移入自己的後代 |
| `identity_not_found` | 404/400 | 身分不存在 |
| `same_target_org` | 400 | 身分移入原屬組織 |
| `person_not_found` | 404 | 人物不存在 |
| `person_or_identity_not_found` | 404 | 擔任端點不存在 |
| `assignment_not_found` | 400 | 擔任不存在（排序） |
| `from_assignment_not_found` | 400 | 平移擔任的原身分無此擔任 |
| `same_target_identity` | 400 | 平移擔任目標 = 原身分 |
| `target_identity_not_found` | 400 | 平移擔任的目標身分不存在 |
| `relation_not_found` | 404 | 關係不存在 |
| `relation_with_self` | 400 | 關係兩端為同一擔任 |
| `endpoint_not_assigned` | 400 | 關係端點人物未擔任對應身分 |
| `name_required` | 400 | 名稱為空 / 補丁三鍵全無 |
| `authoritative_required` | 400 | 作準槽為空或試圖清空 |
| `authoritative_lang_invalid` | 400 | 非法作準語言代碼 |
| `enabled_langs_invalid` | 400 | 非法啟用語言代碼 |
| `bad_key` | 400 | PUT meta 未知 key |
| `internal_error` | 500 | 未捕捉例外（細節只進伺服端日誌） |
