# API インターフェースドキュメント

Base URL：`http://<host>:<port>/<データベース名>/api/…`（データベース名は `\w-` に制限。`data/` 下の各 `.db` が1つのデータベース）。例外：データベース作成インターフェースはルートパス `/api/create` にあります。

言語コード：`zh-CN` `zh-TW` `zh-HK` `en-US` `ja-JP` `ko-KR` `fr-FR` `ar-SA`（l10n 付属表の列名は `-` を `_` に変えます。例：`zh_CN`）。

## リクエストヘッダー

| ヘッダー | 必須 | 役割 |
|---|---|---|
| `X-Lang` | いいえ | 現在の表示言語コード：`value` スロットの書き込み先、データベース作成時の作準言語の種。未指定／不正な値はデフォルト言語にフォールバック |
| `X-Client-Id` | いいえ | コラボレーションのクライアント識別子：サーバーはブロードキャスト時にこれで自身へのループを除外します。付けないクライアントは自分の書き込みのブロードキャストも受け取ります |

## 共通の取り決め

- 成功：`200`（`{data: …}` または `{ok: true}`）；作成：`201 {data: …}`
- 失敗：`{error: code}`（`4xx/5xx` ＋ JSON）。code は各項目の「エラー」と文末の[エラーコード一覧](#エラーコード一覧)を参照
- **名前ペイロード（新規作成用）** `{authoritative?, value?, l10n?}`：
  - `authoritative`：作準言語スロットの値。最終的に非空必須（省略時は `value` にフォールバック）
  - `value`：現在の表示言語スロット（`X-Lang` がどの言語に書き込むかを決定）
  - `l10n`：`{言語コード: 値}` をスロットごとにマージ（空文字列は無視）
- **名前パッチ（リネーム／更新用）** `{authoritative?, value?, l10n?}`：`l10n` はスロットごとに upsert。**空文字列でクリア**（作準スロットは除く）。`authoritative` を指定した場合は非空必須

---

## データベース作成

### 1. データベースの新規作成

`POST /api/create`（ルートパス。データベースの下ではありません）

**入力パラメータ**（body、`application/json` または `application/x-www-form-urlencoded`）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | はい | データベース名。`\w-` に制限 |

**返却**：JSON レスポンスボディはなく、常に `302` リダイレクト：

| シナリオ | Location |
|---|---|
| 成功 | `/<name>/`（新しいデータベースに入る） |
| データベース名が不正 | `/?error=illegal` |
| データベースが既に存在 | `/?error=exists&name=<name>` |

**説明**：作準言語の種 ＝ 作成者の `X-Lang`。

**エラー**：JSON を経由せず、302 の `error` パラメータで表現（`illegal`／`exists`）。

---

## 組織 organizations

### 2. 組織ツリー

`GET /api/organizations`

**入力パラメータ**：なし

**返却** `200`：

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**エラー**：`db_not_found`

### 3. 組織の新規作成

`POST /api/organizations`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `parentId` | string | いいえ | 親組織 id。デフォルト ＝ 第一レベルの組織 |
| `index` | number | いいえ | 兄弟内の挿入位置（デフォルトは末尾） |
| `…名前ペイロード` | — | はい | `{authoritative?, value?, l10n?}`。共通の取り決めを参照 |

**返却** `201`：`{"data": {"id": "uuid"}}`

**エラー**：`400 name_required`、`400 authoritative_required`、`404 parent_not_found`

### 4. 組織の移動

`POST /api/organizations/move`（親の付け替え／兄弟内の並べ替え。自身または子孫への移動は禁止）

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | はい | 組織 id |
| `parentId` | string \| null | はい | 新しい親組織 id。`null` ＝ 第一レベルに引き上げ |
| `index` | number | いいえ | 対象の兄弟リスト内の位置 |

**返却** `200`：`{"data": {"ok": true}}`

**エラー**：`400 move_to_self`、`400 org_not_found`、`400 target_org_not_found`、`400 move_to_descendant`

### 5. 組織の削除

`DELETE /api/organizations?id=<id>`

**入力パラメータ**（query）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | はい | 組織 id |
| `promote` | `1` | いいえ | デフォルト：子ツリーごと再帰削除。`promote=1`：下位を保持して、削除した組織の元の位置に引き上げ |

**返却** `200`：`{"ok": true}`

**エラー**：`404 org_not_found`

### 6. 組織のリネーム

`POST /api/organizations/rename`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | はい | 組織 id |
| `…名前パッチ` | — | はい | `{authoritative?, value?, l10n?}`。共通の取り決めを参照 |

**返却** `200`：`{"ok": true}`

**エラー**：`400 authoritative_required`、`400 name_required`、`404 org_not_found`

---

## 身分 identities

### 7. 身分の新規作成

`POST /api/identities`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `organizationId` | string | はい | 所属組織 id |
| `index` | number | いいえ | 組織内の挿入位置（デフォルトは末尾） |
| `…名前ペイロード` | — | はい | 共通の取り決めを参照 |

**返却** `201`：`{"data": {"id": "uuid"}}`

**エラー**：`400 name_required`、`400 authoritative_required`、`404 org_not_found`

### 8. 身分の並べ替え

`POST /api/identities/move`（組織内の並べ替えのみ。組織は変えません）

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | はい | 身分 id |
| `index` | number | はい | 組織内の新しい位置 |

**返却** `200`：`{"data": {"ok": true}}`

**エラー**：`400 identity_not_found`

### 9. 身分の組織間移動

`POST /api/identities/move-organization`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `identityId` | string | はい | 身分 id |
| `organizationId` | string | はい | 対象の組織 id |
| `index` | number | いいえ | 対象組織内の位置 |

**説明**：配属と関係の `identity_id` 参照は変わらず、自動的に伴って移動します。

**返却** `200`：`{"data": {"ok": true}}`

**エラー**：`400 identity_not_found`、`400 target_org_not_found`、`400 same_target_org`

### 10. 身分の削除

`DELETE /api/identities?id=<id>`

**入力パラメータ**（query）：`id`（string、必須）—— 身分 id

**返却** `200`：`{"ok": true}`（配属と関係の端点をカスケードでクリア）

**エラー**：`404 identity_not_found`

### 11. 身分のリネーム

`POST /api/identities/rename`

**入力パラメータ**（body）：`id`（string、必須）＋ 名前パッチ

**返却** `200`：`{"ok": true}`

**エラー**：`400 authoritative_required`、`400 name_required`、`404 identity_not_found`

---

## 人物 persons

### 12. 人物リスト

`GET /api/persons`

**入力パラメータ**：なし

**返却** `200`：`{"data": [{"id": "uuid"}]}`（名前は l10n 付属表にあり、`GET /api/l10n` で取得）

**エラー**：`db_not_found`

### 13. 人物の新規作成（ワンステップでの割り当ても可）

`POST /api/persons`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `…名前ペイロード` | — | はい | 共通の取り決めを参照 |
| `identityId` | string | いいえ | 指定すると、その身分への「新規作成して割り当て」をワンステップで行います |
| `index` | number | いいえ | その身分内の挿入位置（`identityId` と併用） |

**返却** `201`：純粋作成の場合 `{"data": {"id": "uuid"}}`；割り当て付きの場合 `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**エラー**：`400 name_required`、`400 authoritative_required`、`404 identity_not_found`

### 14. 人物の削除

`DELETE /api/persons?id=<id>`

**入力パラメータ**（query）：`id`（string、必須）—— 人物 id

**返却** `200`：`{"ok": true}`（配属と関係をカスケードでクリア）

**エラー**：`404 person_not_found`

### 15. 人物のリネーム

`POST /api/persons/rename`

**入力パラメータ**（body）：`id`（string、必須）＋ 名前パッチ

**返却** `200`：`{"ok": true}`

**エラー**：`400 authoritative_required`、`400 name_required`、`404 person_not_found`

---

## 配属 assignments（身分ー人物の関連付け）

### 16. 配属の作成

`POST /api/assignments`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `personId` | string | はい | 人物 id |
| `identityId` | string | はい | 身分 id |
| `index` | number | いいえ | 身分内の挿入位置（デフォルトは末尾） |

**説明**：冪等。重複して作成しても副作用はありません。

**返却** `200`：`{"data": {"personId": "uuid", "identityId": "uuid"}}`

**エラー**：`404 person_or_identity_not_found`

### 17. 配属の解除

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**入力パラメータ**（query）：`personId`、`identityId`（ともに必須）

**返却** `200`：`{"ok": true}`（関連が存在しなくても成功を返します）

**エラー**：専用のエラーコードなし

### 18. 配属の並べ替え

`POST /api/assignments/move`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `personId` | string | はい | 人物 id |
| `identityId` | string | はい | 身分 id |
| `index` | number | はい | 身分内の新しい位置 |

**返却** `200`：`{"data": {"ok": true}}`

**エラー**：`400 assignment_not_found`

### 19. 配属の移動（身分間）

`POST /api/assignments/move-identity`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `personId` | string | はい | 人物 id |
| `fromIdentityId` | string | はい | 元の身分 id |
| `toIdentityId` | string | はい | 対象の身分 id（同一人物） |
| `index` | number | いいえ | 対象身分内の位置 |

**説明**：関係の端点も伴って移動します（レスポンスの `data.ids` は、移動先へリダイレクトされた関係 id のリスト）。

**返却** `200`：`{"data": {"ok": true, "ids": ["uuid"]}}`

**エラー**：`400 from_assignment_not_found`、`400 same_target_identity`、`400 target_identity_not_found`

---

## 関係 person-persons

### 20. 関係リスト

`GET /api/person-persons`

**入力パラメータ**：なし

**返却** `200`：`{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}`（ラベルは `GET /api/l10n` で取得）

**エラー**：`db_not_found`

### 21. 関係の新規作成

`POST /api/person-persons`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `aPersonId` | string | はい | A 端の人物 id |
| `aIdentityId` | string | はい | A 端の身分 id（その人物が配属済みであること） |
| `bPersonId` | string | はい | B 端の人物 id |
| `bIdentityId` | string | はい | B 端の身分 id |
| `forward` | object | はい | A→B 方向の名前ペイロード（作準スロット必須） |
| `backward` | object | はい | B→A 方向の名前ペイロード（作準スロット必須） |

**返却** `201`：`{"data": {"id": "uuid"}}`

**エラー**：`400 authoritative_required`（いずれかの方向の作準スロットが空）、`400 relation_with_self`、`400 endpoint_not_assigned`

### 22. 関係の削除

`DELETE /api/person-persons?id=<id>`

**入力パラメータ**（query）：`id`（string、必須）

**返却** `200`：`{"ok": true}`（関係が存在しなくても成功を返します）

**エラー**：専用のエラーコードなし

### 23. 関係ラベルの更新

`POST /api/person-persons/update`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | はい | 関係 id |
| `forward` | object | いいえ | 順方向ラベルのパッチ（未指定の場合はその方向を変更しません） |
| `backward` | object | いいえ | 同上 |

**返却** `200`：`{"ok": true}`

**エラー**：`400 name_required`（両方向とも未指定）、`400 authoritative_required`、`404 relation_not_found`

---

## メタ情報 meta

### 24. メタ情報の読み取り

`GET /api/meta`

**入力パラメータ**：なし

**返却** `200`：

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]}}
```

**エラー**：`db_not_found`

### 25. メタ情報の設定

`PUT /api/meta`

**入力パラメータ**（body）

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `key` | string | はい | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| その他のフィールド | — | key による | 下表を参照 |

| key | ペイロードの意味 |
|---|---|
| `display_name` | 名前パッチ：`description→value`、`value→現在の言語スロット`、`l10n→スロットごと`。すべて空 ＝ 設定をクリア |
| `bg_color` | `{value}` または `{description}`：rgba 文字列。空 ＝ 行を削除してデフォルトの全透明に復元 |
| `authoritative_lang` | `{value}`：言語コード。新しい作準言語は有効セットに自動的に追加され、この切り替えでは meta ブロードキャストを2件連続で発行します |
| `enabled_langs` | `{value}`：配列またはコンマ区切りの文字列。サーバーは作準言語を自動的に補い、常に先頭に置きます |

**返却** `200`：`{"data": …}`（authoritative／enabled の場合は `{"id": key, "value": …}` を返します。残りの2つは書き込み結果を返します）

**エラー**：`400 bad_key`、`400 authoritative_lang_invalid`、`400 enabled_langs_invalid`、`400 authoritative_required`

---

## l10n スロット

### 26. 全量言語スロット

`GET /api/l10n`

**入力パラメータ**：なし

**返却** `200`：`{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}`——それぞれ行の配列で、行 ＝ `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_CN"?: "…", …}`（言語列は非空スロットのみを列挙）

**エラー**：`db_not_found`

---

## エクスポート export

### 27. JSON エクスポート

`GET /api/export/json`

**入力パラメータ**：なし

**返却** `200`：

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-CN", "enabledLangs": ["zh-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**説明**：`l10n` には**有効言語**の列のみが含まれます。

**エラー**：`db_not_found`

### 28. DB エクスポート

`GET /api/export/db`

**入力パラメータ**：なし

**返却** `200`：`Content-Type: application/octet-stream`——元のデータベースファイル（VACUUM INTO による一貫性スナップショット）で、`.db` としてそのまま保存できます

**エラー**：`db_not_found`

---

## WebSocket コラボレーションブロードキャスト

- 接続：`/<データベース名>/ws?cid=<クライアントid>`
- REST 書き込みが成功すると、サーバーは同一データベースの他のクライアントにテキスト JSON メッセージをブロードキャストします。各メッセージには `clientId` フィールド（発起者の `X-Client-Id`）が付き、自分の `clientId` を持つメッセージは読み飛ばします（楽観的更新が先に画面へ反映済みのため）。
- フィールド型の取り決め：`id`／`personId`／`identityId`／`organizationId` は uuid 文字列。`index` は number または null。`l10n` は `{言語コード: 値}` のスロット表または null。`lang` は書き込み側の `X-Lang`

### 組織

#### organization:create

**トリガー**：`POST /api/organizations`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 新しい組織 id |
| `parentId` | string \| null | 親組織 id（null ＝ 第一レベル） |
| `index` | number \| null | 兄弟内の挿入位置 |
| `l10n` | object \| null | 初期の名前スロット |

#### organization:move

**トリガー**：`POST /api/organizations/move`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 組織 id |
| `parentId` | string \| null | 新しい親組織 id（null ＝ 第一レベルに引き上げ） |
| `index` | number \| null | 対象の兄弟内の位置 |

#### organization:delete

**トリガー**：`DELETE /api/organizations`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 削除された組織 id |
| `mode` | string | 下位のみを保持して引き上げる場合は `promote`。フィールドがなければ ＝ 子ツリーごと再帰削除 |

#### organization:rename

**トリガー**：`POST /api/organizations/rename`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 組織 id |
| `authoritative` | string \| undefined | 作準スロットの新しい値（未指定の場合は変更なし） |
| `value` | string \| undefined | 書き込み側の現在言語スロットの新しい値 |
| `l10n` | object \| undefined | スロットごとに upsert（空文字列でクリア。作準スロットは除く） |
| `lang` | string | 書き込み側の `X-Lang` |

### 身分

#### identity:create

**トリガー**：`POST /api/identities`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 新しい身分 id |
| `organizationId` | string | 所属組織 id |
| `index` | number \| null | 組織内の挿入位置 |
| `l10n` | object \| null | 初期の名前スロット |

#### identity:move

**トリガー**：`POST /api/identities/move`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 身分 id |
| `index` | number \| null | 組織内の新しい位置 |

#### identity:move-organization

**トリガー**：`POST /api/identities/move-organization`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 身分 id |
| `organizationId` | string | 対象の組織 id |
| `index` | number \| null | 対象組織内の位置 |

#### identity:delete

**トリガー**：`DELETE /api/identities`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 削除された身分 id（配属と関係の端点をカスケードでクリア） |

#### identity:rename

**トリガー**：`POST /api/identities/rename`——フィールドは `organization:rename` と同じ（`id` は身分 id）。

### 人物

#### person:create

**トリガー**：`POST /api/persons`（純粋作成もワンステップの作成＋割り当ても、どちらもこのメッセージをブロードキャストします。`identityId` 付きの場合は**さらに `assign` を1件連続で発行**し、`index` は割り当て位置です）

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 新しい人物 id |
| `l10n` | object \| null | 初期の名前スロット |

#### person:delete

**トリガー**：`DELETE /api/persons`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 削除された人物 id（配属と関係をカスケードでクリア） |

#### person:rename

**トリガー**：`POST /api/persons/rename`——フィールドは `organization:rename` と同じ（`id` は人物 id）。

### 配属

#### assign

**トリガー**：`POST /api/assignments`、または `POST /api/persons` に `identityId` を付けた場合の第2ステップとして連続発行

| フィールド | 型 | 説明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |
| `index` | number \| null | 身分内の挿入位置 |

#### unassign

**トリガー**：`DELETE /api/assignments`、または `move-identity` の第2ステップとして連続発行

| フィールド | 型 | 説明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |

#### assign:move

**トリガー**：`POST /api/assignments/move`

| フィールド | 型 | 説明 |
|---|---|---|
| `personId` | string | 人物 id |
| `identityId` | string | 身分 id |
| `index` | number | 身分内の新しい位置 |

**move-identity の連続発行シーケンス**：`POST /api/assignments/move-identity` は**3件以上のメッセージ**を発行します——まず `assign`（対象身分、`index` 付き）、次に `unassign`（元の身分）、その後、伴って移動する関係ごとに `personPerson:retarget` を1件ずつ。

### 関係

#### personPerson:create

**トリガー**：`POST /api/person-persons`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 新しい関係 id |
| `data` | object | 全量：`{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`。受信側は丸ごと置き換えます |

#### personPerson:delete

**トリガー**：`DELETE /api/person-persons`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 削除された関係 id |

#### personPerson:update

**トリガー**：`POST /api/person-persons/update`

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 関係 id |
| `forward` | object \| undefined | 順方向ラベルのパッチ（未指定の場合は変更なし） |
| `backward` | object \| undefined | 逆方向ラベルのパッチ |
| `lang` | string | 書き込み側の `X-Lang` |

#### personPerson:retarget

**トリガー**：関係の端点が `move-identity`／身分または人物の削除に伴って移動先へリダイレクトされた場合

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 関係 id |
| `data` | object | 端点の向き先を変えた全量の関係（`personPerson:create` の `data` と同じ）。受信側は丸ごと置き換えます |

### メタ情報

#### meta

**トリガー**：`PUT /api/meta`（authoritative_lang 切り替え時は**2件連続で発行**：先に `authoritative_lang`、次に `enabled_langs`）

| フィールド | 型 | 説明 |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | 新しい値。`enabled_langs` はコンマ区切りの文字列。`display_name`／`bg_color` は meta.value |
| `l10n` | object \| undefined | `display_name` のみ：スロット表（空文字列でクリア） |
| `lang` | string \| undefined | `display_name` のみ：書き込み側の `X-Lang` |

---

## エラーコード一覧

| code | HTTP | シナリオ |
|---|---|---|
| `db_not_found` | 404 | データベースが存在しません |
| `not_found` | 404 | 不明な API パス |
| `org_not_found` | 404/400 | 組織が存在しません（削除／リネームで 404。移動で 400） |
| `parent_not_found` | 404 | 新規作成する組織の親が存在しません |
| `target_org_not_found` | 400 | 移動先の組織が存在しません |
| `move_to_self` | 400 | 組織を自身へ移動 |
| `move_to_descendant` | 400 | 組織を自分の子孫へ移動 |
| `identity_not_found` | 404/400 | 身分が存在しません |
| `same_target_org` | 400 | 身分を元の所属組織へ移動 |
| `person_not_found` | 404 | 人物が存在しません |
| `person_or_identity_not_found` | 404 | 配属の端点が存在しません |
| `assignment_not_found` | 400 | 配属が存在しません（並べ替え） |
| `from_assignment_not_found` | 400 | 移動元の身分にその配属がありません |
| `same_target_identity` | 400 | 移動先の身分 ＝ 元の身分 |
| `target_identity_not_found` | 400 | 移動先の身分が存在しません |
| `relation_not_found` | 404 | 関係が存在しません |
| `relation_with_self` | 400 | 関係の両端が同一の配属 |
| `endpoint_not_assigned` | 400 | 関係の端点の人物が対応する身分に配属されていません |
| `name_required` | 400 | 名前が空／パッチの3キーがすべて未指定 |
| `authoritative_required` | 400 | 作準スロットが空、またはクリアしようとしています |
| `authoritative_lang_invalid` | 400 | 不正な作準言語コード |
| `enabled_langs_invalid` | 400 | 不正な有効言語コード |
| `bad_key` | 400 | PUT meta の未知の key |
| `internal_error` | 500 | 捕捉されていない例外（詳細はサーバーログにのみ記録） |
