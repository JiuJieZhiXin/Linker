<div dir="rtl">

# وثائق واجهات API

&#x200F;Base URL: `http://<host>:<port>/<database-name>/api/…` (اسم القاعدة مقيّد بـ `\w-`؛ وكل ملف `.db` في `data/` قاعدة واحدة). الاستثناء: واجهة إنشاء القاعدة على المسار الجذر `/api/create`.

رموز اللغات: `zh-Hans-CN` `zh-Hant-TW` `zh-Hant-HK` `en-Latn-GB` `en-Latn-US` `ja-Jpan-JP` `ko-Kore-KR` `th-Thai-TH` `fr-Latn-FR` `ar-Arab-SA` (أسماء أعمدة الجدول الملحق l10n تستبدل `-` بـ `_`، مثل `zh_Hans_CN`).

## الترويسات

| الترويسة | إلزامية | الوظيفة |
|---|---|---|
| `X-Lang` | لا | رمز لغة الواجهة الحالية: هدف كتابة خانة `value`، وبذرة اللغة المرجعية عند إنشاء القاعدة؛ والغياب أو القيمة غير الصالحة يعيدان إلى اللغة الافتراضية |
| `X-Client-Id` | لا | معرّف عميل التعاون: يستبعده الخادم من البثّ الراجعة؛ والعملاء الذين لا يرسلونه يستلمون بثّ كتاباتهم الذاتية |

## اصطلاحات عامة

- النجاح: `200` (`{data: …}` أو `{ok: true}`)؛ والإنشاء: `201 {data: …}`
- الفشل: `{error: code}` (`4xx/5xx` + JSON)، وcode مذكور في خانة «الأخطاء» لكل بند وفي [جدول رموز الأخطاء الكامل](#جدول-رموز-الأخطاء-الكامل) في نهاية الوثيقة
- **حمولة الاسم (للإنشاء)** `{authoritative?, value?, l10n?}`:
  - &#x200F;`authoritative`: قيمة خانة اللغة المرجعية، يجب ألا تكون فارغة في النهاية (عند الغياب يعود إلى `value`)
  - &#x200F;`value`: خانة لغة الواجهة الحالية (ترويسة `X-Lang` هي التي تحدد اللغة المكتوبة)
  - &#x200F;`l10n`: `{language-code: value}` تُدمج خانةً خانة (upsert) (السلاسل الفارغة تُتجاهل)
- **رقعة الاسم (لإعادة التسمية/التحديث)** `{authoritative?, value?, l10n?}`: يدمج `l10n` خانةً خانة (upsert)، **والسلسلة الفارغة تُفرّغ الخانة** (عدا الخانة المرجعية)؛ و`authoritative` إن وردت يجب ألا تكون فارغة

---

## إنشاء قاعدة البيانات

### 1. إنشاء قاعدة بيانات جديدة

&#x200F;`POST /api/create` (على المسار الجذر، خارج أي قاعدة)

**المدخلات** (body، `application/json` أو `application/x-www-form-urlencoded`)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `name` | string | نعم | اسم القاعدة، مقيّد بـ `\w-` |

**الإرجاع**: لا جسم استجابة JSON قطعًا، وإعادة توجيه `302` في كل الأحوال:

| الحالة | Location |
|---|---|
| النجاح | `/<name>/` (الدخول إلى القاعدة الجديدة) |
| اسم القاعدة غير صالح | `/?error=illegal` |
| القاعدة موجودة مسبقًا | `/?error=exists&name=<name>` |

**الشرح**: بذرة اللغة المرجعية = `X-Lang` للمنشئ.

**الأخطاء**: لا تمر عبر JSON بل تُعبَّر بمعامل `error` في 302 (`illegal` / `exists`).

---

## المنظمات organizations

### 2. شجرة المنظمات

&#x200F;`GET /api/organizations`

**المدخلات**: لا شيء

**الإرجاع** `200`:

```json
{"data": [{"id": "uuid", "parent_id": "uuid|null", "identities": [{"id": "uuid", "persons": [{"id": "uuid"}]}], "children": []}]}
```

**الأخطاء**: `db_not_found`

### 3. إنشاء منظمة

&#x200F;`POST /api/organizations`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `parentId` | string | لا | معرّف المنظمة الأم؛ عند الغياب = منظمة من المستوى الأول |
| `index` | number | لا | موضع الإدراج بين الإخوة (عند الغياب آخر القائمة) |
| `…حمولة الاسم` | — | نعم | `{authoritative?, value?, l10n?}`، انظر الاصطلاحات العامة |

**الإرجاع** `201`: `{"data": {"id": "uuid"}}`

**الأخطاء**: `400 name_required`، `400 authoritative_required`، `404 parent_not_found`

### 4. نقل منظمة

&#x200F;`POST /api/organizations/move` (تغيير الأصل / فرز الإخوة؛ يُمنع النقل إلى الذات أو إلى أحد الأحفاد)

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `id` | string | نعم | معرّف المنظمة |
| `parentId` | string \| null | نعم | معرّف المنظمة الأم الجديدة؛ `null` = الترقية إلى المستوى الأول |
| `index` | number | لا | الموضع في قائمة الإخوة الهدف |

**الإرجاع** `200`: `{"data": {"ok": true}}`

**الأخطاء**: `400 move_to_self`، `400 org_not_found`، `400 target_org_not_found`، `400 move_to_descendant`

### 5. حذف منظمة

&#x200F;`DELETE /api/organizations?id=<id>`

**المدخلات** (query)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `id` | string | نعم | معرّف المنظمة |
| `promote` | `1` | لا | عند الغياب: يُحذف الشجرة الفرعية بأكملها حتى الأحفاد؛ `promote=1`: تُحفَظ الأفرع وتُرفَع إلى موضع المنظمة المحذوفة |

**الإرجاع** `200`: `{"ok": true}`

**الأخطاء**: `404 org_not_found`

### 6. إعادة تسمية منظمة

&#x200F;`POST /api/organizations/rename`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `id` | string | نعم | معرّف المنظمة |
| `…رقعة الاسم` | — | نعم | `{authoritative?, value?, l10n?}`، انظر الاصطلاحات العامة |

**الإرجاع** `200`: `{"ok": true}`

**الأخطاء**: `400 authoritative_required`، `400 name_required`، `404 org_not_found`

---

## الصفات identities

### 7. إنشاء صفة

&#x200F;`POST /api/identities`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `organizationId` | string | نعم | معرّف المنظمة التابعة لها |
| `index` | number | لا | موضع الإدراج داخل المنظمة (عند الغياب آخر القائمة) |
| `…حمولة الاسم` | — | نعم | انظر الاصطلاحات العامة |

**الإرجاع** `201`: `{"data": {"id": "uuid"}}`

**الأخطاء**: `400 name_required`، `400 authoritative_required`، `404 org_not_found`

### 8. فرز الصفات

&#x200F;`POST /api/identities/move` (فرز داخل المنظمة فقط دون تغييرها)

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `id` | string | نعم | معرّف الصفة |
| `index` | number | نعم | الموضع الجديد داخل المنظمة |

**الإرجاع** `200`: `{"data": {"ok": true}}`

**الأخطاء**: `400 identity_not_found`

### 9. نقل الصفة عبر المنظمات

&#x200F;`POST /api/identities/move-organization`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `identityId` | string | نعم | معرّف الصفة |
| `organizationId` | string | نعم | معرّف المنظمة الهدف |
| `index` | number | لا | الموضع داخل المنظمة الهدف |

**الشرح**: مراجع الارتباطات والعلاقات إلى `identity_id` لا تتغير، وتنتقل تلقائيًا مع الصفة.

**الإرجاع** `200`: `{"data": {"ok": true}}`

**الأخطاء**: `400 identity_not_found`، `400 target_org_not_found`، `400 same_target_org`

### 10. حذف صفة

&#x200F;`DELETE /api/identities?id=<id>`

**المدخلات** (query): `id` (string، إلزامي) — معرّف الصفة

**الإرجاع** `200`: `{"ok": true}` (يمسح الارتباط وطرفي العلاقة حذفًا متسلسلًا)

**الأخطاء**: `404 identity_not_found`

### 11. إعادة تسمية صفة

&#x200F;`POST /api/identities/rename`

**المدخلات** (body): `id` (string، إلزامي) + رقعة الاسم

**الإرجاع** `200`: `{"ok": true}`

**الأخطاء**: `400 authoritative_required`، `400 name_required`، `404 identity_not_found`

---

## الأشخاص persons

### 12. قائمة الأشخاص

&#x200F;`GET /api/persons`

**المدخلات**: لا شيء

**الإرجاع** `200`: `{"data": [{"id": "uuid"}]}` (الأسماء في الجدول الملحق l10n، وتُجلب عبر `GET /api/l10n`)

**الأخطاء**: `db_not_found`

### 13. إنشاء شخص (مع إسناد بخطوة واحدة ممكن)

&#x200F;`POST /api/persons`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `…حمولة الاسم` | — | نعم | انظر الاصطلاحات العامة |
| `identityId` | string | لا | إن مُرِّر = «إنشاء وإسناد» بخطوة واحدة إلى تلك الصفة |
| `index` | number | لا | موضع الإدراج داخل تلك الصفة (يُستعمل مع `identityId`) |

**الإرجاع** `201`: الإنشاء المحض `{"data": {"id": "uuid"}}`؛ ومع الإسناد `{"data": {"id": "uuid", "personId": "uuid", "identityId": "uuid"}}`

**الأخطاء**: `400 name_required`، `400 authoritative_required`، `404 identity_not_found`

### 14. حذف شخص

&#x200F;`DELETE /api/persons?id=<id>`

**المدخلات** (query): `id` (string، إلزامي) — معرّف الشخص

**الإرجاع** `200`: `{"ok": true}` (يمسح الارتباطات والعلاقات حذفًا متسلسلًا)

**الأخطاء**: `404 person_not_found`

### 15. إعادة تسمية شخص

&#x200F;`POST /api/persons/rename`

**المدخلات** (body): `id` (string، إلزامي) + رقعة الاسم

**الإرجاع** `200`: `{"ok": true}`

**الأخطاء**: `400 authoritative_required`، `400 name_required`، `404 person_not_found`

---

## الارتباطات assignments (ربط الصفات بالأشخاص)

### 16. إنشاء ارتباط

&#x200F;`POST /api/assignments`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `personId` | string | نعم | معرّف الشخص |
| `identityId` | string | نعم | معرّف الصفة |
| `index` | number | لا | موضع الإدراج داخل الصفة (عند الغياب آخر القائمة) |

**الشرح**: آمن التكرار، فإعادة إنشائه لا تُحدث أي أثر جانبي.

**الإرجاع** `200`: `{"data": {"personId": "uuid", "identityId": "uuid"}}`

**الأخطاء**: `404 person_or_identity_not_found`

### 17. إلغاء ارتباط

&#x200F;`DELETE /api/assignments?personId=<id>&identityId=<id>`

**المدخلات** (query): `personId` و`identityId` (كلاهما إلزامي)

**الإرجاع** `200`: `{"ok": true}` (يُرجَع النجاح حتى إن لم يوجد الارتباط)

**الأخطاء**: لا رمز خطأ مخصّص

### 18. فرز ارتباط

&#x200F;`POST /api/assignments/move`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `personId` | string | نعم | معرّف الشخص |
| `identityId` | string | نعم | معرّف الصفة |
| `index` | number | نعم | الموضع الجديد داخل الصفة |

**الإرجاع** `200`: `{"data": {"ok": true}}`

**الأخطاء**: `400 assignment_not_found`

### 19. نقل الارتباط (عبر الصفات)

&#x200F;`POST /api/assignments/move-identity`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `personId` | string | نعم | معرّف الشخص |
| `fromIdentityId` | string | نعم | معرّف الصفة الأصلية |
| `toIdentityId` | string | نعم | معرّف الصفة الهدف (للشخص نفسه) |
| `index` | number | لا | الموضع داخل الصفة الهدف |

**الشرح**: تنتقل أطراف العلاقات تلقائيًا مع الارتباط (و`data.ids` في الاستجابة قائمة معرّفات العلاقات الموجَّهة من جديد مع النقل).

**الإرجاع** `200`: `{"data": {"ok": true, "ids": ["uuid"]}}`

**الأخطاء**: `400 from_assignment_not_found`، `400 same_target_identity`، `400 target_identity_not_found`

---

## العلاقات person-persons

### 20. قائمة العلاقات

&#x200F;`GET /api/person-persons`

**المدخلات**: لا شيء

**الإرجاع** `200`: `{"data": [{"id": "uuid", "a": {"personId": "uuid", "identityId": "uuid"}, "b": {"personId": "uuid", "identityId": "uuid"}}]}` (تُجلب الوسوم عبر `GET /api/l10n`)

**الأخطاء**: `db_not_found`

### 21. إنشاء علاقة

&#x200F;`POST /api/person-persons`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `aPersonId` | string | نعم | معرّف شخص الطرف A |
| `aIdentityId` | string | نعم | معرّف صفة الطرف A (يجب أن يكون الشخص مرتبطًا بها مسبقًا) |
| `bPersonId` | string | نعم | معرّف شخص الطرف B |
| `bIdentityId` | string | نعم | معرّف صفة الطرف B |
| `forward` | object | نعم | حمولة اسم اتجاه A→B (الخانة المرجعية إلزامية) |
| `backward` | object | نعم | حمولة اسم اتجاه B→A (الخانة المرجعية إلزامية) |

**الإرجاع** `201`: `{"data": {"id": "uuid"}}`

**الأخطاء**: `400 authoritative_required` (فراغ الخانة المرجعية في أحد الاتجاهين)، و`400 relation_with_self`، و`400 endpoint_not_assigned`

### 22. حذف علاقة

&#x200F;`DELETE /api/person-persons?id=<id>`

**المدخلات** (query): `id` (string، إلزامي)

**الإرجاع** `200`: `{"ok": true}` (يُرجَع النجاح حتى إن لم توجد العلاقة)

**الأخطاء**: لا رمز خطأ مخصّص

### 23. تحديث وسوم العلاقة

&#x200F;`POST /api/person-persons/update`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `id` | string | نعم | معرّف العلاقة |
| `forward` | object | لا | رقعة اسم الاتجاه (إن لم تُمرَّر بقيت خانته على حالها) |
| `backward` | object | لا | كذلك |

**الإرجاع** `200`: `{"ok": true}`

**الأخطاء**: `400 name_required` (غياب الاتجاهين معًا)، و`400 authoritative_required`، و`404 relation_not_found`

---

## البيانات الوصفية meta

### 24. قراءة البيانات الوصفية

&#x200F;`GET /api/meta`

**المدخلات**: لا شيء

**الإرجاع** `200`:

```json
{"data": {"displayName": "string|null", "bgColor": "string|null", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]}}
```

**الأخطاء**: `db_not_found`

### 25. ضبط البيانات الوصفية

&#x200F;`PUT /api/meta`

**المدخلات** (body)

| المعامل | النوع | إلزامي | الشرح |
|---|---|---|---|
| `key` | string | نعم | `display_name` / `bg_color` / `authoritative_lang` / `enabled_langs` |
| الحقول الأخرى | — | بحسب key | انظر الجدول أدناه |

| key | دلالة الحمولة |
|---|---|
| `display_name` | رقعة اسم: `description→value` و`value→خانة اللغة الحالية` و`l10n→خانةً خانة`؛ والفراغ التام = مسح الإعداد |
| `bg_color` | `{value}` أو `{description}`: سلسلة rgba؛ والفراغ = حذف السطر واستعادة شفافية افتراضية كاملة |
| `authoritative_lang` | `{value}`: رمز اللغة؛ والمرجعية الجديدة تُضمَّن تلقائيًا في مجموعة اللغات المفعّلة، ومع هذا التبديل تُرسَل بثتان من meta متتاليتان |
| `enabled_langs` | `{value}`: مصفوفة أو سلسلة مفصولة بفواصل؛ والخادم يُكمل اللغة المرجعية تلقائيًا ويثبّتها دائمًا في المقدمة |

**الإرجاع** `200`: `{"data": …}` (يرجع authoritative/enabled الشكل `{"id": key, "value": …}`؛ ويرجع الحقلان الآخران نتيجة الكتابة)

**الأخطاء**: `400 bad_key`، `400 authoritative_lang_invalid`، `400 enabled_langs_invalid`، `400 authoritative_required`

---

## خانات l10n

### 26. خانات اللغات الكاملة

&#x200F;`GET /api/l10n`

**المدخلات**: لا شيء

**الإرجاع** `200`: `{"organization": [], "identity": [], "person": [], "personPerson": [], "meta": []}` — كل عنصر مصفوفة صفوف، والصف = `{"id": "uuid", "type"?: "forward|backward|display_name", "zh_Hans_CN"?: "…", …}` (تُذكر أعمدة اللغات للخانات غير الفارغة فقط)

**الأخطاء**: `db_not_found`

---

## التصدير export

### 27. تصدير JSON

&#x200F;`GET /api/export/json`

**المدخلات**: لا شيء

**الإرجاع** `200`:

```json
{"app": "Linker 连客", "version": 2, "exportedAt": "ISO8601",
 "meta": {"displayName": "…", "bgColor": "…", "authoritativeLang": "zh-Hans-CN", "enabledLangs": ["zh-Hans-CN"]},
 "organizations": [], "persons": [], "personPersons": [], "l10n": {}}
```

**الشرح**: `l10n` يقتصر على أعمدة **اللغات المفعّلة**.

**الأخطاء**: `db_not_found`

### 28. تصدير DB

&#x200F;`GET /api/export/db`

**المدخلات**: لا شيء

**الإرجاع** `200`: `Content-Type: application/octet-stream` — ملف القاعدة الأصلي (لقطة اتساق VACUUM INTO)، ويمكن حفظه مباشرة بامتداد `.db`

**الأخطاء**: `db_not_found`

---

## بث التعاون عبر WebSocket

- الاتصال: `/<database-name>/ws?cid=<client-id>`
- بعد نجاح الكتابة عبر REST يبثّ الخادم رسائل JSON نصية إلى عملاء القاعدة نفسها الأخرين؛ وكل رسالة تحمل الحقل `clientId` (`X-Client-Id` للمُرسِل)، فما وصل بمعرّف العميل نفسه يُتجاهل مباشرةً (لأن التحديث التفاؤلي سبق أن عرضه)
- اصطلاح أنواع الحقول: `id` / `personId` / `identityId` / `organizationId` سلاسل uuid؛ و`index` رقم أو null؛ و`l10n` جدول خانات `{language-code: value}` أو null؛ و`lang` هي `X-Lang` للكاتب

### المنظمات

#### &#x200F;organization:create

**الإطلاق**: `POST /api/organizations`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف المنظمة الجديدة |
| `parentId` | string \| null | معرّف المنظمة الأم (null = المستوى الأول) |
| `index` | number \| null | موضع الإدراج بين الإخوة |
| `l10n` | object \| null | خانات الاسم الأولية |

#### &#x200F;organization:move

**الإطلاق**: `POST /api/organizations/move`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف المنظمة |
| `parentId` | string \| null | معرّف المنظمة الأم الجديدة (null = الترقية إلى المستوى الأول) |
| `index` | number \| null | الموضع بين الإخوة الهدف |

#### &#x200F;organization:delete

**الإطلاق**: `DELETE /api/organizations`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف المنظمة المحذوفة |
| `mode` | string | `promote` عند الترقية مع الإبقاء على الأفرع فقط؛ وغياب الحقل = حذف الشجرة الفرعية بأكملها حتى الأحفاد |

#### &#x200F;organization:rename

**الإطلاق**: `POST /api/organizations/rename`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف المنظمة |
| `authoritative` | string \| undefined | القيمة الجديدة للخانة المرجعية (إن لم تُمرَّر بقيت على حالها) |
| `value` | string \| undefined | القيمة الجديدة لخانة لغة الكاتب الحالية |
| `l10n` | object \| undefined | دمج خانةً خانة (upsert) (السلسلة الفارغة تُفرّغ الخانة، عدا المرجعية) |
| `lang` | string | `X-Lang` للكاتب |

### الصفات

#### &#x200F;identity:create

**الإطلاق**: `POST /api/identities`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الصفة الجديدة |
| `organizationId` | string | معرّف المنظمة التابعة لها |
| `index` | number \| null | موضع الإدراج داخل المنظمة |
| `l10n` | object \| null | خانات الاسم الأولية |

#### &#x200F;identity:move

**الإطلاق**: `POST /api/identities/move`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الصفة |
| `index` | number \| null | الموضع الجديد داخل المنظمة |

#### &#x200F;identity:move-organization

**الإطلاق**: `POST /api/identities/move-organization`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الصفة |
| `organizationId` | string | معرّف المنظمة الهدف |
| `index` | number \| null | الموضع داخل المنظمة الهدف |

#### &#x200F;identity:delete

**الإطلاق**: `DELETE /api/identities`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الصفة المحذوفة (يمسح الارتباط وطرفي العلاقة حذفًا متسلسلًا) |

#### &#x200F;identity:rename

**الإطلاق**: `POST /api/identities/rename` — الحقول كما في `organization:rename` (`id` هو معرّف الصفة).

### الأشخاص

#### &#x200F;person:create

**الإطلاق**: `POST /api/persons` (يبثّ هذا في الإنشاء المحض وفي الإنشاء مع الإسناد بخطوة واحدة؛ وعند وجود `identityId` يُرسَل **معه `assign` إضافي واحد**، ويكون `index` فيه موضع الإسناد)

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الشخص الجديد |
| `l10n` | object \| null | خانات الاسم الأولية |

#### &#x200F;person:delete

**الإطلاق**: `DELETE /api/persons`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف الشخص المحذوف (يمسح الارتباطات والعلاقات حذفًا متسلسلًا) |

#### &#x200F;person:rename

**الإطلاق**: `POST /api/persons/rename` — الحقول كما في `organization:rename` (`id` هو معرّف الشخص).

### الارتباطات

#### &#x200F;assign

**الإطلاق**: `POST /api/assignments`، أو الإرسال الثاني المتتابع من `POST /api/persons` عند تضمين `identityId`

| الحقل | النوع | الشرح |
|---|---|---|
| `personId` | string | معرّف الشخص |
| `identityId` | string | معرّف الصفة |
| `index` | number \| null | موضع الإدراج داخل الصفة |

#### &#x200F;unassign

**الإطلاق**: `DELETE /api/assignments`، أو الإرسال الثاني المتتابع من `move-identity`

| الحقل | النوع | الشرح |
|---|---|---|
| `personId` | string | معرّف الشخص |
| `identityId` | string | معرّف الصفة |

#### &#x200F;assign:move

**الإطلاق**: `POST /api/assignments/move`

| الحقل | النوع | الشرح |
|---|---|---|
| `personId` | string | معرّف الشخص |
| `identityId` | string | معرّف الصفة |
| `index` | number | الموضع الجديد داخل الصفة |

**تسلسل الإرسالات المتتابعة لـ move-identity**: يُطلِق `POST /api/assignments/move-identity` **ثلاث رسائل فأكثر** — أولًا `assign` (الصفة الهدف، ويتضمّن `index`)، ثم `unassign` (الصفة الأصلية)، ثم `personPerson:retarget` واحد لكل علاقة انتقل طرفها مع الارتباط.

### العلاقات

#### &#x200F;personPerson:create

**الإطلاق**: `POST /api/person-persons`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف العلاقة الجديدة |
| `data` | object | كامل: `{id, a: {personId, identityId}, b: {…}, l10n: {forward: {…}, backward: {…}}}`، ويستبدله الطرف المستقبِل كاملًا |

#### &#x200F;personPerson:delete

**الإطلاق**: `DELETE /api/person-persons`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف العلاقة المحذوفة |

#### &#x200F;personPerson:update

**الإطلاق**: `POST /api/person-persons/update`

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف العلاقة |
| `forward` | object \| undefined | رقعة وسم الاتجاه الموجب (إن لم تُمرَّر بقيت على حالها) |
| `backward` | object \| undefined | رقعة وسم الاتجاه المعاكس |
| `lang` | string | `X-Lang` للكاتب |

#### &#x200F;personPerson:retarget

**الإطلاق**: إعادة توجيه أطراف العلاقة منتقلةً مع `move-identity` أو بعد حذف صفة أو شخص

| الحقل | النوع | الشرح |
|---|---|---|
| `id` | string | معرّف العلاقة |
| `data` | object | العلاقة كاملة بعد تحويل أطرافها (كـ `data` في `personPerson:create`)، ويستبدلها الطرف المستقبِل كاملًا |

### البيانات الوصفية

#### &#x200F;meta

**الإطلاق**: `PUT /api/meta` (عند تبديل authoritative_lang يُرسَل **رسالان متتابعان**: أولًا `authoritative_lang` ثم `enabled_langs`)

| الحقل | النوع | الشرح |
|---|---|---|
| `key` | string | `authoritative_lang` / `enabled_langs` / `display_name` / `bg_color` |
| `value` | string | القيمة الجديدة؛ و`enabled_langs` سلسلة مفصولة بفواصل؛ و`display_name`/`bg_color` هما meta.value |
| `l10n` | object \| undefined | لـ `display_name` فقط: جدول الخانات (السلسلة الفارغة تُفرّغ الخانة) |
| `lang` | string \| undefined | لـ `display_name` فقط: `X-Lang` للكاتب |

---

## جدول رموز الأخطاء الكامل

| code | HTTP | الحالة |
|---|---|---|
| `db_not_found` | 404 | القاعدة غير موجودة |
| `not_found` | 404 | مسار API غير معروف |
| `org_not_found` | 404/400 | المنظمة غير موجودة (الحذف/إعادة التسمية 404؛ النقل 400) |
| `parent_not_found` | 404 | الأصل غير موجود عند إنشاء منظمة |
| `target_org_not_found` | 400 | المنظمة الهدف للنقل غير موجودة |
| `move_to_self` | 400 | نقل المنظمة إلى ذاتها |
| `move_to_descendant` | 400 | نقل المنظمة إلى أحد أحفادها |
| `identity_not_found` | 404/400 | الصفة غير موجودة |
| `same_target_org` | 400 | نقل الصفة إلى منظمتها الأصلية |
| `person_not_found` | 404 | الشخص غير موجود |
| `person_or_identity_not_found` | 404 | طرف الارتباط غير موجود |
| `assignment_not_found` | 400 | الارتباط غير موجود (عند الفرز) |
| `from_assignment_not_found` | 400 | لا ارتباط بهذا الشخص في الصفة الأصلية للنقل |
| `same_target_identity` | 400 | هدف نقل الارتباط = الصفة الأصلية |
| `target_identity_not_found` | 400 | الصفة الهدف للنقل غير موجودة |
| `relation_not_found` | 404 | العلاقة غير موجودة |
| `relation_with_self` | 400 | طرفا العلاقة هما الارتباط نفسه |
| `endpoint_not_assigned` | 400 | شخص طرف العلاقة غير مرتبط بالصفة الموافقة |
| `name_required` | 400 | الاسم فارغ / غياب مفاتيح الرقعة الثلاثة كلها |
| `authoritative_required` | 400 | الخانة المرجعية فارغة أو جرت محاولة إفراغها |
| `authoritative_lang_invalid` | 400 | رمز لغة مرجعية غير صالح |
| `enabled_langs_invalid` | 400 | رمز لغة مفعّلة غير صالح |
| `bad_key` | 400 | key غير معروف في PUT meta |
| `internal_error` | 500 | استثناء غير ملتقط (تدخل التفاصيل سجل الخادم فقط) |

</div>
