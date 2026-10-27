// db.js — SQLite 数据层（多库：data/ 下每个 .db 一个库，按名字懒加载并缓存连接）
// 数据多语言：主表无 description 列；名称一律存 <表>_l10n 附表按语言槽（空 = 未翻译，显示回退作准语言槽）。
// 每个库的 meta.authoritative_lang = 作准语言（创建库时按创建者界面语言刷入；存量库迁移一律定为 zh-Hans-CN）：
//   作准槽必须始终非空——新建必填；清空作准槽的写入一律拒绝；切换作准语言后新槽允许短暂为空，
//   但下次编辑该记录时必须填入作准语言才允许保存（authoritative_required）。
// 写约定（与 server.js/data.js 对齐）：patch = {authoritative?, value?, l10n?}
//   authoritative → 写作准语言槽（必须非空）；value → 写当前语言槽（lang = X-Lang）；
//   l10n → 逐语言槽 upsert（空串清空，作准槽除外）
const {DatabaseSync} = require(`node:sqlite`)
const {randomUUID} = require(`node:crypto`)
const path = require(`node:path`)
const fs = require(`node:fs`)

const DATA_DIR = path.join(__dirname, `data`)
fs.mkdirSync(DATA_DIR, {recursive: true})

// 库名只允许 字母/数字/下划线/中划线（与 server 路由一致），防止路径穿越
const NAME_RE = /^[\w-]+$/

// 界面语言 ↔ l10n 附表列名（列名用下划线形式，SQL 里免引号）
// 新增语言在此登记 + i18n.js registerLocale + l10n/<code>.js 词条即可全链路生效；
// 附表缺列由 openDb 的 ensureL10nColumns 自动补（与 ensureSortColumn 同一先例）
const LANGS = [`zh-Hans-CN`, `zh-Hant-TW`, `zh-Hant-HK`, `en-Latn-GB`, `en-Latn-US`, `ja-Jpan-JP`, `ko-Kore-KR`, `th-Thai-TH`, `fr-Latn-FR`, `ar-Arab-SA`]
const DEFAULT_LANG = `zh-Hans-CN`
const langCol = lang => String(lang).replace(/-/g, `_`)
const LANG_COLS = LANGS.map(langCol)

/** data/ 下现有的全部库名（不含 .db 扩展名） */
function listDbNames() {
	return fs.readdirSync(DATA_DIR)
		.filter(f => f.endsWith(`.db`) && NAME_RE.test(f.slice(0, -3)))
		.map(f => f.slice(0, -3))
		.sort()
}

/**
 * 显式创建新库并初始化表结构；lang = 创建者界面语言 → 作准语言种子。
 * 返回 'created' | 'exists'（库已存在）| null（名称不合法）
 */
function createDb(name, lang = DEFAULT_LANG) {
	if (!NAME_RE.test(name)) return null
	const file = path.join(DATA_DIR, `${name}.db`)
	if (dbCache.has(name) || fs.existsSync(file)) return `exists`
	fs.writeFileSync(file, ``)
	const api = openDb(name) // 打开即建表（含存量迁移，此时作准语言缺省 zh-Hans-CN）
	api.setAuthoritativeLang(LANGS.includes(lang) ? lang : DEFAULT_LANG)
	return `created`
}

const dbCache = new Map() // 库名 -> 该库的数据 API

/**
 * 打开指定数据库并返回其数据 API；连接按库名缓存。
 * 文件不存在时返回 null（不自动创建，由 server 返回 404）。
 */
function openDb(name) {
	if (!NAME_RE.test(name)) return null
	if (dbCache.has(name)) return dbCache.get(name)
	const file = path.join(DATA_DIR, `${name}.db`)
	if (!fs.existsSync(file)) return null
	const db = new DatabaseSync(file)

	// 主键统一使用 UUID（TEXT），一律由后端生成；名称无 fallback 列，一律在 _l10n 附表（作准槽保证非空）
	db.exec(`
	    CREATE TABLE IF NOT EXISTS organization
	    (
	        id         TEXT PRIMARY KEY,
	        parent_id  TEXT REFERENCES organization (id),
	        created_at TEXT NOT NULL DEFAULT (datetime('now'))
	    );

	    CREATE TABLE IF NOT EXISTS identity
	    (
	        id              TEXT PRIMARY KEY,
	        organization_id TEXT NOT NULL REFERENCES organization (id),
	        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
	    );

	    -- 人物：扁平结构，不成树
	    CREATE TABLE IF NOT EXISTS person
	    (
	        id         TEXT PRIMARY KEY,
	        created_at TEXT NOT NULL DEFAULT (datetime('now'))
	    );

	    -- 人物-身份：多对多
	    CREATE TABLE IF NOT EXISTS identity_person
	    (
	        person_id  TEXT NOT NULL REFERENCES person (id),
	        identity_id    TEXT NOT NULL REFERENCES identity (id),
	        created_at TEXT NOT NULL DEFAULT (datetime('now')),
	        PRIMARY KEY (person_id, identity_id)
	    );

	    -- 关系：连接两个「担任」（人物+身份），双向标签只存 person_person_l10n 槽（作准槽必填）
	    CREATE TABLE IF NOT EXISTS person_person
	    (
	        id          TEXT PRIMARY KEY,
	        a_person_id TEXT NOT NULL REFERENCES person (id),
	        a_identity_id   TEXT NOT NULL REFERENCES identity (id),
	        b_person_id TEXT NOT NULL REFERENCES person (id),
	        b_identity_id   TEXT NOT NULL REFERENCES identity (id),
	        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
	    );

	    -- 元信息：键值对（用户配置才写入，缺省走应用默认值）；authoritative_lang = 作准语言
	    CREATE TABLE IF NOT EXISTS meta
	    (
	        id    TEXT PRIMARY KEY,
	        value TEXT NOT NULL
	    );

	    -- 数据多语言附表：id 对本表 id，语言列为槽（NULL = 未翻译，显示回退作准语言槽）
	    CREATE TABLE IF NOT EXISTS organization_l10n
	    (
	        id    TEXT PRIMARY KEY REFERENCES organization (id),
	        zh_Hans_CN TEXT, en_Latn_US TEXT, ja_Jpan_JP TEXT
	    );

	    CREATE TABLE IF NOT EXISTS identity_l10n
	    (
	        id    TEXT PRIMARY KEY REFERENCES identity (id),
	        zh_Hans_CN TEXT, en_Latn_US TEXT, ja_Jpan_JP TEXT
	    );

	    CREATE TABLE IF NOT EXISTS person_l10n
	    (
	        id    TEXT PRIMARY KEY REFERENCES person (id),
	        zh_Hans_CN TEXT, en_Latn_US TEXT, ja_Jpan_JP TEXT
	    );

	    -- 关系双向标签的翻译：(id, type) 联合主键
	    CREATE TABLE IF NOT EXISTS person_person_l10n
	    (
	        id    TEXT NOT NULL REFERENCES person_person (id),
	        type  TEXT NOT NULL CHECK (type IN ('forward', 'backward')),
	        zh_Hans_CN TEXT, en_Latn_US TEXT, ja_Jpan_JP TEXT,
	        PRIMARY KEY (id, type)
	    );

	    -- 元信息文本键（display_name）的翻译；id 即 meta 键
	    CREATE TABLE IF NOT EXISTS meta_l10n
	    (
	        id    TEXT PRIMARY KEY,
	        zh_Hans_CN TEXT, en_Latn_US TEXT, ja_Jpan_JP TEXT
	    );
	`)

	// 迁移：组织 / 身份 / 担任 补充同级排序字段（旧库按 rowid 回填）
	function ensureSortColumn(table) {
		const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
		if (!cols.includes(`sort_order`)) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN sort_order INTEGER`)
			db.exec(`UPDATE ${table} SET sort_order = rowid`)
		}
	}

	ensureSortColumn(`organization`)
	ensureSortColumn(`identity`)
	ensureSortColumn(`identity_person`)

	// 语言列演进：l10n 附表缺新语言列时自动补（语言增员属常态，与 ensureSortColumn 同一先例）
	function ensureL10nColumns() {
		const tables = [`organization_l10n`, `identity_l10n`, `person_l10n`, `person_person_l10n`, `meta_l10n`]
		for (const table of tables) {
			const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
			for (const col of LANG_COLS) {
				if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`)
			}
		}
	}

	ensureL10nColumns()

	/** 通用：把 key 移动到 parent 子列表的 index 处，并重写该列表的 sort_order */
	function reorderSiblings(table, parentCol, parentId, keyCol, key, index) {
		const keys = db.prepare(`SELECT ${keyCol} AS k FROM ${table} WHERE ${parentCol} IS ? ORDER BY sort_order`)
			.all(parentId).map(r => r.k).filter(x => x !== key)
		const at = index == null ? keys.length : Math.max(0, Math.min(index, keys.length))
		keys.splice(at, 0, key)
		const upd = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE ${keyCol} = ? AND ${parentCol} IS ?`)
		keys.forEach((k, i) => upd.run(i, k, parentId))
	}

	/** l10n 槽 upsert：vals = {zh_Hans_CN?: string|null}（null/'' = 清空该槽）；type 用于 person_person_l10n 的 (id, type) 键 */
	function upsertL10nRow(table, id, vals, type = null) {
		const cols = Object.keys(vals).filter(c => LANG_COLS.includes(c))
		if (!cols.length) return
		const setSql = cols.map(c => `${c} = excluded.${c}`).join(`, `)
		const marks = cols.map(() => `?`).join(`, `)
		const row = type == null
			? db.prepare(`INSERT INTO ${table} (id, ${cols.join(`, `)}) VALUES (?, ${marks})
				ON CONFLICT(id) DO UPDATE SET ${setSql}`)
			: db.prepare(`INSERT INTO ${table} (id, type, ${cols.join(`, `)}) VALUES (?, ?, ${marks})
				ON CONFLICT(id, type) DO UPDATE SET ${setSql}`)
		const args = cols.map(c => vals[c] || null)
		if (type == null) row.run(id, ...args)
		else row.run(id, type, ...args)
	}

	/** 语言码 → 列名 白名单过滤后的槽值表（locale → value 的入参转换为列形式；无效语言丢弃） */
	function normL10n(map) {
		const out = {}
		if (!map || typeof map !== `object`) return out
		for (const [k, v] of Object.entries(map)) {
			if (LANGS.includes(k)) out[langCol(k)] = typeof v === `string` ? v : null
		}
		return out
	}

	// ---------- 作准语言 ----------

	/** 作准语言（meta.authoritative_lang；缺省/非法回退默认语言，保证下游总有合法值） */
	function getAuthoritativeLang() {
		const r = db.prepare(`SELECT value FROM meta WHERE id = 'authoritative_lang'`).get()
		return r && LANGS.includes(r.value) ? r.value : DEFAULT_LANG
	}

	/** 切换作准语言（设置入口；新槽允许空，由填坑规则在下次编辑时约束）；新作准语言自动纳入启用语言集 */
	function setAuthoritativeLang(lang) {
		if (!LANGS.includes(lang)) return {error: `authoritative_lang_invalid`}
		db.prepare(`INSERT INTO meta (id, value) VALUES ('authoritative_lang', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`).run(lang)
		ensureEnabledLang(lang)
		return {ok: true}
	}

	// ---------- 启用语言 ----------

	/**
	 * 启用语言（meta.enabled_langs，逗号分隔的语言代码）：名称表单可录入的语言集合，存储顺序即手动排序。
	 * 缺省/损坏回退 [作准语言]；集内必含作准语言且恒在首位（normEnabled 维持该不变量）。
	 */
	function normEnabled(list) {
		const seen = new Set()
		const out = []
		for (const c of list) {
			if (LANGS.includes(c) && !seen.has(c)) {
				seen.add(c)
				out.push(c)
			}
		}
		const auth = getAuthoritativeLang()
		const i = out.indexOf(auth)
		if (i > 0) {
			out.splice(i, 1)
			out.unshift(auth)
		} else if (i < 0) out.unshift(auth)
		return out
	}

	function getEnabledLangs() {
		const r = db.prepare(`SELECT value FROM meta WHERE id = 'enabled_langs'`).get()
		return r ? normEnabled(String(r.value).split(`,`)) : [getAuthoritativeLang()]
	}

	function writeEnabledLangs(list) {
		db.prepare(`INSERT INTO meta (id, value) VALUES ('enabled_langs', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`).run(list.join(`,`))
	}

	/** 作准语言纳入启用集（切换作准时调用，维持「启用集必含作准且在首位」） */
	function ensureEnabledLang(lang) {
		const set = getEnabledLangs()
		if (!set.includes(lang)) {
			set.unshift(lang)
			writeEnabledLangs(set)
		}
	}

	/** 设置启用语言：入参数组或逗号串（顺序即排序）；含未知代码拒绝；作准语言恒归一到首位 */
	function setEnabledLangs(value) {
		const arr = Array.isArray(value) ? value : String(value || ``).split(`,`)
		const codes = arr.map(x => String(x).trim()).filter(Boolean)
		if (codes.some(c => !LANGS.includes(c))) return {error: `enabled_langs_invalid`}
		const set = normEnabled(codes)
		writeEnabledLangs(set)
		return {ok: true, langs: set}
	}

	// ---------- 查询 ----------

	/** 组织树：节点附带 parent_id 与身份列表（按 sort_order 排序），身份附带担任人物列表（按 sort_order）；名称不在此解析（纯结构） */
	function getOrganizationTree() {
		const rows = db.prepare(`SELECT id, parent_id FROM organization ORDER BY sort_order`).all()
		const identityRows = db.prepare(`SELECT id, organization_id FROM identity ORDER BY sort_order`).all()
		const prRows = db.prepare(`
	    SELECT pr.identity_id AS identity_id, p.id AS id
	    FROM identity_person pr JOIN person p ON p.id = pr.person_id
	    ORDER BY pr.sort_order
	  `).all()

		const personsByIdentity = new Map()
		for (const r of prRows) {
			if (!personsByIdentity.has(r.identity_id)) personsByIdentity.set(r.identity_id, [])
			personsByIdentity.get(r.identity_id).push({id: r.id})
		}
		const identitiesByOrganization = new Map()
		for (const r of identityRows) {
			if (!identitiesByOrganization.has(r.organization_id)) identitiesByOrganization.set(r.organization_id, [])
			identitiesByOrganization.get(r.organization_id).push({id: r.id, persons: personsByIdentity.get(r.id) || []})
		}

		const byId = new Map(rows.map(r => [r.id, {
			id: r.id,
			parent_id: r.parent_id,
			identities: identitiesByOrganization.get(r.id) || [],
			children: [],
		}]))
		const roots = []
		for (const r of rows) {
			const node = byId.get(r.id)
			if (r.parent_id != null && byId.has(r.parent_id)) {
				byId.get(r.parent_id).children.push(node)
			} else {
				roots.push(node)
			}
		}
		return roots
	}

	/** 人物列表：扁平；担任身份只回 id（展示名由前端按界面语言解析） */
	function listPersons() {
		const person = db.prepare(`SELECT id FROM person ORDER BY rowid`).all()
		const stmt = db.prepare(`
	    SELECT r.id AS id
	    FROM identity_person pr
	    JOIN identity r ON r.id = pr.identity_id
	    WHERE pr.person_id = ?
	    ORDER BY pr.sort_order
	  `)
		return person.map(p => ({id: p.id, identities: stmt.all(p.id)}))
	}

	const PERSON_PERSON_SQL = `
	    SELECT r.id,
	           r.a_person_id AS aPersonId, r.a_identity_id AS aIdentityId,
	           r.b_person_id AS bPersonId, r.b_identity_id AS bIdentityId
	    FROM person_person r
	`

	/** 单条关系 → 前端结构：端点只含 id，标签不在此解析（纯结构） */
	function normalizePersonPerson(r) {
		return {
			id: r.id,
			a: {personId: r.aPersonId, identityId: r.aIdentityId},
			b: {personId: r.bPersonId, identityId: r.bIdentityId},
		}
	}

	/** 关系列表 */
	function listPersonPersons() {
		return db.prepare(`${PERSON_PERSON_SQL} ORDER BY r.rowid`).all().map(normalizePersonPerson)
	}

	/** 单条关系（协作广播用）：端点 id + 双向标签槽（locale 键，缺省 {forward: {}, backward: {})）；不存在时返回 null */
	function getPersonPerson(id) {
		const r = db.prepare(`${PERSON_PERSON_SQL} WHERE r.id = ?`).get(id)
		if (!r) return null
		const cols = LANG_COLS.join(`, `)
		const l10n = {forward: {}, backward: {}}
		for (const row of db.prepare(`SELECT type, ${cols} FROM person_person_l10n WHERE id = ?`).all(id)) {
			const slots = {}
			for (const col of LANG_COLS) if (row[col]) slots[col.replace(/_/g, `-`)] = row[col]
			l10n[row.type] = slots
		}
		return {...normalizePersonPerson(r), l10n}
	}

	/** 全量 l10n 槽（原行直出，前端按 locale↔列名映射合并）：loadAll 一次拉全 */
	function getL10n() {
		return {
			organization: db.prepare(`SELECT * FROM organization_l10n`).all(),
			identity: db.prepare(`SELECT * FROM identity_l10n`).all(),
			person: db.prepare(`SELECT * FROM person_l10n`).all(),
			personPerson: db.prepare(`SELECT * FROM person_person_l10n`).all(),
			meta: db.prepare(`SELECT * FROM meta_l10n`).all(),
		}
	}

	// ---------- 写入（id 一律由后端生成） ----------

	/** 作准槽取值（locale 键表 → 当前作准语言列的非空串）；l10n 为 null/非对象时返回 '' */
	function authSlotOf(l10n) {
		if (!l10n || typeof l10n !== `object`) return ``
		return String(l10n[getAuthoritativeLang()] || ``).trim()
	}

	/** 新建组织：parentId 为 null 时创建一级组织；index 指定同级插入位置；l10n = {locale: 值} 初始槽（作准槽必填） */
	function createOrganization(parentId, index = null, l10n = null) {
		if (parentId != null) {
			const p = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(parentId)
			if (!p) return null
		}
		if (!authSlotOf(l10n)) return {error: `authoritative_required`}
		const id = randomUUID()
		db.exec(`BEGIN`)
		try {
			db.prepare(`INSERT INTO organization (id, parent_id, sort_order) VALUES (?, ?, 0)`).run(id, parentId)
			reorderSiblings(`organization`, `parent_id`, parentId, `id`, id, index)
			upsertL10nRow(`organization_l10n`, id, normL10n(l10n))
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {id}
	}

	/** 移动组织：换父级 / 同级排序；禁止移入自身或其后代 */
	function moveOrganization(id, parentId, index) {
		if (id === parentId) return {error: `move_to_self`}
		const node = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(id)
		if (!node) return {error: `org_not_found`}
		if (parentId != null) {
			const p = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(parentId)
			if (!p) return {error: `target_org_not_found`}
			const desc = new Set()
			const collect = oid => {
				db.prepare(`SELECT id FROM organization WHERE parent_id = ?`).all(oid)
					.forEach(r => {
						desc.add(r.id)
						collect(r.id)
					})
			}
			collect(id)
			if (desc.has(parentId)) return {error: `move_to_descendant`}
		}
		db.exec(`BEGIN`)
		try {
			db.prepare(`UPDATE organization SET parent_id = ? WHERE id = ?`).run(parentId, id)
			reorderSiblings(`organization`, `parent_id`, parentId, `id`, id, index)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {ok: true}
	}

	/** 在组织下新建身份（默认排到末尾）；l10n 初始槽（作准槽必填） */
	function createIdentity(organizationId, index = null, l10n = null) {
		const o = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(organizationId)
		if (!o) return null
		if (!authSlotOf(l10n)) return {error: `authoritative_required`}
		const id = randomUUID()
		db.exec(`BEGIN`)
		try {
			db.prepare(`INSERT INTO identity (id, organization_id, sort_order) VALUES (?, ?, 0)`).run(id, organizationId)
			reorderSiblings(`identity`, `organization_id`, organizationId, `id`, id, index)
			upsertL10nRow(`identity_l10n`, id, normL10n(l10n))
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {id, organization_id: organizationId}
	}

	/** 身份排序：仅允许在同一组织内移动（不会移到其他组织） */
	function moveIdentity(id, index) {
		const identity = db.prepare(`SELECT id, organization_id FROM identity WHERE id = ?`).get(id)
		if (!identity) return {error: `identity_not_found`}
		db.exec(`BEGIN`)
		try {
			reorderSiblings(`identity`, `organization_id`, identity.organization_id, `id`, id, index)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {ok: true}
	}

	/** 身份移动到另一组织（跨组织拖拽）：只改 identity 单表——organization_id 改指 + 两侧 sort_order 重排
	 *  担任（identity_person）与关系（person_person）引用 identity_id 不变，自动随迁 */
	function moveIdentityToOrganization(id, organizationId, index = null) {
		const identity = db.prepare(`SELECT id, organization_id FROM identity WHERE id = ?`).get(id)
		if (!identity) return {error: `identity_not_found`}
		const target = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(organizationId)
		if (!target) return {error: `target_org_not_found`}
		if (identity.organization_id === organizationId) return {error: `same_target_org`}
		db.exec(`BEGIN`)
		try {
			// 旧组织身份列表剔除本身份后序号压紧
			const oldSibs = db.prepare(`SELECT id FROM identity WHERE organization_id = ? AND id != ? ORDER BY sort_order`)
				.all(identity.organization_id, id)
			const upd = db.prepare(`UPDATE identity SET sort_order = ? WHERE id = ?`)
			oldSibs.forEach((x, i) => upd.run(i, x.id))
			// 改指新组织，并按位置插入其身份列表
			db.prepare(`UPDATE identity SET organization_id = ? WHERE id = ?`).run(organizationId, id)
			reorderSiblings(`identity`, `organization_id`, organizationId, `id`, id, index)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {ok: true}
	}

	/** 新建人物；l10n 初始槽（作准槽必填） */
	function createPerson(l10n = null) {
		if (!authSlotOf(l10n)) return {error: `authoritative_required`}
		const id = randomUUID()
		db.prepare(`INSERT INTO person (id) VALUES (?)`).run(id)
		upsertL10nRow(`person_l10n`, id, normL10n(l10n))
		return {id}
	}

	/** 建立 人物-身份 关联（幂等；index 指定在该身份内的插入位置） */
	function assignIdentity(personId, identityId, index = null) {
		const p = db.prepare(`SELECT id FROM person WHERE id = ?`).get(personId)
		const r = db.prepare(`SELECT id FROM identity WHERE id = ?`).get(identityId)
		if (!p || !r) return null
		const next = db.prepare(`SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM identity_person WHERE identity_id = ?`).get(identityId).n
		db.prepare(`INSERT OR IGNORE INTO identity_person (person_id, identity_id, sort_order) VALUES (?, ?, ?)`).run(personId, identityId, next)
		if (index != null) reorderSiblings(`identity_person`, `identity_id`, identityId, `person_id`, personId, index)
		return {personId, identityId}
	}

	/** 新建人物并直接指派到身份（POST /api/persons 带 identityId 时一步走；作准槽必填、身份须存在） */
	function createPersonAssign(l10n = null, identityId = null, index = null) {
		if (!authSlotOf(l10n)) return {error: `authoritative_required`}
		if (!db.prepare(`SELECT id FROM identity WHERE id = ?`).get(identityId)) return {error: `identity_not_found`}
		const id = randomUUID()
		db.prepare(`INSERT INTO person (id) VALUES (?)`).run(id)
		upsertL10nRow(`person_l10n`, id, normL10n(l10n))
		assignIdentity(id, identityId, index)
		return {id, personId: id, identityId}
	}

	function removeAssignment(personId, identityId) {
		db.prepare(`DELETE FROM identity_person WHERE person_id = ? AND identity_id = ?`).run(personId, identityId)
	}

	/** 担任排序：仅允许在同一身份内移动 */
	function moveAssignment(personId, identityId, index) {
		const row = db.prepare(`SELECT 1 AS x FROM identity_person WHERE person_id = ? AND identity_id = ?`).get(personId, identityId)
		if (!row) return {error: `assignment_not_found`}
		db.exec(`BEGIN`)
		try {
			reorderSiblings(`identity_person`, `identity_id`, identityId, `person_id`, personId, index)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {ok: true}
	}

	/** 平移担任到同组织另一身份（拖拽人物）：移入新身份 + 断开原身份 + 关系端点随迁（事务）
	 *  返回 {ok, ids}：ids = 端点被重定位的关系 id 列表（协作广播刷新用） */
	function moveAssignmentToIdentity(personId, fromIdentityId, toIdentityId, index = null) {
		const from = db.prepare(`SELECT 1 AS x FROM identity_person WHERE person_id = ? AND identity_id = ?`).get(personId, fromIdentityId)
		if (!from) return {error: `from_assignment_not_found`}
		if (fromIdentityId === toIdentityId) return {error: `same_target_identity`}
		const to = db.prepare(`SELECT id FROM identity WHERE id = ?`).get(toIdentityId)
		if (!to) return {error: `target_identity_not_found`}
		// 端点随迁前先记下受影响的全部关系（两个方向）
		const ids = db.prepare(`
			SELECT id FROM person_person
			WHERE (a_person_id = ? AND a_identity_id = ?) OR (b_person_id = ? AND b_identity_id = ?)
		`).all(personId, fromIdentityId, personId, fromIdentityId).map(r => r.id)
		db.exec(`BEGIN`)
		try {
			// 未在目标身份担任才插入（已担任则仅断开原身份，幂等防御）
			const already = db.prepare(`SELECT 1 AS x FROM identity_person WHERE person_id = ? AND identity_id = ?`).get(personId, toIdentityId)
			if (!already) {
				const next = db.prepare(`SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM identity_person WHERE identity_id = ?`).get(toIdentityId).n
				db.prepare(`INSERT INTO identity_person (person_id, identity_id, sort_order) VALUES (?, ?, ?)`).run(personId, toIdentityId, index == null ? next : 0)
				if (index != null) reorderSiblings(`identity_person`, `identity_id`, toIdentityId, `person_id`, personId, index)
			}
			db.prepare(`DELETE FROM identity_person WHERE person_id = ? AND identity_id = ?`).run(personId, fromIdentityId)
			// 关系端点随迁：指向「原身份里的该人物」的端点改指「新身份里的该人物」
			db.prepare(`UPDATE person_person SET a_identity_id = ? WHERE a_person_id = ? AND a_identity_id = ?`).run(toIdentityId, personId, fromIdentityId)
			db.prepare(`UPDATE person_person SET b_identity_id = ? WHERE b_person_id = ? AND b_identity_id = ?`).run(toIdentityId, personId, fromIdentityId)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return {ok: true, ids}
	}

	/** 通用名称 patch：authoritative 写作准槽（必须非空）；value 写当前语言槽；l10n 逐槽 upsert（空清空）
	 *  作准槽禁止清空；作准槽现值为空且本次未填入 → authoritative_required（切换作准语言后的填坑规则） */
	function patchNamedEntity(table, l10nTable, id, patch, lang) {
		const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)
		if (!row) return null
		const authCol = langCol(getAuthoritativeLang())
		const vals = normL10n(patch.l10n)
		if (patch.authoritative !== undefined) {
			const a = String(patch.authoritative).trim()
			if (!a) return {error: `authoritative_required`}
			vals[authCol] = a
		}
		if (patch.value !== undefined) vals[langCol(lang)] = patch.value || null
		if (vals[authCol] !== undefined && !vals[authCol]) return {error: `authoritative_required`}
		const cur = db.prepare(`SELECT ${authCol} AS v FROM ${l10nTable} WHERE id = ?`).get(id)
		if ((!cur || !cur.v) && !vals[authCol]) return {error: `authoritative_required`}
		upsertL10nRow(l10nTable, id, vals)
		return {ok: true}
	}

	/** 收集受影响的全部关系 id（端点身份在 identityIds 内） */
	function ppIdsByIdentity(identityIds) {
		if (!identityIds.length) return []
		const rph = identityIds.map(() => `?`).join(`,`)
		return db.prepare(`SELECT id FROM person_person WHERE a_identity_id IN (${rph}) OR b_identity_id IN (${rph})`)
			.all(...identityIds, ...identityIds).map(r => r.id)
	}

	function deletePpL10nById(ids) {
		if (!ids.length) return
		const ph = ids.map(() => `?`).join(`,`)
		db.prepare(`DELETE FROM person_person_l10n WHERE id IN (${ph})`).run(...ids)
	}

	/** 删除组织：级联抹除所有子组织、身份、担任与相关关系及全部翻译行（事务保证原子性）
	 *  注意外键顺序：l10n 附表引用主表，必须先于主表行删除 */
	function deleteOrganizationCascade(id) {
		const exists = db.prepare(`SELECT id FROM organization WHERE id = ?`).get(id)
		if (!exists) return false
		const organizationIds = []
		const collect = oid => {
			organizationIds.push(oid)
			db.prepare(`SELECT id FROM organization WHERE parent_id = ?`).all(oid).forEach(r => collect(r.id))
		}
		collect(id)
		const oph = organizationIds.map(() => `?`).join(`,`)
		const identityIds = db.prepare(`SELECT id FROM identity WHERE organization_id IN (${oph})`).all(...organizationIds).map(r => r.id)
		db.exec(`BEGIN`)
		try {
			if (identityIds.length) {
				const rph = identityIds.map(() => `?`).join(`,`)
				db.prepare(`DELETE FROM identity_person WHERE identity_id IN (${rph})`).run(...identityIds)
				deletePpL10nById(ppIdsByIdentity(identityIds))
				db.prepare(`DELETE FROM person_person WHERE a_identity_id IN (${rph}) OR b_identity_id IN (${rph})`).run(...identityIds, ...identityIds)
				db.prepare(`DELETE FROM identity_l10n WHERE id IN (${rph})`).run(...identityIds)
				db.prepare(`DELETE FROM identity WHERE id IN (${rph})`).run(...identityIds)
			}
			db.prepare(`DELETE FROM organization_l10n WHERE id IN (${oph})`).run(...organizationIds)
			db.prepare(`DELETE FROM organization WHERE id IN (${oph})`).run(...organizationIds)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return true
	}

	/** 删除组织（保留下级）：本组织自身的身份/担任/关系级联抹除；直接下级提升到原上级，
	 *  整体插入本组织在兄弟列表中的原位（保持各自相对顺序；下级自己的子树随之带走） */
	function deleteOrganizationPromote(id) {
		const node = db.prepare(`SELECT id, parent_id FROM organization WHERE id = ?`).get(id)
		if (!node) return false
		const kids = db.prepare(`SELECT id FROM organization WHERE parent_id = ? ORDER BY sort_order`).all(id).map(r => r.id)
		const siblings = db.prepare(`SELECT id FROM organization WHERE parent_id IS ? ORDER BY sort_order`).all(node.parent_id).map(r => r.id)
		const at = siblings.indexOf(id)
		db.exec(`BEGIN`)
		try {
			// 本组织自身的身份级联（下级的身份随各自子树保留）
			const identityIds = db.prepare(`SELECT id FROM identity WHERE organization_id = ?`).all(id).map(r => r.id)
			if (identityIds.length) {
				const ph = identityIds.map(() => `?`).join(`,`)
				db.prepare(`DELETE FROM identity_person WHERE identity_id IN (${ph})`).run(...identityIds)
				deletePpL10nById(ppIdsByIdentity(identityIds))
				db.prepare(`DELETE FROM person_person WHERE a_identity_id IN (${ph}) OR b_identity_id IN (${ph})`).run(...identityIds, ...identityIds)
				db.prepare(`DELETE FROM identity_l10n WHERE id IN (${ph})`).run(...identityIds)
				db.prepare(`DELETE FROM identity WHERE id IN (${ph})`).run(...identityIds)
			}
			// 重排：上级子列表去掉本组织，在原位插入全部直接下级
			const rest = siblings.filter(x => x !== id)
			rest.splice(at < 0 ? rest.length : at, 0, ...kids)
			const upd = db.prepare(`UPDATE organization SET parent_id = ?, sort_order = ? WHERE id = ?`)
			rest.forEach((k, i) => upd.run(node.parent_id, i, k))
			db.prepare(`DELETE FROM organization_l10n WHERE id = ?`).run(id)
			db.prepare(`DELETE FROM organization WHERE id = ?`).run(id)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return true
	}

	/** 删除身份：级联抹除其担任与相关关系及翻译行（l10n 附表先于主表删除） */
	function deleteIdentityCascade(id) {
		const exists = db.prepare(`SELECT id FROM identity WHERE id = ?`).get(id)
		if (!exists) return false
		db.exec(`BEGIN`)
		try {
			db.prepare(`DELETE FROM identity_person WHERE identity_id = ?`).run(id)
			deletePpL10nById(ppIdsByIdentity([id]))
			db.prepare(`DELETE FROM person_person WHERE a_identity_id = ? OR b_identity_id = ?`).run(id, id)
			db.prepare(`DELETE FROM identity_l10n WHERE id = ?`).run(id)
			db.prepare(`DELETE FROM identity WHERE id = ?`).run(id)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return true
	}

	/** 删除人物：级联断开其担任与所有相关关系及翻译行（l10n 附表先于主表删除） */
	function deletePersonCascade(id) {
		const exists = db.prepare(`SELECT id FROM person WHERE id = ?`).get(id)
		if (!exists) return false
		const ppIds = db.prepare(`SELECT id FROM person_person WHERE a_person_id = ? OR b_person_id = ?`).all(id, id).map(r => r.id)
		db.exec(`BEGIN`)
		try {
			deletePpL10nById(ppIds)
			db.prepare(`DELETE FROM person_person WHERE a_person_id = ? OR b_person_id = ?`).run(id, id)
			db.prepare(`DELETE FROM identity_person WHERE person_id = ?`).run(id)
			db.prepare(`DELETE FROM person_l10n WHERE id = ?`).run(id)
			db.prepare(`DELETE FROM person WHERE id = ?`).run(id)
			db.exec(`COMMIT`)
		} catch (e) {
			db.exec(`ROLLBACK`)
			throw e
		}
		return true
	}

	/** 建立关系：两端必须是真实存在的担任；l10n = {forward: {locale: 值}, backward: {locale: 值}} 初始槽（双向作准槽必填） */
	function createPersonPerson(aPersonId, aIdentityId, bPersonId, bIdentityId, l10n = null) {
		if (aPersonId === bPersonId && aIdentityId === bIdentityId) return {error: `relation_with_self`}
		if (!authSlotOf(l10n && l10n.forward) || !authSlotOf(l10n && l10n.backward)) return {error: `authoritative_required`}
		const has = (p, r) =>
			db.prepare(`SELECT 1 AS x FROM identity_person WHERE person_id = ? AND identity_id = ?`).get(p, r)
		if (!has(aPersonId, aIdentityId) || !has(bPersonId, bIdentityId)) {
			return {error: `endpoint_not_assigned`}
		}
		const id = randomUUID()
		db.prepare(
			`INSERT INTO person_person (id, a_person_id, a_identity_id, b_person_id, b_identity_id) VALUES (?, ?, ?, ?, ?)`
		).run(id, aPersonId, aIdentityId, bPersonId, bIdentityId)
		if (l10n) {
			if (l10n.forward) upsertL10nRow(`person_person_l10n`, id, normL10n(l10n.forward), `forward`)
			if (l10n.backward) upsertL10nRow(`person_person_l10n`, id, normL10n(l10n.backward), `backward`)
		}
		return {id}
	}

	function deletePersonPerson(id) {
		db.prepare(`DELETE FROM person_person_l10n WHERE id = ?`).run(id)
		db.prepare(`DELETE FROM person_person WHERE id = ?`).run(id)
	}

	/** 更新关系双向标签：patch = {forward?: {authoritative?, value?, l10n?}, backward?: {...}}
	 *  作准槽禁止清空；作准槽现值为空且本次未填入 → authoritative_required（填坑规则） */
	function updatePersonPerson(id, patch, lang) {
		const row = db.prepare(`SELECT id FROM person_person WHERE id = ?`).get(id)
		if (!row) return {error: `relation_not_found`}
		const authCol = langCol(getAuthoritativeLang())
		for (const dir of [`forward`, `backward`]) {
			const dp = patch[dir]
			if (!dp) continue
			const vals = normL10n(dp.l10n)
			if (dp.authoritative !== undefined) {
				const a = String(dp.authoritative).trim()
				if (!a) return {error: `authoritative_required`}
				vals[authCol] = a
			}
			if (dp.value !== undefined) vals[langCol(lang)] = dp.value || null
			if (vals[authCol] !== undefined && !vals[authCol]) return {error: `authoritative_required`}
			const cur = db.prepare(`SELECT ${authCol} AS v FROM person_person_l10n WHERE id = ? AND type = ?`).get(id, dir)
			if ((!cur || !cur.v) && !vals[authCol]) return {error: `authoritative_required`}
			upsertL10nRow(`person_person_l10n`, id, vals, dir)
		}
		return {ok: true}
	}

	/** 重命名（通用 patch 语义）：authoritative/value/l10n 见文件头约定；lang = 当前语言 */
	function renameOrganization(id, patch, lang) {
		const r = patchNamedEntity(`organization`, `organization_l10n`, id, patch, lang)
		return r === null ? {error: `org_not_found`} : (r.error ? r : {ok: true})
	}

	function renameIdentity(id, patch, lang) {
		const r = patchNamedEntity(`identity`, `identity_l10n`, id, patch, lang)
		return r === null ? {error: `identity_not_found`} : (r.error ? r : {ok: true})
	}

	function renamePerson(id, patch, lang) {
		const r = patchNamedEntity(`person`, `person_l10n`, id, patch, lang)
		return r === null ? {error: `person_not_found`} : (r.error ? r : {ok: true})
	}

	/** 元信息取值：不存在返回 null（调用方回退默认值）
	 *  display_name 是纯本地化键（只存 meta_l10n 槽，meta 本表不存）：为兼容读取，回退到 zh_Hans_CN 槽 */
	function getMeta(id) {
		if (id === `display_name`) {
			const r = db.prepare(`SELECT zh_Hans_CN FROM meta_l10n WHERE id = ?`).get(id)
			return r ? r.zh_Hans_CN : null
		}
		const r = db.prepare(`SELECT value FROM meta WHERE id = ?`).get(id)
		return r ? r.value : null
	}

	function setMetaValue(id, value) {
		db.prepare(`INSERT INTO meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`).run(id, value)
	}

	/** 元信息写入：bg_color 只收 value/description（写 meta.value，空 = 删行）；
	 *  display_name 是纯本地化键：只写 meta_l10n 槽（meta 本表不存），value 写当前语言槽，l10n 逐槽；
	 *  空值 = 清空对应槽（该语言回退库名），不影响其他语言槽 */
	function setMeta(id, patch, lang) {
		if (id === `bg_color`) {
			const v = patch.description !== undefined ? patch.description : patch.value
			if (!v) return deleteMeta(id)
			setMetaValue(id, v)
			return {id, value: v}
		}
		const vals = normL10n(patch.l10n)
		if (patch.value !== undefined) vals[langCol(lang)] = patch.value || null
		upsertL10nRow(`meta_l10n`, id, vals)
		return {id, value: null}
	}

	/** 元信息删除：恢复默认值（移除对应行与翻译槽） */
	function deleteMeta(id) {
		db.prepare(`DELETE FROM meta WHERE id = ?`).run(id)
		db.prepare(`DELETE FROM meta_l10n WHERE id = ?`).run(id)
		return {id, value: null}
	}

	/** 导出原始库文件：VACUUM INTO 打一致性快照到目标路径（比直接拷文件安全，活动连接不会写半页） */
	function exportTo(file) {
		db.exec(`VACUUM INTO '${String(file).replace(/'/g, `''`)}'`)
	}

	const api = {
		getOrganizationTree, listPersons, listPersonPersons, getPersonPerson, getL10n,
		createOrganization, moveOrganization, createIdentity, moveIdentity, moveIdentityToOrganization, createPerson,
		assignIdentity, removeAssignment, moveAssignment, moveAssignmentToIdentity, createPersonAssign,
		createPersonPerson, deletePersonPerson, updatePersonPerson,
		deleteOrganizationCascade, deleteOrganizationPromote, deleteIdentityCascade, deletePersonCascade,
		renameOrganization, renameIdentity, renamePerson,
		getMeta, setMeta, deleteMeta, getAuthoritativeLang, setAuthoritativeLang, getEnabledLangs, setEnabledLangs, exportTo,
	}
	dbCache.set(name, api)
	return api
}

module.exports = {openDb, createDb, listDbNames, LANGS, DEFAULT_LANG, langCol}
