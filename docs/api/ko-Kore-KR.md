# API 인터페이스 문서

Base URL: `http://<host>:<port>/<데이터베이스명>/api/…`(데이터베이스명은 `\w-`로 제한. `data/` 아래 각 `.db`가 하나의 데이터베이스). 예외: 데이터베이스 생성 인터페이스는 루트 경로 `/api/create`에 있습니다.

언어 코드: `zh-Hans-CN` `zh-Hant-TW` `zh-Hant-HK` `en-Latn-GB` `en-Latn-US` `ja-Jpan-JP` `ko-Kore-KR` `th-Thai-TH` `fr-Latn-FR` `ar-Arab-SA`(l10n 부속 테이블의 열 이름은 `-`를 `_`로 바꿉니다, 예: `zh_Hans_CN`).

## 요청 헤더

| 헤더 | 필수 | 역할 |
|---|---|---|
| `X-Lang` | 아니오 | 현재 화면 언어 코드: `value` 슬롯의 쓰기 대상, 데이터베이스 생성 시 기준 언어의 씨앗값. 생략하거나 불법 값이면 기본 언어로 폴백 |
| `X-Client-Id` | 아니오 | 협업 클라이언트 식별자: 서버는 브로드캐스트할 때 이 값으로 루프백을 제외합니다. 이 헤더를 보내지 않는 클라이언트는 자기가 쓴 브로드캐스트도 받습니다 |

## 공통 규약

- 성공: `200`(`{data: …}` 또는 `{ok: true}`). 생성: `201 {data: …}`
- 실패: `{error: code}`(`4xx/5xx` + JSON). code는 각 항목의 「오류」와 문말의 [오류 코드 총표](#오류-코드-총표)를 참조합니다
- **이름 페이로드(생성용)** `{authoritative?, value?, l10n?}`:
  - `authoritative`: 기준 언어 슬롯값으로, 최종적으로 반드시 비어 있지 않아야 합니다(생략하면 `value`가 대신 쓰입니다)
  - `value`: 현재 화면 언어 슬롯(`X-Lang`이 어느 언어 슬롯에 쓸지 결정합니다)
  - `l10n`: `{언어 코드: 값}` 슬롯별 병합(빈 문자열은 무시합니다)
- **이름 패치(이름 바꾸기/갱신용)** `{authoritative?, value?, l10n?}`: `l10n`은 슬롯별 upsert이며, **빈 문자열은 슬롯을 비웁니다**(기준 슬롯은 예외). `authoritative`가 나오면 반드시 비어 있지 않아야 합니다

---

## 데이터베이스 생성

### 1. 새 데이터베이스 생성

`POST /api/create`(루트 경로, 어느 데이터베이스 아래에도 없음)

**매개변수**(body, `application/json` 또는 `application/x-www-form-urlencoded`)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | string | 예 | 데이터베이스 이름, `\w-`로 제한 |

**반환**: JSON 응답 본문 없음, 일률적으로 `302` 리다이렉트:

| 상황 | Location |
|---|---|
| 성공 | `/<name>/`(새 데이터베이스 진입) |
| 이름 불법 | `/?error=illegal` |
| 이미 존재 | `/?error=exists&name=<name>` |

**설명**: 기준 언어 씨앗값 = 생성자의 `X-Lang`.

**오류**: JSON을 거치지 않으며, 302의 `error` 매개변수로 표현합니다(`illegal` / `exists`).

---

## 조직 organizations

### 2. 조직 트리

`GET /api/organizations`

**매개변수**: 없음

**반환** `200`:

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**오류**: `db_not_found`

### 3. 조직 생성

`POST /api/organizations`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `parentId` | string | 아니오 | 부모 조직 id. 생략하면 1단계 조직 |
| `index` | number | 아니오 | 동급 삽입 위치(기본값은 맨 끝) |
| `…이름 페이로드` | — | 예 | `{authoritative?, value?, l10n?}`. 공통 규약 참조 |

**반환** `201`: `{"data": {"id": "uuid"}}`

**오류**: `400 name_required`, `400 authoritative_required`, `404 parent_not_found`

### 4. 조직 이동

`POST /api/organizations/move`(부모 바꾸기 / 동급 정렬. 자기 자신이나 자기 후손으로 옮기는 것은 금지)

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 조직 id |
| `parentId` | string \| null | 예 | 새 부모 조직 id. `null` = 1단계로 끌어올리기 |
| `index` | number | 아니오 | 대상 동급 목록에서의 위치 |

**반환** `200`: `{"data": {"ok": true}}`

**오류**: `400 move_to_self`, `400 org_not_found`, `400 target_org_not_found`, `400 move_to_descendant`

### 5. 조직 삭제

`DELETE /api/organizations?id=<id>`

**매개변수**(query)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 조직 id |
| `promote` | `1` | 아니오 | 기본값: 하위 트리 전체를 재귀 삭제. `promote=1`: 하위를 남겨 삭제된 조직의 자리로 끌어올리기 |

**반환** `200`: `{"ok": true}`

**오류**: `404 org_not_found`

### 6. 조직 이름 바꾸기

`POST /api/organizations/rename`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 조직 id |
| `…이름 패치` | — | 예 | `{authoritative?, value?, l10n?}`. 공통 규약 참조 |

**반환** `200`: `{"ok": true}`

**오류**: `400 authoritative_required`, `400 name_required`, `404 org_not_found`

---

## 신분 identities

### 7. 신분 생성

`POST /api/identities`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `organizationId` | string | 예 | 소속 조직 id |
| `index` | number | 아니오 | 조직 내 삽입 위치(기본값은 맨 끝) |
| `…이름 페이로드` | — | 예 | 공통 규약 참조 |

**반환** `201`: `{"data": {"id": "uuid"}}`

**오류**: `400 name_required`, `400 authoritative_required`, `404 org_not_found`

### 8. 신분 정렬

`POST /api/identities/move`(조직 내 정렬만 하고 조직은 바꾸지 않음)

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 신분 id |
| `index` | number | 예 | 조직 내 새 위치 |

**반환** `200`: `{"data": {"ok": true}}`

**오류**: `400 identity_not_found`

### 9. 신분 조직 간 이동

`POST /api/identities/move-organization`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `identityId` | string | 예 | 신분 id |
| `organizationId` | string | 예 | 대상 조직 id |
| `index` | number | 아니오 | 대상 조직 내 위치 |

**설명**: 보유와 관계의 `identity_id` 참조는 그대로이며 자동으로 함께 이동합니다.

**반환** `200`: `{"data": {"ok": true}}`

**오류**: `400 identity_not_found`, `400 target_org_not_found`, `400 same_target_org`

### 10. 신분 삭제

`DELETE /api/identities?id=<id>`

**매개변수**(query): `id`(string, 필수) — 신분 id

**반환** `200`: `{"ok": true}`(보유와 관계 끝점을 연쇄 정리)

**오류**: `404 identity_not_found`

### 11. 신분 이름 바꾸기

`POST /api/identities/rename`

**매개변수**(body): `id`(string, 필수) + 이름 패치

**반환** `200`: `{"ok": true}`

**오류**: `400 authoritative_required`, `400 name_required`, `404 identity_not_found`

---

## 인물 persons

### 12. 인물 목록

`GET /api/persons`

**매개변수**: 없음

**반환** `200`: `{"data": [{"id": "uuid"}]}`(이름은 l10n 부속 테이블에 있으며 `GET /api/l10n`으로 가져옴)

**오류**: `db_not_found`

### 13. 인물 생성(한 번에 배정 가능)

`POST /api/persons`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `…이름 페이로드` | — | 예 | 공통 규약 참조 |
| `identityId` | string | 아니오 | 넘기면 그 신분으로 한 번에 「생성하고 배정」 |
| `index` | number | 아니오 | 그 신분 내 삽입 위치(`identityId`와 함께 사용) |

**반환** `201`: 순수 생성 `{"data": {"id": "uuid"}}`. 배정 동반 `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**오류**: `400 name_required`, `400 authoritative_required`, `404 identity_not_found`

### 14. 인물 삭제

`DELETE /api/persons?id=<id>`

**매개변수**(query): `id`(string, 필수) — 인물 id

**반환** `200`: `{"ok": true}`(보유와 관계를 연쇄 정리)

**오류**: `404 person_not_found`

### 15. 인물 이름 바꾸기

`POST /api/persons/rename`

**매개변수**(body): `id`(string, 필수) + 이름 패치

**반환** `200`: `{"ok": true}`

**오류**: `400 authoritative_required`, `400 name_required`, `404 person_not_found`

---

## 보유 assignments(신분-인물 연결)

### 16. 보유 설정

`POST /api/assignments`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `personId` | string | 예 | 인물 id |
| `identityId` | string | 예 | 신분 id |
| `index` | number | 아니오 | 신분 내 삽입 위치(기본값은 맨 끝) |

**설명**: 멱등하며, 반복해서 설정해도 부작용이 없습니다.

**반환** `200`: `{"data": {"personId": "uuid", "identityId": "uuid"}}`

**오류**: `404 person_or_identity_not_found`

### 17. 보유 해제

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**매개변수**(query): `personId`, `identityId`(둘 다 필수)

**반환** `200`: `{"ok": true}`(연결이 없어도 성공을 반환)

**오류**: 전용 오류 코드 없음

### 18. 보유 정렬

`POST /api/assignments/move`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `personId` | string | 예 | 인물 id |
| `identityId` | string | 예 | 신분 id |
| `index` | number | 예 | 신분 내 새 위치 |

**반환** `200`: `{"data": {"ok": true}}`

**오류**: `400 assignment_not_found`

### 19. 보유 옮기기(신분 간)

`POST /api/assignments/move-identity`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `personId` | string | 예 | 인물 id |
| `fromIdentityId` | string | 예 | 원래 신분 id |
| `toIdentityId` | string | 예 | 대상 신분 id(같은 인물) |
| `index` | number | 아니오 | 대상 신분 내 위치 |

**설명**: 관계 끝점이 함께 이동합니다(응답의 `data.ids`는 함께 이동해 재지정된 관계 id 목록).

**반환** `200`: `{"data": {"ok": true, "ids": ["uuid"]}}`

**오류**: `400 from_assignment_not_found`, `400 same_target_identity`, `400 target_identity_not_found`

---

## 관계 person-persons

### 20. 관계 목록

`GET /api/person-persons`

**매개변수**: 없음

**반환** `200`: `{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}`(라벨은 `GET /api/l10n`으로 가져옴)

**오류**: `db_not_found`

### 21. 관계 생성

`POST /api/person-persons`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `aPersonId` | string | 예 | A 쪽 인물 id |
| `aIdentityId` | string | 예 | A 쪽 신분 id(그 인물이 이미 맡은 신분이어야 함) |
| `bPersonId` | string | 예 | B 쪽 인물 id |
| `bIdentityId` | string | 예 | B 쪽 신분 id |
| `forward` | object | 예 | A→B 방향 이름 페이로드(기준 슬롯 필수) |
| `backward` | object | 예 | B→A 방향 이름 페이로드(기준 슬롯 필수) |

**반환** `201`: `{"data": {"id": "uuid"}}`

**오류**: `400 authoritative_required`(어느 한 방향의 기준 슬롯이 비어 있음), `400 relation_with_self`, `400 endpoint_not_assigned`

### 22. 관계 삭제

`DELETE /api/person-persons?id=<id>`

**매개변수**(query): `id`(string, 필수)

**반환** `200`: `{"ok": true}`(관계가 없어도 성공을 반환)

**오류**: 전용 오류 코드 없음

### 23. 관계 라벨 갱신

`POST /api/person-persons/update`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 관계 id |
| `forward` | object | 아니오 | 방향 이름 패치(안 보내면 그 방향은 그대로) |
| `backward` | object | 아니오 | 위와 같음 |

**반환** `200`: `{"ok": true}`

**오류**: `400 name_required`(두 방향 모두 없음), `400 authoritative_required`, `404 relation_not_found`

---

## 메타 정보 meta

### 24. 메타 정보 읽기

`GET /api/meta`

**매개변수**: 없음

**반환** `200`:

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]}}
```

**오류**: `db_not_found`

### 25. 메타 정보 설정

`PUT /api/meta`

**매개변수**(body)

| 매개변수 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `key` | string | 예 | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| 나머지 필드 | — | key에 따라 다름 | 아래 표 참조 |

| key | 페이로드 의미 |
|---|---|
| `display_name` | 이름 패치: `description→value`, `value→현재 언어 슬롯`, `l10n→슬롯별`. 전부 비어 있음 = 설정 지우기 |
| `bg_color` | `{value}` 또는 `{description}`: rgba 문자열. 비어 있음 = 행을 삭제해 기본값(전체 투명)으로 복원 |
| `authoritative_lang` | `{value}`: 언어 코드. 새 기준 언어는 사용 집합에 자동으로 포함되고, 이번 전환과 함께 meta 브로드캐스트를 연달아 두 번 보냄 |
| `enabled_langs` | `{value}`: 배열 또는 쉼표 문자열. 서버가 기준 언어를 자동으로 보충해 항상 첫 자리에 둠 |

**반환** `200`: `{"data": …}`(authoritative/enabled는 `{"id": key, "value": …}`를 반환. 나머지 두 개는 쓰기 결과를 반환)

**오류**: `400 bad_key`, `400 authoritative_lang_invalid`, `400 enabled_langs_invalid`, `400 authoritative_required`

---

## l10n 슬롯

### 26. 전체 언어 슬롯

`GET /api/l10n`

**매개변수**: 없음

**반환** `200`: `{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}` — 각각 행 배열이며, 행 = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_Hans_CN"?: "…", …}`(언어 열은 비어 있지 않은 슬롯만 나열)

**오류**: `db_not_found`

---

## 내보내기 export

### 27. JSON 내보내기

`GET /api/export/json`

**매개변수**: 없음

**반환** `200`:

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**설명**: `l10n`에는 **사용 언어**의 열만 들어 있습니다.

**오류**: `db_not_found`

### 28. DB 내보내기

`GET /api/export/db`

**매개변수**: 없음

**반환** `200`: `Content-Type: application/octet-stream` — 원본 데이터베이스 파일(VACUUM INTO 일관성 스냅숏)이며, 그대로 `.db`로 저장할 수 있음

**오류**: `db_not_found`

---

## WebSocket 협업 브로드캐스트

- 연결: `/<데이터베이스명>/ws?cid=<클라이언트id>`
- REST 쓰기 성공 후 서버가 같은 데이터베이스의 다른 클라이언트에게 텍스트 JSON 메시지를 브로드캐스트합니다. 모든 메시지에는 `clientId` 필드가 있습니다(보낸 쪽의 `X-Client-Id`). 자기 `clientId`가 붙은 메시지는 그냥 건너뜁니다(낙관적 업데이트가 이미 화면에 먼저 올라갔기 때문)
- 필드 타입 규약: `id` / `personId` / `identityId` / `organizationId`는 uuid 문자열. `index`는 number 또는 null. `l10n`은 `{언어 코드: 값}` 슬롯 테이블 또는 null. `lang`은 쓴 쪽의 `X-Lang`

### 조직

#### organization:create

**트리거**: `POST /api/organizations`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 새 조직 id |
| `parentId` | string \| null | 부모 조직 id(null = 1단계) |
| `index` | number \| null | 동급 삽입 위치 |
| `l10n` | object \| null | 초기 이름 슬롯 |

#### organization:move

**트리거**: `POST /api/organizations/move`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 조직 id |
| `parentId` | string \| null | 새 부모 조직 id(null = 1단계로 끌어올리기) |
| `index` | number \| null | 대상 동급 위치 |

#### organization:delete

**트리거**: `DELETE /api/organizations`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 삭제된 조직 id |
| `mode` | string | 하위만 남겨 끌어올릴 때만 `promote`. 필드가 없으면 = 하위 트리 전체를 재귀 삭제 |

#### organization:rename

**트리거**: `POST /api/organizations/rename`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 조직 id |
| `authoritative` | string \| undefined | 기준 슬롯 새 값(안 보내면 그대로) |
| `value` | string \| undefined | 쓴 쪽의 현재 언어 슬롯 새 값 |
| `l10n` | object \| undefined | 슬롯별 upsert(빈 문자열은 슬롯을 비움, 기준 슬롯은 예외) |
| `lang` | string | 쓴 쪽의 `X-Lang` |

### 신분

#### identity:create

**트리거**: `POST /api/identities`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 새 신분 id |
| `organizationId` | string | 소속 조직 id |
| `index` | number \| null | 조직 내 삽입 위치 |
| `l10n` | object \| null | 초기 이름 슬롯 |

#### identity:move

**트리거**: `POST /api/identities/move`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 신분 id |
| `index` | number \| null | 조직 내 새 위치 |

#### identity:move-organization

**트리거**: `POST /api/identities/move-organization`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 신분 id |
| `organizationId` | string | 대상 조직 id |
| `index` | number \| null | 대상 조직 내 위치 |

#### identity:delete

**트리거**: `DELETE /api/identities`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 삭제된 신분 id(보유와 관계 끝점을 연쇄 정리) |

#### identity:rename

**트리거**: `POST /api/identities/rename` — 필드는 `organization:rename`과 같습니다(`id`는 신분 id).

### 인물

#### person:create

**트리거**: `POST /api/persons`(순수 생성과 한 번에 생성하고 배정하는 경우 모두 이 메시지를 브로드캐스트합니다. `identityId`를 함께 보내면 **연달아 `assign`을 한 번 더** 보내며, `index`는 배정 위치입니다)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 새 인물 id |
| `l10n` | object \| null | 초기 이름 슬롯 |

#### person:delete

**트리거**: `DELETE /api/persons`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 삭제된 인물 id(보유와 관계를 연쇄 정리) |

#### person:rename

**트리거**: `POST /api/persons/rename` — 필드는 `organization:rename`과 같습니다(`id`는 인물 id).

### 보유

#### assign

**트리거**: `POST /api/assignments` 또는 `POST /api/persons`에 `identityId`를 동반한 경우의 두 번째 연속 발송

| 필드 | 타입 | 설명 |
|---|---|---|
| `personId` | string | 인물 id |
| `identityId` | string | 신분 id |
| `index` | number \| null | 신분 내 삽입 위치 |

#### unassign

**트리거**: `DELETE /api/assignments` 또는 `move-identity`의 두 번째 연속 발송

| 필드 | 타입 | 설명 |
|---|---|---|
| `personId` | string | 인물 id |
| `identityId` | string | 신분 id |

#### assign:move

**트리거**: `POST /api/assignments/move`

| 필드 | 타입 | 설명 |
|---|---|---|
| `personId` | string | 인물 id |
| `identityId` | string | 신분 id |
| `index` | number | 신분 내 새 위치 |

**`move-identity`의 연속 발송 순서**: `POST /api/assignments/move-identity`는 **세 개 이상의 메시지**를 발동합니다 — 먼저 `assign`(대상 신분, `index` 포함), 그다음 `unassign`(원래 신분), 이어서 함께 이동한 관계마다 `personPerson:retarget`를 각각 한 번씩 보냅니다.

### 관계

#### personPerson:create

**트리거**: `POST /api/person-persons`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 새 관계 id |
| `data` | object | 전량: `{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`이며, 받는 쪽은 통째로 교체합니다 |

#### personPerson:delete

**트리거**: `DELETE /api/person-persons`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 삭제된 관계 id |

#### personPerson:update

**트리거**: `POST /api/person-persons/update`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 관계 id |
| `forward` | object \| undefined | 정방향 라벨 패치(안 보내면 그대로) |
| `backward` | object \| undefined | 역방향 라벨 패치 |
| `lang` | string | 쓴 쪽의 `X-Lang` |

#### personPerson:retarget

**트리거**: `move-identity`에 따라 또는 신분/인물 삭제 후 관계 끝점의 함께 이동 재지정

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 관계 id |
| `data` | object | 끝점이 새로 가리키는 전량 관계(`personPerson:create`의 `data`와 같음). 받는 쪽은 통째로 교체 |

### 메타 정보

#### meta

**트리거**: `PUT /api/meta`(authoritative_lang 전환 시 **연달아 두 번**: 먼저 `authoritative_lang`, 그다음 `enabled_langs`)

| 필드 | 타입 | 설명 |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | 새 값. `enabled_langs`는 쉼표 문자열. `display_name`/`bg_color`는 meta.value |
| `l10n` | object \| undefined | `display_name`에만: 슬롯 테이블(빈 문자열은 슬롯을 비움) |
| `lang` | string \| undefined | `display_name`에만: 쓴 쪽의 `X-Lang` |

---

## 오류 코드 총표

| code | HTTP | 상황 |
|---|---|---|
| `db_not_found` | 404 | 데이터베이스가 없음 |
| `not_found` | 404 | 알 수 없는 API 경로 |
| `org_not_found` | 404/400 | 조직이 없음(삭제/이름 바꾸기 404. 이동 400) |
| `parent_not_found` | 404 | 새 조직의 부모 조직이 없음 |
| `target_org_not_found` | 400 | 이동 대상 조직이 없음 |
| `move_to_self` | 400 | 조직을 자기 자신으로 이동 |
| `move_to_descendant` | 400 | 조직을 자기 후손 안으로 이동 |
| `identity_not_found` | 404/400 | 신분이 없음 |
| `same_target_org` | 400 | 신분을 원래 소속 조직으로 이동 |
| `person_not_found` | 404 | 인물이 없음 |
| `person_or_identity_not_found` | 404 | 보유 끝점이 없음 |
| `assignment_not_found` | 400 | 보유가 없음(정렬) |
| `from_assignment_not_found` | 400 | 보유 옮기기의 원래 신분에 그 보유가 없음 |
| `same_target_identity` | 400 | 보유 옮기기 대상 = 원래 신분 |
| `target_identity_not_found` | 400 | 보유 옮기기의 대상 신분이 없음 |
| `relation_not_found` | 404 | 관계가 없음 |
| `relation_with_self` | 400 | 관계의 양끝이 같은 보유 |
| `endpoint_not_assigned` | 400 | 관계 끝점 인물이 해당 신분을 맡지 않음 |
| `name_required` | 400 | 이름이 비어 있음 / 패치의 세 키가 모두 없음 |
| `authoritative_required` | 400 | 기준 슬롯이 비어 있거나 비우려 함 |
| `authoritative_lang_invalid` | 400 | 불법 기준 언어 코드 |
| `enabled_langs_invalid` | 400 | 불법 사용 언어 코드 |
| `bad_key` | 400 | PUT meta의 알 수 없는 key |
| `internal_error` | 500 | 잡히지 않은 예외(세부 정보는 서버 로그에만 기록) |
