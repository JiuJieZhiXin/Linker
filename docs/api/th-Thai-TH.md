# เอกสารอ้างอิง API

URL ฐาน: `http://<host>:<port>/<database-name>/api/…` (ชื่อฐานข้อมูลจำกัดด้วย `\w-` ทุกไฟล์ `.db` ใน `data/` คือฐานข้อมูลหนึ่งฐาน) ข้อยกเว้น: เอนด์พอยนต์สร้างฐานข้อมูลอยู่ที่พาธราก `/api/create`

รหัสภาษา: `zh-Hans-CN` `zh-Hant-TW` `zh-Hant-HK` `en-Latn-GB` `en-Latn-US` `ja-Jpan-JP` `ko-Kore-KR` `th-Thai-TH` `fr-Latn-FR` `ar-Arab-SA` (ในชื่อคอลัมน์ของตารางแนบ l10n จะแทน `-` ด้วย `_` เช่น `zh_Hans_CN`)

## หัวคำขอ

| หัว | บังคับ | วัตถุประสงค์ |
|---|---|---|
| `X-Lang` | ไม่ | รหัสภาษาของหน้าจอปัจจุบัน: เป้าหมายการเขียนของช่อง `value` และเมล็ดพันธุ์ของภาษาอ้างอิงหลักตอนสร้างฐานข้อมูล หายไปหรือไม่ถูกต้องจะกลับไปใช้ภาษาเริ่มต้น |
| `X-Client-Id` | ไม่ | รหัสไคลเอนต์ความร่วมมือ: เซิร์ฟเวอร์ยกเว้นมันเมื่อบรอดแคสต์เพื่อป้องกันการวนซ้ำ ไคลเอนต์ที่ไม่ส่งจะได้รับบรอดแคสต์ของการเขียนของตนเอง |

## ข้อตกลงร่วม

- สำเร็จ: `200` (`{data: …}` หรือ `{ok: true}`) สร้างแล้ว: `201 {data: …}`
- ล้มเหลว: `{error: code}` (`4xx/5xx` + JSON) ดูบรรทัด "ข้อผิดพลาด" ของแต่ละรายการและ[ตารางรหัสข้อผิดพลาด](#ตารางรหัสข้อผิดพลาด) ท้ายเอกสาร
- **เพย์โหลดชื่อ (สำหรับการสร้าง)** `{authoritative?, value?, l10n?}`:
  - `authoritative`: ค่าของช่องอ้างอิงหลัก ต้องไม่ว่างในที่สุด (ค่าเริ่มต้นย้อนกลับไปที่ `value`)
  - `value`: ช่องภาษาของหน้าจอปัจจุบัน (เขียนภาษาใดถูกตัดสินโดย `X-Lang`)
  - `l10n`: `{language-code: value}` ผสานทีละช่อง (ไม่สนใจสตริงว่าง)
- **พัตช์ชื่อ (สำหรับการเปลี่ยนชื่อ/อัปเดต)** `{authoritative?, value?, l10n?}`: `l10n` อัปเซิร์ตทีละช่อง **สตริงว่างลบช่อง** (ยกเว้นช่องอ้างอิงหลัก) หากมี `authoritative` ต้องไม่ว่าง

---

## การสร้างฐานข้อมูล

### 1. สร้างฐานข้อมูล

`POST /api/create` (พาธราก ไม่อยู่ใต้ฐานข้อมูลใด)

**อินพุต** (บอดี้, `application/json` หรือ `application/x-www-form-urlencoded`)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `name` | string | ใช่ | ชื่อฐานข้อมูล จำกัดด้วย `\w-` |

**การตอบกลับ**: ไม่มีบอดี้คำตอบ JSON เป็น `302` redirect เสมอ:

| สถานการณ์ | Location |
|---|---|
| สำเร็จ | `/<name>/` (เข้าสู่ฐานข้อมูลใหม่) |
| ชื่อไม่ถูกต้อง | `/?error=illegal` |
| มีฐานข้อมูลอยู่แล้ว | `/?error=exists&name=<name>` |

**หมายเหตุ**: เมล็ดพันธุ์ภาษาอ้างอิงหลัก = `X-Lang` ของผู้สร้าง

**ข้อผิดพลาด**: ไม่ผ่าน JSON — แสดงผ่านพารามิเตอร์ `error` ของ 302 (`illegal` / `exists`)

---

## องค์กร (`organizations`)

### 2. ต้นไม้องค์กร

`GET /api/organizations`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`:

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**ข้อผิดพลาด**: `db_not_found`

### 3. สร้างองค์กร

`POST /api/organizations`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `parentId` | string | ไม่ | id องค์กรระดับบน ค่าเริ่มต้น = องค์กรระดับบนสุด |
| `index` | number | ไม่ | ตำแหน่งแทรกในกลุ่มพี่น้อง (ค่าเริ่มต้น: ท้ายสุด) |
| `…name payload` | — | ใช่ | `{authoritative?, value?, l10n?}` ดู ข้อตกลงร่วม |

**การตอบกลับ** `201`: `{"data": {"id": "uuid"}}`

**ข้อผิดพลาด**: `400 name_required`, `400 authoritative_required`, `404 parent_not_found`

### 4. ย้ายองค์กร

`POST /api/organizations/move` (เปลี่ยนพ่อ/เรียงลำดับในกลุ่มพี่น้อง ห้ามย้ายเข้าไปในตัวเองหรือลูกหลานของตัวเอง)

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `id` | string | ใช่ | id องค์กร |
| `parentId` | string \| null | ใช่ | id องค์กรระดับบนใหม่ `null` = เลื่อนเป็นระดับบนสุด |
| `index` | number | ไม่ | ตำแหน่งในกลุ่มพี่น้องเป้าหมาย |

**การตอบกลับ** `200`: `{"data": {"ok": true}}`

**ข้อผิดพลาด**: `400 move_to_self`, `400 org_not_found`, `400 target_org_not_found`, `400 move_to_descendant`

### 5. ลบองค์กร

`DELETE /api/organizations?id=<id>`

**อินพุต** (query)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `id` | string | ใช่ | id องค์กร |
| `promote` | `1` | ไม่ | ค่าเริ่มต้น: ลบทั้งต้นไม้ย่อยแบบเวียนใหม่ `promote=1`: เก็บองค์กรลูกไว้และเลื่อนขึ้นไปแทนที่องค์กรที่ถูกลบ |

**การตอบกลับ** `200`: `{"ok": true}`

**ข้อผิดพลาด**: `404 org_not_found`

### 6. เปลี่ยนชื่อองค์กร

`POST /api/organizations/rename`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `id` | string | ใช่ | id องค์กร |
| `…name patch` | — | ใช่ | `{authoritative?, value?, l10n?}` ดู ข้อตกลงร่วม |

**การตอบกลับ** `200`: `{"ok": true}`

**ข้อผิดพลาด**: `400 authoritative_required`, `400 name_required`, `404 org_not_found`

---

## ตัวตน (`identities`)

### 7. สร้างตัวตน

`POST /api/identities`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `organizationId` | string | ใช่ | id องค์กรเจ้าของ |
| `index` | number | ไม่ | ตำแหน่งแทรกภายในองค์กร (ค่าเริ่มต้น: ท้ายสุด) |
| `…name payload` | — | ใช่ | ดู ข้อตกลงร่วม |

**การตอบกลับ** `201`: `{"data": {"id": "uuid"}}`

**ข้อผิดพลาด**: `400 name_required`, `400 authoritative_required`, `404 org_not_found`

### 8. เรียงลำดับตัวตนใหม่

`POST /api/identities/move` (เรียงลำดับภายในองค์กรเดียวเท่านั้น ไม่เปลี่ยนองค์กร)

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `id` | string | ใช่ | id ตัวตน |
| `index` | number | ใช่ | ตำแหน่งใหม่ภายในองค์กร |

**การตอบกลับ** `200`: `{"data": {"ok": true}}`

**ข้อผิดพลาด**: `400 identity_not_found`

### 9. ย้ายตัวตนไปยังองค์กรอื่น

`POST /api/identities/move-organization`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `identityId` | string | ใช่ | id ตัวตน |
| `organizationId` | string | ใช่ | id องค์กรเป้าหมาย |
| `index` | number | ไม่ | ตำแหน่งภายในองค์กรเป้าหมาย |

**หมายเหตุ**: การดำรงตัวตนและความสัมพันธ์อ้างอิง `identity_id` ซึ่งคงเดิมและย้ายตามไปโดยอัตโนมัติ

**การตอบกลับ** `200`: `{"data": {"ok": true}}`

**ข้อผิดพลาด**: `400 identity_not_found`, `400 target_org_not_found`, `400 same_target_org`

### 10. ลบตัวตน

`DELETE /api/identities?id=<id>`

**อินพุต** (query): `id` (string, บังคับ) — id ตัวตน

**การตอบกลับ** `200`: `{"ok": true}` (ลามไปล้างการดำรงตัวตนและปลายทางความสัมพันธ์)

**ข้อผิดพลาด**: `404 identity_not_found`

### 11. เปลี่ยนชื่อตัวตน

`POST /api/identities/rename`

**อินพุต** (บอดี้): `id` (string, บังคับ) + name patch

**การตอบกลับ** `200`: `{"ok": true}`

**ข้อผิดพลาด**: `400 authoritative_required`, `400 name_required`, `404 identity_not_found`

---

## บุคคล (`persons`)

### 12. รายการบุคคล

`GET /api/persons`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`: `{"data": [{"id": "uuid"}]}` (ชื่ออยู่ในตารางแนบ l10n ดึงผ่าน `GET /api/l10n`)

**ข้อผิดพลาด**: `db_not_found`

### 13. สร้างบุคคล (พร้อมมอบหมายในขั้นตอนเดียวแบบเลือกได้)

`POST /api/persons`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `…name payload` | — | ใช่ | ดู ข้อตกลงร่วม |
| `identityId` | string | ไม่ | หากส่งมา = "สร้างและมอบหมาย" ในขั้นตอนเดียวไปยังตัวตนนั้น |
| `index` | number | ไม่ | ตำแหน่งแทรกภายในตัวตนนั้น (ใช้ร่วมกับ `identityId`) |

**การตอบกลับ** `201`: สร้างธรรมดา `{"data": {"id": "uuid"}}` พร้อมมอบหมาย `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**ข้อผิดพลาด**: `400 name_required`, `400 authoritative_required`, `404 identity_not_found`

### 14. ลบบุคคล

`DELETE /api/persons?id=<id>`

**อินพุต** (query): `id` (string, บังคับ) — id บุคคล

**การตอบกลับ** `200`: `{"ok": true}` (ลามไปล้างการดำรงตัวตนและความสัมพันธ์)

**ข้อผิดพลาด**: `404 person_not_found`

### 15. เปลี่ยนชื่อบุคคล

`POST /api/persons/rename`

**อินพุต** (บอดี้): `id` (string, บังคับ) + name patch

**การตอบกลับ** `200`: `{"ok": true}`

**ข้อผิดพลาด**: `400 authoritative_required`, `400 name_required`, `404 person_not_found`

---

## การดำรงตัวตน (`assignments`, ลิงก์ตัวตน–บุคคล)

### 16. สร้างการดำรงตัวตน

`POST /api/assignments`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `personId` | string | ใช่ | id บุคคล |
| `identityId` | string | ใช่ | id ตัวตน |
| `index` | number | ไม่ | ตำแหน่งแทรกภายในตัวตน (ค่าเริ่มต้น: ท้ายสุด) |

**หมายเหตุ**: ไอเดมโพเทนต์ — สร้างการดำรงตัวตนเดิมซ้ำไม่มีผลข้างเคียง

**การตอบกลับ** `200`: `{"data": {"personId": "uuid", "identityId": "uuid"}}`

**ข้อผิดพลาด**: `404 person_or_identity_not_found`

### 17. นำการดำรงตัวตนออก

`DELETE /api/assignments?personId=<id>&identityId=<id>`

**อินพุต** (query): `personId`, `identityId` (บังคับทั้งคู่)

**การตอบกลับ** `200`: `{"ok": true}` (ส่งกลับสำเร็จแม้ลิงก์ไม่มีอยู่)

**ข้อผิดพลาด**: ไม่มีรหัสข้อผิดพลาดเฉพาะ

### 18. เรียงลำดับการดำรงตัวตนใหม่

`POST /api/assignments/move`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `personId` | string | ใช่ | id บุคคล |
| `identityId` | string | ใช่ | id ตัวตน |
| `index` | number | ใช่ | ตำแหน่งใหม่ภายในตัวตน |

**การตอบกลับ** `200`: `{"data": {"ok": true}}`

**ข้อผิดพลาด**: `400 assignment_not_found`

### 19. เลื่อนการดำรงตัวตน (ข้ามตัวตน)

`POST /api/assignments/move-identity`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `personId` | string | ใช่ | id บุคคล |
| `fromIdentityId` | string | ใช่ | id ตัวตนต้นทาง |
| `toIdentityId` | string | ใช่ | id ตัวตนเป้าหมาย (บุคคลเดียวกัน) |
| `index` | number | ไม่ | ตำแหน่งภายในตัวตนเป้าหมาย |

**หมายเหตุ**: ปลายทางความสัมพันธ์ย้ายตามไป (`data.ids` ในการตอบกลับคือรายการ id ความสัมพันธ์ที่ถูกชี้เป้าใหม่จากการย้าย)

**การตอบกลับ** `200`: `{"data": {"ok": true, "ids": ["uuid"]}}`

**ข้อผิดพลาด**: `400 from_assignment_not_found`, `400 same_target_identity`, `400 target_identity_not_found`

---

## ความสัมพันธ์ (`person-persons`)

### 20. รายการความสัมพันธ์

`GET /api/person-persons`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`: `{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}` (ดึงป้ายผ่าน `GET /api/l10n`)

**ข้อผิดพลาด**: `db_not_found`

### 21. สร้างความสัมพันธ์

`POST /api/person-persons`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `aPersonId` | string | ใช่ | id บุคคลของปลาย A |
| `aIdentityId` | string | ใช่ | id ตัวตนของปลาย A (บุคคลนั้นต้องดำรงตัวตนนั้นอยู่แล้ว) |
| `bPersonId` | string | ใช่ | id บุคคลของปลาย B |
| `bIdentityId` | string | ใช่ | id ตัวตนของปลาย B |
| `forward` | object | ใช่ | เพย์โหลดชื่อสำหรับทิศ A→B (ช่องอ้างอิงหลักบังคับ) |
| `backward` | object | ใช่ | เพย์โหลดชื่อสำหรับทิศ B→A (ช่องอ้างอิงหลักบังคับ) |

**การตอบกลับ** `201`: `{"data": {"id": "uuid"}}`

**ข้อผิดพลาด**: `400 authoritative_required` (ช่องอ้างอิงหลักของทิศใดทิศหนึ่งว่าง), `400 relation_with_self`, `400 endpoint_not_assigned`

### 22. ลบความสัมพันธ์

`DELETE /api/person-persons?id=<id>`

**อินพุต** (query): `id` (string, บังคับ)

**การตอบกลับ** `200`: `{"ok": true}` (ส่งกลับสำเร็จแม้ความสัมพันธ์ไม่มีอยู่)

**ข้อผิดพลาด**: ไม่มีรหัสข้อผิดพลาดเฉพาะ

### 23. อัปเดตป้ายความสัมพันธ์

`POST /api/person-persons/update`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `id` | string | ใช่ | id ความสัมพันธ์ |
| `forward` | object | ไม่ | พัตช์ป้ายทิศ forward (หากไม่มี ทิศนั้นคงเดิม) |
| `backward` | object | ไม่ | เหมือนข้างบน |

**การตอบกลับ** `200`: `{"ok": true}`

**ข้อผิดพลาด**: `400 name_required` (ไม่มีทั้งสองทิศ), `400 authoritative_required`, `404 relation_not_found`

---

## เมทาดาทา (`meta`)

### 24. อ่านเมทาดาทา

`GET /api/meta`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`:

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]}}
```

**ข้อผิดพลาด**: `db_not_found`

### 25. ตั้งเมทาดาทา

`PUT /api/meta`

**อินพุต** (บอดี้)

| พารามิเตอร์ | ชนิด | บังคับ | คำอธิบาย |
|---|---|---|---|
| `key` | string | ใช่ | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| ฟิลด์อื่น | — | ขึ้นกับ `key` | ดูตารางด้านล่าง |

| key | สัญญาเพย์โหลด |
|---|---|
| `display_name` | name patch: `description→value`, `value→ช่องภาษาปัจจุบัน`, `l10n→ทีละช่อง` เว้นว่างทั้งหมด = ล้างการตั้งค่า |
| `bg_color` | `{value}` หรือ `{description}`: สตริง rgba ว่าง = ลบแถวและคืนค่าเริ่มต้นเป็นความโปร่งใสเต็ม |
| `authoritative_lang` | `{value}`: รหัสภาษา ภาษาอ้างอิงหลักใหม่ถูกเพิ่มเข้าชุดภาษาที่เปิดใช้โดยอัตโนมัติ และการสลับส่งบรอดแคสต์เมทาดาทาสองข้อความติดกัน |
| `enabled_langs` | `{value}`: อาร์เรย์หรือสตริงคั่นด้วยจุลภาค เซิร์ฟเวอร์เพิ่มภาษาอ้างอิงหลักโดยอัตโนมัติ ซึ่งอยู่ลำดับแรกเสมอ |

**การตอบกลับ** `200`: `{"data": …}` (สำหรับ authoritative/enabled ส่งกลับ `{"id": key, "value": …}` สองตัวที่เหลือส่งกลับผลการเขียน)

**ข้อผิดพลาด**: `400 bad_key`, `400 authoritative_lang_invalid`, `400 enabled_langs_invalid`, `400 authoritative_required`

---

## ช่อง l10n

### 26. ช่องภาษาทั้งหมด

`GET /api/l10n`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`: `{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}` — แต่ละค่าเป็นอาร์เรย์ของแถว โดยแถว = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_Hans_CN"?: "…", …}` (คอลัมน์ภาษาแสดงเฉพาะช่องที่ไม่ว่าง)

**ข้อผิดพลาด**: `db_not_found`

---

## การส่งออก (`export`)

### 27. ส่งออก JSON

`GET /api/export/json`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`:

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**หมายเหตุ**: `l10n` มีเฉพาะคอลัมน์ของ**ภาษาที่เปิดใช้**

**ข้อผิดพลาด**: `db_not_found`

### 28. ส่งออก DB

`GET /api/export/db`

**อินพุต**: ไม่มี

**การตอบกลับ** `200`: `Content-Type: application/octet-stream` — ไฟล์ฐานข้อมูลดิบ (สแน็ปช็อตที่สอดคล้องผ่าน VACUUM INTO) พร้อมบันทึกเป็น `.db` ได้ทันที

**ข้อผิดพลาด**: `db_not_found`

---

## บรอดแคสต์ความร่วมมือผ่าน WebSocket

- การเชื่อมต่อ: `/<database-name>/ws?cid=<client-id>`
- หลังเขียน REST สำเร็จ เซิร์ฟเวอร์บรอดแคสต์ข้อความ JSON ข้อความหนึ่งไปยังไคลเอนต์อื่นของฐานข้อมูลเดียวกัน ทุกข้อความมีฟิลด์ `clientId` (`X-Client-Id` ของผู้ส่ง) และข้อความที่ `clientId` เป็นของตนเองจะถูกข้ามทันที (การอัปเดตแบบออปติมิสติกถูกเรนเดอร์ไปแล้ว)
- ข้อตกลงชนิดฟิลด์: `id` / `personId` / `identityId` / `organizationId` เป็นสตริง uuid `index` เป็นตัวเลขหรือ null `l10n` เป็นตารางช่อง `{language-code: value}` หรือ null `lang` คือ `X-Lang` ของผู้เขียน

### องค์กร

#### organization:create

**กระตุ้นโดย**: `POST /api/organizations`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id องค์กรใหม่ |
| `parentId` | string \| null | id องค์กรระดับบน (null = ระดับบนสุด) |
| `index` | number \| null | ตำแหน่งแทรกในกลุ่มพี่น้อง |
| `l10n` | object \| null | ช่องชื่อเริ่มต้น |

#### organization:move

**กระตุ้นโดย**: `POST /api/organizations/move`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id องค์กร |
| `parentId` | string \| null | id องค์กรระดับบนใหม่ (null = เลื่อนเป็นระดับบนสุด) |
| `index` | number \| null | ตำแหน่งในกลุ่มพี่น้องเป้าหมาย |

#### organization:delete

**กระตุ้นโดย**: `DELETE /api/organizations`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id องค์กรที่ถูกลบ |
| `mode` | string | `promote` เฉพาะเมื่อเก็บองค์กรลูกและเลื่อนขึ้น ไม่มีฟิลด์ = ลบทั้งต้นไม้ย่อยแบบเวียนใหม่ |

#### organization:rename

**กระตุ้นโดย**: `POST /api/organizations/rename`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id องค์กร |
| `authoritative` | string \| undefined | ค่าช่องอ้างอิงหลักใหม่ (ไม่มี = คงเดิม) |
| `value` | string \| undefined | ค่าใหม่ของช่องภาษาปัจจุบันของผู้เขียน |
| `l10n` | object \| undefined | อัปเซิร์ตทีละช่อง (สตริงว่างลบช่อง ยกเว้นช่องอ้างอิงหลัก) |
| `lang` | string | `X-Lang` ของผู้เขียน |

### ตัวตน

#### identity:create

**กระตุ้นโดย**: `POST /api/identities`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ตัวตนใหม่ |
| `organizationId` | string | id องค์กรเจ้าของ |
| `index` | number \| null | ตำแหน่งแทรกภายในองค์กร |
| `l10n` | object \| null | ช่องชื่อเริ่มต้น |

#### identity:move

**กระตุ้นโดย**: `POST /api/identities/move`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ตัวตน |
| `index` | number \| null | ตำแหน่งใหม่ภายในองค์กร |

#### identity:move-organization

**กระตุ้นโดย**: `POST /api/identities/move-organization`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ตัวตน |
| `organizationId` | string | id องค์กรเป้าหมาย |
| `index` | number \| null | ตำแหน่งภายในองค์กรเป้าหมาย |

#### identity:delete

**กระตุ้นโดย**: `DELETE /api/identities`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ตัวตนที่ถูกลบ (ลามไปล้างการดำรงตัวตนและปลายทางความสัมพันธ์) |

#### identity:rename

**กระตุ้นโดย**: `POST /api/identities/rename` — ฟิลด์เหมือน `organization:rename` (`id` คือ id ตัวตน)

### บุคคล

#### person:create

**กระตุ้นโดย**: `POST /api/persons` (บรอดแคสต์ทั้งการสร้างธรรมดาและการสร้างพร้อมมอบหมายในขั้นตอนเดียว หากมี `identityId` จะส่ง **`assign`** เพิ่มหนึ่งข้อความตามหลังทันที ซึ่ง `index` คือตำแหน่งของการดำรงตัวตน)

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id บุคคลใหม่ |
| `l10n` | object \| null | ช่องชื่อเริ่มต้น |

#### person:delete

**กระตุ้นโดย**: `DELETE /api/persons`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id บุคคลที่ถูกลบ (ลามไปล้างการดำรงตัวตนและความสัมพันธ์) |

#### person:rename

**กระตุ้นโดย**: `POST /api/persons/rename` — ฟิลด์เหมือน `organization:rename` (`id` คือ id บุคคล)

### การดำรงตัวตน

#### assign

**กระตุ้นโดย**: `POST /api/assignments` หรือข้อความที่สองของลำดับเมื่อ `POST /api/persons` มี `identityId`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `personId` | string | id บุคคล |
| `identityId` | string | id ตัวตน |
| `index` | number \| null | ตำแหน่งแทรกภายในตัวตน |

#### unassign

**กระตุ้นโดย**: `DELETE /api/assignments` หรือข้อความที่สองของลำดับ `move-identity`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `personId` | string | id บุคคล |
| `identityId` | string | id ตัวตน |

#### assign:move

**กระตุ้นโดย**: `POST /api/assignments/move`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `personId` | string | id บุคคล |
| `identityId` | string | id ตัวตน |
| `index` | number | ตำแหน่งใหม่ภายในตัวตน |

**ลำดับข้อความของ move-identity**: `POST /api/assignments/move-identity` กระตุ้น**สามข้อความขึ้นไป** — ข้อแรก `assign` (ตัวตนเป้าหมาย รวม `index`) แล้ว `unassign` (ตัวตนต้นทาง) แล้ว `personPerson:retarget` หนึ่งข้อความต่อหนึ่งความสัมพันธ์ที่ย้าย

### ความสัมพันธ์

#### personPerson:create

**กระตุ้นโดย**: `POST /api/person-persons`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ความสัมพันธ์ใหม่ |
| `data` | object | ข้อมูลเต็ม: `{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}` ผู้รับแทนที่ทั้งก้อน |

#### personPerson:delete

**กระตุ้นโดย**: `DELETE /api/person-persons`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ความสัมพันธ์ที่ถูกลบ |

#### personPerson:update

**กระตุ้นโดย**: `POST /api/person-persons/update`

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ความสัมพันธ์ |
| `forward` | object \| undefined | พัตช์ป้ายทิศ forward (ไม่มี = คงเดิม) |
| `backward` | object \| undefined | พัตช์ป้ายทิศ backward |
| `lang` | string | `X-Lang` ของผู้เขียน |

#### personPerson:retarget

**กระตุ้นโดย**: การชี้เป้าปลายทางความสัมพันธ์ใหม่หลัง `move-identity` / การลบตัวตนหรือบุคคล

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | string | id ความสัมพันธ์ |
| `data` | object | ความสัมพันธ์ฉบับเต็มหลังปลายทางถูกชี้เป้าใหม่ (เหมือน `data` ของ `personPerson:create`) ผู้รับแทนที่ทั้งก้อน |

### เมทาดาทา

#### meta

**กระตุ้นโดย**: `PUT /api/meta` (เมื่อสลับ authoritative_lang จะ**ส่งสองข้อความติดกัน**: ข้อแรก `authoritative_lang` แล้ว `enabled_langs`)

| ฟิลด์ | ชนิด | คำอธิบาย |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | ค่าใหม่ `enabled_langs` เป็นสตริงคั่นด้วยจุลภาค `display_name`/`bg_color` คือ meta.value |
| `l10n` | object \| undefined | เฉพาะ `display_name`: ตารางช่อง (สตริงว่างลบช่อง) |
| `lang` | string \| undefined | เฉพาะ `display_name`: `X-Lang` ของผู้เขียน |

---

## ตารางรหัสข้อผิดพลาด

| รหัส | HTTP | สถานการณ์ |
|---|---|---|
| `db_not_found` | 404 | ไม่มีฐานข้อมูล |
| `not_found` | 404 | พาธ API ที่ไม่รู้จัก |
| `org_not_found` | 404/400 | ไม่มีองค์กร (404 สำหรับลบ/เปลี่ยนชื่อ 400 สำหรับย้าย) |
| `parent_not_found` | 404 | ไม่มีองค์กรระดับบนเมื่อสร้างองค์กร |
| `target_org_not_found` | 400 | ไม่มีองค์กรเป้าหมายของการย้าย |
| `move_to_self` | 400 | ย้ายองค์กรเข้าไปในตัวเอง |
| `move_to_descendant` | 400 | ย้ายองค์กรเข้าไปในองค์กรลูกของตัวเอง |
| `identity_not_found` | 404/400 | ไม่มีตัวตน |
| `same_target_org` | 400 | ย้ายตัวตนไปยังองค์กรปัจจุบันของมัน |
| `person_not_found` | 404 | ไม่มีบุคคล |
| `person_or_identity_not_found` | 404 | ปลายทางการดำรงตัวตนไม่มี |
| `assignment_not_found` | 400 | ไม่มีการดำรงตัวตน (การเรียงใหม่) |
| `from_assignment_not_found` | 400 | ตัวตนต้นทางของการเลื่อนไม่มีการดำรงตัวตนนั้น |
| `same_target_identity` | 400 | เป้าหมายการเลื่อนเหมือนกับตัวตนต้นทาง |
| `target_identity_not_found` | 400 | ไม่มีตัวตนเป้าหมายของการเลื่อน |
| `relation_not_found` | 404 | ไม่มีความสัมพันธ์ |
| `relation_with_self` | 400 | ทั้งสองปลายของความสัมพันธ์เป็นการดำรงตัวตนเดียวกัน |
| `endpoint_not_assigned` | 400 | บุคคลที่เป็นปลายทางความสัมพันธ์ไม่ได้ดำรงตัวตนที่เกี่ยวข้อง |
| `name_required` | 400 | ชื่อว่าง / ไม่มีพัตช์คีย์ทั้งสามตัว |
| `authoritative_required` | 400 | ช่องอ้างอิงหลักว่าง หรือพยายามลบมัน |
| `authoritative_lang_invalid` | 400 | รหัสภาษาอ้างอิงหลักไม่ถูกต้อง |
| `enabled_langs_invalid` | 400 | รหัสภาษาที่เปิดใช้ไม่ถูกต้อง |
| `bad_key` | 400 | คีย์ที่ไม่รู้จักสำหรับ PUT meta |
| `internal_error` | 500 | ข้อยกเว้นที่ไม่ถูกจับ (รายละเอียดเข้าล็อกเซิร์ฟเวอร์เท่านั้น) |
