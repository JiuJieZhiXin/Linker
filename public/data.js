// data.js — 数据层：后端通信 + 前端缓存 + 乐观更新
//
// 临时 key 机制：新建条目挂 tempKey(Symbol)，并在 pendingIds 里登记
// 「tempKey -> Promise<真实id>」，后端返回后 promise 兑现、真实 id 回赋对象（adoptId）。
// 后续交互的 key 若在映射表中，就 await 该 promise 拿真实 id 再发请求；
// 否则 key 本身就是真实 id（uuid）——前台显示与后台保存分线进行，顺序天然正确。
// 刷新页面后真实数据结构重建，Symbol 只是临时的。
// 协作同步：他人写入成功后服务器经 WebSocket 广播变更（见 collab.js），
// 由 applyRemote 把远端变更落到本地缓存——只轻量重绘，不动缩放/聚焦等视图状态。
//
// 错误约定：后端只回错误代码（{error: code}），文本由前端 l10n 维护（error.* 词条），见 apiError()
// 数据多语言：名称只存 l10n 附表的语言槽（locale 键槽表）；.name = 界面语言槽 → 本语回退列表（仅启用语言）→ 作准语言槽的显示名
import {availableLocales, getLocale, t} from './i18n.js'

// l10n 附表的列名集（zh_Hans_CN/ar_Arab_SA …），随注册语言自动扩展
const L10N_COLS = availableLocales().map(x => x.code.replace(/-/g, `_`))

const domKeyReg = new WeakMap() // tempKey(Symbol) -> dom 用字符串
const byDom = new Map()         // dom 字符串 -> 条目（HTML5 dataTransfer 只能传字符串，反向查找用）
let tmpSeq = 0
export const keyOf = item => item.id || item.tempKey

export function domKey(item) {
	if (item.id) return item.id
	if (!domKeyReg.has(item.tempKey)) {
		const s = `tmp-${++tmpSeq}`
		domKeyReg.set(item.tempKey, s)
		byDom.set(s, item)
	}
	return domKeyReg.get(item.tempKey)
}

export function itemByDom(str) {
	const it = byDom.get(str)
	if (it) return it
	// 真实 id：直接在 store 里找（人物 → 组织）
	const p = store.persons.find(x => x.id === str)
	if (p) return p
	return findNode(str)
}

// dom 字符串 → 数据 key（真实 id 直接返回；tmp-N 反查条目后取 keyOf）
export function keyFromDom(str) {
	const it = byDom.get(str)
	return it ? keyOf(it) : str
}

// ---- 共享状态 ----
export const store = {
	roots: [],        // 组织树（森林）
	persons: [],      // 人物（扁平）
	personPersons: [],    // 关系
	focusOrganizationId: null, // 当前聚焦的组织 key（null = 全局视图）；临时节点为 Symbol
	meta: {displayName: null, bgColor: null}, // 元信息：显示名（默认库名）/ 背景色（默认 null）
}

// 视图重绘回调（由 render.js 注册）
let notify = () => {
}

export function setNotify(fn) {
	notify = fn
}

// ---- 临时 key -> Promise<真实id> 映射表 ----
const pendingIds = new Map()

// 真实 id 回赋时的迁移钩子（view.js 注册：把 vs 收拢集合里的 Symbol key 换成真实 id）
const adoptMigrators = []
export function onIdAdopted(fn) {
	adoptMigrators.push(fn)
}

// 新建组织后的呈现钩子（view.js 注册：画布上可见则定位，不可见则切换聚焦）
let organizationCreatedHook = null
export function onOrganizationCreated(fn) {
	organizationCreatedHook = fn
}

// 元信息变更钩子（view.js 注册：标题「连客 · 显示名」+ --bg 背景色即时生效）
let metaChangedHook = null
export function setMetaChangedHook(fn) {
	metaChangedHook = fn
}

// 人物担任类操作后的呈现钩子（view.js 注册：右侧边栏定位到该人物，与新建人物一致）
let personTouchedHook = null
export function onPersonTouched(fn) {
	personTouchedHook = fn
}

// touchPerson：钩子入参是人物的 dom 字符串（已解析）
function touchPerson(p) {
	if (p && personTouchedHook) personTouchedHook(domKey(p))
}

// 本次会话最新新建的人物 dom（纯前端高亮用，不进库）：渲染时给对应卡片/色块挂高亮类，
// 鼠标移入即清空。id 回赋引起的重绘会重建 DOM，此状态让高亮得以延续——不可省。
export const newPerson = {dom: null}

// ---- 作准语言（库级配置；loadAll 从 meta.authoritativeLang 写入；远端 meta 广播 / 语言弹窗 PUT 成功后更新）----
let authLang = `zh-Hans-CN`
export const getAuthLang = () => authLang

// 切换作准语言：回退链随作准槽变化，全量重解析所有实体 .name 并轻量重绘（与界面语言切换同一呈现路径）；
// 末尾触发跟随钩子（view.js 注册：「跟随作准语言」模式下界面语言随之切换）
export function setAuthLang(lang) {
	if (!lang || lang === authLang) return
	authLang = lang
	reresolveAll()
	notify(false)
	if (authLangHook) authLangHook()
}

let authLangHook = null
export function setAuthLangHook(fn) {
	authLangHook = fn
}

// 远端 meta 广播落到作准/启用语言时触发（settings.js 注册：语言弹窗开着则原地重刷勾选态）
let langMetaHook = null
export function setLangMetaHook(fn) {
	langMetaHook = fn
}

// ---- 启用语言（库级配置；meta.enabledLangs；缺省回退 [作准语言]。名称表单可录入的语言集合，必含作准语言）----
let enabledLangs = null // null = 未加载（随 loadAll 写入）
export const getEnabledLangs = () => enabledLangs || [authLang]

// 本地更新（loadAll / 远端 meta 广播 / 乐观更新共用）：过滤非法码、保序去重，作准语言恒归一到首位
// 回退链依赖启用集：数据就绪后（store.persons 非空）全量重解析显示名——切启用后实际显示值可能变化；
// loadAll 首次调用时 store 尚空，解析由随后的 mergeL10n 统一完成，此处只更新列表
export function setEnabledLangsLocal(list) {
	const auth = getAuthLang()
	const set = [...new Set((list || []).filter(c => availableLocales().some(x => x.code === c)))]
	const i = set.indexOf(auth)
	if (i > 0) {
		set.splice(i, 1)
		set.unshift(auth)
	} else if (i < 0) set.unshift(auth)
	enabledLangs = set
	if (store.persons.length) {
		reresolveAll()
		notify(false) // 轻量重绘：回退链结果已变，同 setAuthLang 先例
	}
}

// 启用语言切换（语言弹窗）：PUT meta 落库并广播；成功本地生效，失败抛错（调用方 toast 错误码）
export async function putEnabledLangs(list) {
	const r = await api(`api/meta`, {
		method: `PUT`,
		headers: {[`Content-Type`]: `application/json`},
		body: JSON.stringify({key: `enabled_langs`, value: list}),
	})
	setEnabledLangsLocal(r && r.data ? String(r.data.value).split(`,`) : list)
}

// 元信息设置：本地立即生效（display_name 按语言槽解析），后台落库并广播同库客户端
// patch = {value} | {l10n}；bg_color 只有 value/description（写 meta.value，空 = 删行）
// display_name 是纯本地化键：value 写当前语言槽，l10n 逐槽；空值 = 清空对应槽（回退库名），不影响其他语言
export function setMetaOp(key, patch) {
	const lang = getLocale()
	if (key === `display_name`) {
		const L = store.meta.displayNameL10n || (store.meta.displayNameL10n = {})
		const map = patch.l10n || (patch.value !== undefined ? {[lang]: patch.value} : null)
		if (map) {
			for (const [k, v] of Object.entries(map)) {
				if (v) L[k] = v
				else delete L[k]
			}
		}
		store.meta.displayName = L[lang] || null
	} else if (key === `bg_color`) {
		const v = patch.description !== undefined ? patch.description : patch.value
		store.meta.bgColor = v || null
	} else return
	if (metaChangedHook) metaChangedHook()
	bgSync(api(`api/meta`, {
		method: `PUT`,
		headers: {[`Content-Type`]: `application/json`},
		body: JSON.stringify({key, ...patch}),
	}))
}

// 作准语言切换（语言弹窗）：PUT meta 落库并广播同库客户端；成功后本地 setAuthLang，
// 失败抛错（err.code = 错误码，调用方 toast error.* 词条）
export async function putAuthoritativeLang(lang) {
	await api(`api/meta`, {
		method: `PUT`,
		headers: {[`Content-Type`]: `application/json`},
		body: JSON.stringify({key: `authoritative_lang`, value: lang}),
	})
	setAuthLang(lang)
}

// 创建回包后把真实 id 赋回临时对象（对象身份从 tempKey 切换为 id）；
// tempKey 保留在对象上：旧引用（模态框 targets、byDom 表、resolveKey）依旧能匹配。
// 身份内担任条目同步回赋：否则 chip 的 data-person-id 永远是 tmp-N（占位近黑色不恢复）
// 随后轻量重绘：人物颜色等按 id 派生的显示从占位值切换到真实值
function adoptId(item, rid) {
	if (!item || item.id) return
	const tmpDom = item.tempKey && domKey(item) // id 回赋前的临时 dom
	item.id = rid
	if (tmpDom && newPerson.dom === tmpDom) newPerson.dom = String(rid) // 高亮跟随 id 迁移
	adoptMigrators.forEach(fn => fn(item.tempKey, rid))
	const walk = nodes => nodes.forEach(n => {
		;(n.identities || []).forEach(r => (r.persons || []).forEach(x => {
			if (x.tempKey === item.tempKey) x.id = rid
		}))
		walk(n.children || [])
	})
	walk(store.roots)
	notify(false)
}

function registerCreate(tempKey, promise, item = null) {
	const pk = Promise.resolve(promise).then(res => {
		const rid = res && res.data && res.data.id
		if (!rid) throw new Error(t(`log.createNoId`))
		adoptId(item, rid) // 真实 id 赋回临时标记
		return rid
	})
	pendingIds.set(tempKey, pk)
	pk.catch(async err => {
		console.warn(t(`log.createRollback`), err)
		await loadAll()
		notify(false)
	})
}

// Symbol → await 映射表里的 promise；普通 uuid → 原样返回
export function resolveKey(key) {
	if (typeof key !== `symbol`) return Promise.resolve(key)
	const p = pendingIds.get(key)
	if (!p) return Promise.reject(new Error(t(`log.tmpKeyUnmapped`)))
	return p
}

// ---- 通信 ----
// 请求统一带 X-Lang（当前界面语言：value 槽的写入目标，服务端缺省/非法回退默认语言）与 X-Client-Id（协作回环排除）

// l10n 附表行（列名 zh_Hans_CN/en_Latn_US/ja_Jpan_JP）→ locale 键槽表
const colToLocale = c => c.replace(/_/g, `-`)

function rowsToL10n(rows) {
	const m = {}
	for (const r of rows || []) {
		const slots = {}
		for (const c of L10N_COLS) if (r[c]) slots[colToLocale(c)] = r[c]
		if (Object.keys(slots).length) m[r.id] = slots
	}
	return m
}

// 关系槽表：行按 (id, type) 分向收拢为 {id: {forward: {locale: 值}, backward: {…}}}
function rowsToPpL10n(rows) {
	const m = {}
	for (const r of rows || []) {
		const slots = {}
		for (const c of L10N_COLS) if (r[c]) slots[colToLocale(c)] = r[c]
		if (!Object.keys(slots).length) continue
		if (!m[r.id]) m[r.id] = {}
		m[r.id][r.type] = slots
	}
	return m
}

// 本语回退表：界面槽为空时按序改试这些语言的槽（zh 三变体互备；en-Latn-US/en-Latn-GB 互备）；未列出的语言无回退，直落作准槽
const LANG_FALLBACK = {'zh-Hant-HK': [`zh-Hant-TW`, `zh-Hans-CN`], 'zh-Hant-TW': [`zh-Hant-HK`, `zh-Hans-CN`], 'zh-Hans-CN': [`zh-Hant-TW`, `zh-Hant-HK`], 'en-Latn-US': [`en-Latn-GB`], 'en-Latn-GB': [`en-Latn-US`]}

// 显示名解析：界面语言槽 → 本语回退列表（按序，仅取已启用语言的非空槽）→ 作准语言槽（后端保证非空）；空槽返回空串由调用方兜底
export function resolveNameFor(lang, l10n) {
	if (!l10n) return ``
	if (l10n[lang]) return l10n[lang]
	const enabled = new Set(getEnabledLangs())
	for (const fb of LANG_FALLBACK[lang] || []) {
		if (enabled.has(fb) && l10n[fb]) return l10n[fb]
	}
	return l10n[authLang] || ``
}

const currentName = entity => resolveNameFor(getLocale(), entity.l10n)

// 同名人物查找（新建校验）：比较依据始终为作准语言槽（去首尾空白后精确匹配）
export function personsByAuthName(name) {
	const target = (name || ``).trim()
	if (!target) return []
	const auth = getAuthLang()
	return store.persons.filter(p => ((p.l10n && p.l10n[auth]) || ``).trim() === target)
}

export function personByAuthName(name) {
	const l = personsByAuthName(name)
	return l.length ? l[0] : null
}

// 关系某方向的显示标签：当前语言槽 → 本语回退列表（仅启用语言）→ 作准语言槽（双向标签只存 l10n 附表槽，主表已无 forward/backward 列）
export function ppLabel(personPerson, dir) {
	return resolveNameFor(getLocale(), personPerson.l10n && personPerson.l10n[dir])
}

// 给实体挂上 l10n 槽并按当前语言解析 .name（loadAll / 远端新建共用）
function localizeEntity(entity, l10nMap) {
	entity.l10n = l10nMap || {}
	entity.name = currentName(entity)
	return entity
}

/** 把 l10n 槽合并进树 / 人物 / 关系，并解析全部显示名（loadAll 用） */
function mergeL10n(l10n) {
	const orgMap = rowsToL10n(l10n.organization)
	const identMap = rowsToL10n(l10n.identity)
	const personMap = rowsToL10n(l10n.person)
	const ppMap = rowsToPpL10n(l10n.personPerson)
	const walk = nodes => nodes.forEach(n => {
		localizeEntity(n, orgMap[n.id])
		;(n.identities || []).forEach(r => {
			localizeEntity(r, identMap[r.id])
			;(r.persons || []).forEach(p => localizeEntity(p, personMap[p.id]))
		})
		walk(n.children)
	})
	walk(store.roots)
	store.persons.forEach(p => localizeEntity(p, personMap[p.id]))
	store.personPersons.forEach(r => { r.l10n = ppMap[r.id] || {} })
	store.meta.displayNameL10n = rowsToL10n(l10n.meta)[`display_name`] || {}
}

// 人物担任条目（右侧边栏提示用）按当前语言重建：身份名 / 组织名从树里取已解析值
function rebuildPersonIdentities() {
	const identById = new Map(), orgOfIdent = new Map()
	const walk = nodes => nodes.forEach(n => {
		(n.identities || []).forEach(r => {
			identById.set(r.id, r)
			orgOfIdent.set(r.id, n.name)
		})
		walk(n.children)
	})
	walk(store.roots)
	store.persons.forEach(p => {
		p.identities = (p.identities || []).map(x => {
			const ident = identById.get(x.id || x.key)
			return {key: x.id || x.key, dom: x.id || x.key, name: ident ? ident.name : ``, organization: ident ? orgOfIdent.get(x.id || x.key) : ``}
		})
	})
}

// 关系端点展示名按当前语言解析（loadAll / 远端关系变更共用）
function resolvePpNames(r) {
	const personName = id => {
		const p = store.persons.find(x => x.id === id)
		return p ? p.name : ``
	}
	const identName = id => {
		const ref = findIdentityRef(id)
		return ref ? ref.identity.name : ``
	}
	const orgName = id => {
		const ref = findIdentityRef(id)
		return ref ? ref.node.name : ``
	}
	r.a.personName = personName(r.a.personId)
	r.a.identityName = identName(r.a.identityId)
	r.a.organizationName = orgName(r.a.identityId)
	r.b.personName = personName(r.b.personId)
	r.b.identityName = identName(r.b.identityId)
	r.b.organizationName = orgName(r.b.identityId)
}

// 关系归一化：端点补 key/dom + 解析展示名（loadAll 与远端 create/retarget 对齐）
function normalizePersonPerson(x) {
	const r = {
		...x,
		a: {...x.a, personKey: x.a.personId, identityKey: x.a.identityId, pDom: x.a.personId, rDom: x.a.identityId},
		b: {...x.b, personKey: x.b.personId, identityKey: x.b.identityId, pDom: x.b.personId, rDom: x.b.identityId},
	}
	resolvePpNames(r)
	return r
}

// 界面语言切换后纯内存重解析全部显示名（槽数据已在缓存，无需重拉）
export function reresolveAll() {
	mergeL10nMetaOnly()
	const walk = nodes => nodes.forEach(n => {
		n.name = currentName(n)
		;(n.identities || []).forEach(r => {
			r.name = currentName(r)
			;(r.persons || []).forEach(p => { p.name = currentName(p) })
		})
		walk(n.children)
	})
	walk(store.roots)
	store.persons.forEach(p => { p.name = currentName(p) })
	rebuildPersonIdentities()
	store.personPersons.forEach(resolvePpNames)
}

// 元信息显示名按当前语言重解析（reresolveAll / remoteMeta 共用）：空槽回退 null，applyMeta 兜底库名
function mergeL10nMetaOnly() {
	store.meta.displayName = (store.meta.displayNameL10n && store.meta.displayNameL10n[getLocale()]) || null
}

// 名称 patch 的本地镜像（与 server/db 统一规则对齐）：
// authoritative → 作准语言槽（必须非空）；value → 当前语言槽；l10n → 逐槽（空串删槽，作准槽除外——清作准槽后端拒绝）
function applyNamePatchLocal(entity, patch, lang) {
	if (!entity.l10n) entity.l10n = {}
	if (patch.authoritative !== undefined && patch.authoritative) entity.l10n[authLang] = patch.authoritative
	const map = patch.l10n ? patch.l10n : (patch.value !== undefined ? {[lang]: patch.value} : null)
	if (map) {
		for (const [k, v] of Object.entries(map)) {
			if (v) entity.l10n[k] = v
			else if (k !== authLang) delete entity.l10n[k]
		}
	}
	entity.name = currentName(entity)
}

// 新建入参的本地镜像（对齐服务端 createPayload）：authoritative = payload.authoritative ?? payload.value；
// l10n 合并显式槽 + [lang]: value + [authLang]: authoritative
export function localizeForCreate(payload, lang) {
	const authoritative = payload.authoritative !== undefined ? payload.authoritative : payload.value
	const l10n = Object.assign({}, payload.l10n)
	if (payload.value) l10n[lang] = payload.value
	if (authoritative) l10n[authLang] = authoritative
	return {l10n}
}

// 关系方向 patch 本地镜像：authoritative → 作准槽（必须非空）；value → 当前槽；l10n → 逐槽（空串删槽，作准槽除外）
function applyPpPatchLocal(pp, dir, dp, lang) {
	if (!pp.l10n) pp.l10n = {forward: {}, backward: {}}
	if (!pp.l10n[dir]) pp.l10n[dir] = {}
	if (dp.authoritative !== undefined && dp.authoritative) pp.l10n[dir][authLang] = dp.authoritative
	const map = dp.l10n ? dp.l10n : (dp.value !== undefined ? {[lang]: dp.value} : null)
	if (map) {
		for (const [k, v] of Object.entries(map)) {
			if (v) pp.l10n[dir][k] = v
			else if (k !== authLang) delete pp.l10n[dir][k]
		}
	}
}

export async function loadAll() {
	const [o, p, r, m, l] = await Promise.all([
		fetch(`api/organizations`), fetch(`api/persons`), fetch(`api/person-persons`), fetch(`api/meta`), fetch(`api/l10n`),
	])
	store.roots = (await o.json()).data || []
	store.persons = ((await p.json()).data || []).map(x => ({
		...x,
		identities: (x.identities || []).map(rr => ({key: rr.id, dom: rr.id, id: rr.id})),
	}))
	store.personPersons = ((await r.json()).data || []).map(x => ({
		...x,
		a: {...x.a, personKey: x.a.personId, identityKey: x.a.identityId, pDom: x.a.personId, rDom: x.a.identityId},
		b: {...x.b, personKey: x.b.personId, identityKey: x.b.identityId, pDom: x.b.personId, rDom: x.b.identityId},
	}))
	const meta = await m.json().catch(() => null)
	const metaData = meta && meta.data ? meta.data : {displayName: null, bgColor: null, authoritativeLang: null}
	if (metaData.authoritativeLang) authLang = metaData.authoritativeLang // 作准语言入库：重解析的回退基准
	setEnabledLangsLocal(metaData.enabledLangs || null) // 启用语言缺省回退 [作准语言]
	const l10nData = (await l.json().catch(() => null))
	// display_name 是纯本地化键（meta 本表不存）：显示名 = 当前语言槽，空槽回退库名（applyMeta 兜底）
	store.meta = {
		displayNameL10n: {},
		bgColor: metaData.bgColor,
		displayName: null, // mergeL10n 后按当前语言解析
	}
	mergeL10n(l10nData && l10nData.data ? l10nData.data : {})
	rebuildPersonIdentities()
	store.personPersons.forEach(resolvePpNames)
	mergeL10nMetaOnly()
	pendingIds.clear() // 重建后临时 key 全部失效
}

// ---- 协作同步：本页面实例的唯一 id（REST 头 + WS 参数双通道携带，跳过自己发起的广播回环） ----
export const myClientId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === `function`)
	? globalThis.crypto.randomUUID()
	: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// 后端错误响应统一为 {error: code}；把代码翻译成当前语言的文本（l10n error.* 词条），代码挂 err.code 供诊断
async function apiError(res) {
	let code = `http_${res.status}`
	try {
		const body = await res.json()
		if (body && typeof body.error === `string`) code = body.error
	} catch (e) {
	}
	const err = new Error(t(`error.${code}`))
	err.code = code
	return err
}

async function api(url, options) {
	const opts = options || {}
	const headers = Object.assign({}, opts.headers, {[`X-Lang`]: getLocale(), [`X-Client-Id`]: myClientId})
	const res = await fetch(url, Object.assign({}, opts, {headers}))
	if (!res.ok) throw await apiError(res)
	return res.json().catch(() => null)
}

const JSON_POST = (body) => ({
	method: `POST`,
	headers: {[`Content-Type`]: `application/json`},
	body: JSON.stringify(body)
})

// 后台同步：失败时从后端拉取最新数据回滚视图
function bgSync(promise) {
	Promise.resolve(promise).catch(async err => {
		console.warn(t(`log.bgRollback`), err)
		await loadAll()
		notify(false)
	})
}

// ---- 树查询 ----
export const keyEq = (n, key) => n.id === key || n.tempKey === key

export function findNode(key) {
	if (key == null) return null
	const walk = nodes => {
		for (const n of nodes) {
			if (keyEq(n, key)) return n
			const f = walk(n.children)
			if (f) return f
		}
		return null
	}
	return walk(store.roots)
}

// 找到 key 的父节点（根级返回 null，找不到返回 undefined）
export function findParent(key) {
	if (key == null) return undefined
	const walk = (nodes, parent) => {
		for (const n of nodes) {
			if (keyEq(n, key)) return parent
			const f = walk(n.children, n)
			if (f !== undefined) return f
		}
		return undefined
	}
	return walk(store.roots, null)
}

export function parentOf(key) {
	return findParent(key)
}

// 同级列表副本（仅供计算下标；要原地增删请用 realListOf）
export function siblingsOf(key, excludeKey) {
	const p = parentOf(key)
	const list = p ? p.children : store.roots
	return excludeKey != null ? list.filter(n => !keyEq(n, excludeKey)) : [...list]
}

// key 所在的【真实】同级列表（可原地增删）
export function realListOf(key) {
	const p = parentOf(key)
	return p ? p.children : store.roots
}

export function indexIn(list, key) {
	return list.findIndex(n => keyEq(n, key))
}

// 把组织节点插入 parentKey 子列表的 index 处（parentKey 为 null 插到一级；本地缺父级时返回 false）
function insertOrganizationNode(node, parentKey, index) {
	const parent = parentKey ? findNode(parentKey) : null
	if (parentKey && !parent) return false
	const list = parent ? parent.children : store.roots
	const at = index == null ? list.length : Math.max(0, Math.min(index, list.length))
	list.splice(at, 0, node)
	return true
}

export function findIdentityRef(identityKey) {
	if (identityKey == null) return null
	let found = null
	const scan = nodes => {
		nodes.forEach(n => {
			(n.identities || []).forEach(rl => {
				if (keyEq(rl, identityKey)) found = {node: n, identity: rl}
			})
			scan(n.children)
		})
	}
	scan(store.roots)
	return found
}

export function currentRoots() {
	if (store.focusOrganizationId == null) return store.roots
	const n = findNode(store.focusOrganizationId)
	return n ? [n] : store.roots
}

// ============================================================
// 乐观更新操作：本地缓存先改并 notify 立即重绘；
// 后台先 resolveKey（临时 key 等其 promise 兑现）再发请求
// ============================================================
// payload = {value}（单输入）| {authoritative, value?} | {authoritative, l10n}（高级模式）
export function createOrganizationOp(payload, parentKey, index = null) {
	const {l10n} = localizeForCreate(payload, getLocale())
	const node = {
		id: null, tempKey: Symbol(`organization`),
		l10n, name: resolveNameFor(getLocale(), l10n),
		parent_id: parentKey || null, identities: [], children: [],
	}
	if (!insertOrganizationNode(node, parentKey, index)) return null
	notify(false) // 轻量重绘：新建组织不打断用户当前的缩放/平移
	if (organizationCreatedHook) organizationCreatedHook(keyOf(node)) // 统一呈现：可见则定位，不可见则切换聚焦
	const pidReady = parentKey ? resolveKey(parentKey) : Promise.resolve(null)
	registerCreate(node.tempKey, pidReady.then(pid => api(`api/organizations`, JSON_POST({...payload, parentId: pid, index}))), node)
	return node
}

// 把组织节点移到 parentKey 子列表的 index 处（本地乐观更新与远端变更共用；目标缺失时返回 false）
function moveOrganizationLocal(key, parentKey, index) {
	const node = findNode(key)
	if (!node) return false
	const parent = parentKey ? findNode(parentKey) : null
	if (parentKey && !parent) return false
	const target = parent ? parent.children : store.roots
	const oldList = realListOf(key)
	oldList.splice(indexIn(oldList, key), 1)
	const at = index == null ? target.length : Math.max(0, Math.min(index, target.length))
	target.splice(at, 0, node)
	node.parent_id = parentKey || null
	return true
}

export function moveOrganizationOp(key, parentKey, index) {
	if (!moveOrganizationLocal(key, parentKey, index)) return
	notify(false)
	bgSync(
		Promise.all([resolveKey(key), parentKey ? resolveKey(parentKey) : Promise.resolve(null)])
			.then(([id, pid]) => api(`api/organizations/move`, JSON_POST({id, parentId: pid, index})))
	)
}

export function createIdentityOp(organizationKey, payload) {
	const node = findNode(organizationKey)
	if (!node) return
	const {l10n} = localizeForCreate(payload, getLocale())
	const identity = {
		id: null, tempKey: Symbol(`identity`),
		l10n, name: resolveNameFor(getLocale(), l10n),
		persons: [],
	}
	node.identities.push(identity)
	notify(false)
	registerCreate(identity.tempKey, resolveKey(organizationKey).then(oid => api(`api/identities`, JSON_POST({...payload, organizationId: oid}))), identity)
}

// 身份排序移动到 index 处（共用；目标缺失时返回 false）
function moveIdentityLocal(identityKey, index) {
	const ref = findIdentityRef(identityKey)
	if (!ref) return false
	const list = ref.node.identities
	list.splice(indexIn(list, identityKey), 1)
	list.splice(Math.max(0, Math.min(index, list.length)), 0, ref.identity)
	return true
}

// 身份移动到另一组织的身份列表 index 处（跨组织拖拽共用；目标缺失时返回 false）
function moveIdentityToOrganizationLocal(identityKey, organizationKey, index) {
	const ref = findIdentityRef(identityKey)
	const target = organizationKey ? findNode(organizationKey) : null
	if (!ref || !target) return false
	const from = ref.node.identities
	from.splice(indexIn(from, identityKey), 1)
	target.identities.splice(Math.max(0, Math.min(index, target.identities.length)), 0, ref.identity)
	return true
}

export function moveIdentityOp(identityKey, index) {
	if (!moveIdentityLocal(identityKey, index)) return
	notify(false)
	bgSync(resolveKey(identityKey).then(id => api(`api/identities/move`, JSON_POST({id, index}))))
}

// 跨组织移动身份：只改身份的归属组织，人物担任与关系引用 identity_id 不变、自动随迁
export function moveIdentityToOrganizationOp(identityKey, organizationKey, index = null) {
	if (!moveIdentityToOrganizationLocal(identityKey, organizationKey, index)) return
	notify(false)
	bgSync(
		Promise.all([resolveKey(identityKey), resolveKey(organizationKey)])
			.then(([id, oid]) => api(`api/identities/move-organization`, JSON_POST({identityId: id, organizationId: oid, index})))
	)
}

// 删除组织（本地缓存）：cascade=true 级联清理整个子树；false 时仅清理本组织的身份，
// 子组织提升到上级并原位占据被删组织的位置（保持各自相对顺序）。返回 null 表示目标不存在
function deleteOrganizationLocal(key, cascade) {
	const node = findNode(key)
	if (!node) return null
	const identityKeys = new Set()
	if (cascade) {
		const collect = n => {
			(n.identities || []).forEach(r => identityKeys.add(keyOf(r)))
			n.children.forEach(collect)
		}
		collect(node)
	} else {
		(node.identities || []).forEach(r => identityKeys.add(keyOf(r)))
	}
	const list = realListOf(key)
	const at = indexIn(list, key)
	if (cascade) {
		list.splice(at, 1)
	} else {
		// 提升：子组织挂到上级，整体插在本组织的原位
		node.children.forEach(c => {
			c.parent_id = node.parent_id
		})
		list.splice(at, 1, ...node.children)
	}
	store.personPersons = store.personPersons.filter(r => !identityKeys.has(r.a.identityKey) && !identityKeys.has(r.b.identityKey))
	store.persons.forEach(p => {
		p.identities = p.identities.filter(r => !identityKeys.has(r.key))
	})
	const focusGone = store.focusOrganizationId != null && !findNode(store.focusOrganizationId)
	if (focusGone) store.focusOrganizationId = null
	return {focusGone}
}

// cascade=true 递推删除全部后代；false 保留下级（提升到上级原位）
export function deleteOrganizationOp(key, cascade = true) {
	const r = deleteOrganizationLocal(key, cascade)
	if (!r) return
	notify(r.focusGone)
	const promote = cascade ? `` : `&promote=1`
	bgSync(resolveKey(key).then(id => api(`api/organizations?id=${encodeURIComponent(id)}${promote}`, {method: `DELETE`})))
}

// 删除身份（含级联清理本地缓存）：目标不存在时返回 false
function deleteIdentityLocal(identityKey) {
	const ref = findIdentityRef(identityKey)
	if (!ref) return false
	ref.node.identities.splice(indexIn(ref.node.identities, identityKey), 1)
	store.personPersons = store.personPersons.filter(r => r.a.identityKey !== identityKey && r.b.identityKey !== identityKey)
	store.persons.forEach(p => {
		p.identities = p.identities.filter(r => r.key !== identityKey)
	})
	return true
}

export function deleteIdentityOp(identityKey) {
	if (!deleteIdentityLocal(identityKey)) return
	notify(false)
	bgSync(resolveKey(identityKey).then(id => api(`api/identities?id=${encodeURIComponent(id)}`, {method: `DELETE`})))
}

// 删除人物（含级联清理本地缓存）：目标不存在时返回 false
function deletePersonLocal(personKey) {
	const p = store.persons.find(x => keyEq(x, personKey))
	if (!p) return false
	const pk = keyOf(p)
	store.persons = store.persons.filter(x => !keyEq(x, pk))
	const scan = nodes => {
		nodes.forEach(n => {
			(n.identities || []).forEach(rl => {
				rl.persons = rl.persons.filter(x => !keyEq(x, pk))
			})
			scan(n.children)
		})
	}
	scan(store.roots)
	store.personPersons = store.personPersons.filter(r => r.a.personKey !== pk && r.b.personKey !== pk)
	return true
}

export function deletePersonOp(personKey) {
	if (!deletePersonLocal(personKey)) return
	notify(false)
	bgSync(resolveKey(personKey).then(id => api(`api/persons?id=${encodeURIComponent(id)}`, {method: `DELETE`})))
}

// opts.identityKey 传入 = 「新建并指派」一步走（POST /api/persons 带可选 identityId，单接口）；
// 身份本身还是临时 key 时先等其建库拿到真实 id 再发请求；
// opts.highlight = false 时不挂 new-person 高亮（从身份处新建：画布 chip 已可见，右侧不再需要常亮）
export function createPersonOp(payload, {identityKey = null, index = null, highlight = true} = {}) {
	const {l10n} = localizeForCreate(payload, getLocale())
	const p = {
		id: null, tempKey: Symbol(`person`),
		l10n, name: resolveNameFor(getLocale(), l10n),
		identities: [],
	}
	store.persons.push(p)
	if (identityKey) assignLocal(keyOf(p), identityKey, index) // 本地乐观：直接挂进身份（assignLocal 幂等）
	if (highlight) newPerson.dom = domKey(p) // 高亮标记（纯前端，不进库）
	notify(false)
	const req = identityKey
		? resolveKey(identityKey).then(rid => api(`api/persons`, JSON_POST({...payload, identityId: rid, index})))
		: api(`api/persons`, JSON_POST(payload))
	registerCreate(p.tempKey, req, p)
	return p
}

// 建立 人物-身份 关联的本地缓存修改（共用；人物或身份缺失时返回 false）
function assignLocal(personKey, identityKey, index) {
	const p = store.persons.find(x => keyEq(x, personKey))
	const ref = findIdentityRef(identityKey)
	if (!p || !ref) return false
	const pk = keyOf(p), rk = keyOf(ref.identity)
	// 插入到指定位置（或末尾）；已担任则不动
	// l10n 与人物对象共享引用（与 loadAll 合并后的形态一致）：界面语言切换时 reresolveAll 才能重解析 chip 名字
	if (!ref.identity.persons.some(x => keyEq(x, pk))) {
		const at = index == null ? ref.identity.persons.length : Math.max(0, Math.min(index, ref.identity.persons.length))
		ref.identity.persons.splice(at, 0, {id: p.id, tempKey: p.tempKey, name: p.name, l10n: p.l10n})
	}
	if (!p.identities.some(r => r.key === rk)) p.identities.push({
		key: rk,
		id: ref.identity.id,
		tempKey: ref.identity.tempKey,
		name: ref.identity.name,
		organization: ref.node.name,
		dom: domKey(ref.identity)
	})
	return true
}

export function assignOp(personKey, identityKey, index = null) {
	if (!assignLocal(personKey, identityKey, index)) return
	notify(false)
	touchPerson(store.persons.find(x => keyEq(x, personKey)))
	bgSync(
		Promise.all([resolveKey(personKey), resolveKey(identityKey)])
			.then(([pid, rid]) => api(`api/assignments`, JSON_POST({personId: pid, identityId: rid, index})))
	)
}

// 断开 人物-身份 关联的本地缓存修改（共用；身份缺失时返回 false）
function unassignLocal(personKey, identityKey) {
	const p = store.persons.find(x => keyEq(x, personKey))
	const ref = findIdentityRef(identityKey)
	if (!ref) return false
	const pk = p ? keyOf(p) : personKey // 人物可能已被回滚替换，容错直接用传入 key
	const rk = keyOf(ref.identity)
	ref.identity.persons = ref.identity.persons.filter(x => !keyEq(x, pk))
	if (p) p.identities = p.identities.filter(r => r.key !== rk)
	return true
}

export function unassignOp(personKey, identityKey) {
	const p = store.persons.find(x => keyEq(x, personKey))
	if (!unassignLocal(personKey, identityKey)) return
	const pk = p ? keyOf(p) : personKey // 人物可能已被回滚替换，容错直接用传入 key
	notify(false)
	touchPerson(p)
	bgSync(
		Promise.all([resolveKey(pk), resolveKey(identityKey)])
			.then(([pid, rid]) => api(`api/assignments?personId=${encodeURIComponent(pid)}&identityId=${encodeURIComponent(rid)}`, {method: `DELETE`}))
	)
}

// 担任排序的本地缓存修改：仅限同一身份内（共用；缺失时返回 false）
function moveAssignmentLocal(personKey, identityKey, index) {
	const ref = findIdentityRef(identityKey)
	if (!ref) return false
	const pk = personKey
	const list = ref.identity.persons
	const i = list.findIndex(x => keyEq(x, pk))
	if (i < 0) return false
	const [item] = list.splice(i, 1)
	list.splice(Math.max(0, Math.min(index, list.length)), 0, item)
	return true
}

// 担任排序：仅限同一身份内
export function moveAssignmentOp(personKey, identityKey, index) {
	if (!moveAssignmentLocal(personKey, identityKey, index)) return
	notify(false)
	touchPerson(store.persons.find(x => keyEq(x, personKey)))
	bgSync(
		Promise.all([resolveKey(personKey), resolveKey(identityKey)])
			.then(([pid, rid]) => api(`api/assignments/move`, JSON_POST({personId: pid, identityId: rid, index})))
	)
}

// 关系端点重定位到新的身份（本地乐观更新与远端 retarget 广播共用）
function retargetPersonPersonEnd(personKey, fromIdentityKey, ref) {
	const toKey = keyOf(ref.identity)
	store.personPersons.forEach(r => {
		[`a`, `b`].forEach(side => {
			const ep = r[side]
			if (ep.personKey !== personKey && ep.personId !== personKey) return
			if (ep.identityKey !== fromIdentityKey && ep.identityId !== fromIdentityKey) return
			ep.identityId = toKey
			ep.identityKey = toKey
			ep.rDom = domKey(ref.identity)
			ep.identityName = ref.identity.name
			ep.organizationName = ref.node.name
		})
	})
}

// 平移担任到同组织另一身份（拖拽人物）：关系端点随迁到新身份，线跟着人走
export function moveAssignmentToIdentityOp(personKey, fromIdentityKey, toIdentityKey, index = null) {
	const p = store.persons.find(x => keyEq(x, personKey))
	const fromRef = findIdentityRef(fromIdentityKey)
	const toRef = findIdentityRef(toIdentityKey)
	if (!p || !fromRef || !toRef) return false
	if (!assignLocal(personKey, toIdentityKey, index)) return false
	retargetPersonPersonEnd(keyOf(p), keyOf(fromRef.identity), toRef)
	unassignLocal(personKey, fromIdentityKey)
	notify(false)
	touchPerson(p)
	bgSync(
		Promise.all([resolveKey(keyOf(p)), resolveKey(keyOf(fromRef.identity)), resolveKey(keyOf(toRef.identity))])
			.then(([pid, fid, tid]) => api(`api/assignments/move-identity`, JSON_POST({personId: pid, fromIdentityId: fid, toIdentityId: tid, index})))
	)
	return true
}

// A/B 为 chipPos 条目：{ personKey, identityKey, pDom, rDom, personName, identityName, organizationName }
// payload = {forward: {authoritative, value?, l10n?}, backward: {...}}（两方向作准槽必填，服务端校验）
export function createPersonPersonOp(A, B, payload) {
	const lang = getLocale()
	const l10n = {forward: {}, backward: {}}
	for (const dir of [`forward`, `backward`]) {
		const dp = payload[dir] || {}
		const m = Object.assign({}, dp.l10n)
		if (dp.value) m[lang] = dp.value
		if (dp.authoritative) m[authLang] = dp.authoritative
		l10n[dir] = m
	}
	const personPerson = {
		id: null, tempKey: Symbol(`personPerson`),
		l10n,
		a: {
			personKey: A.personKey,
			identityKey: A.identityKey,
			pDom: A.pDom,
			rDom: A.rDom,
			personName: A.personName,
			identityName: A.identityName,
			organizationName: A.organizationName
		},
		b: {
			personKey: B.personKey,
			identityKey: B.identityKey,
			pDom: B.pDom,
			rDom: B.rDom,
			personName: B.personName,
			identityName: B.identityName,
			organizationName: B.organizationName
		},
	}
	store.personPersons.push(personPerson)
	notify(false)
	registerCreate(personPerson.tempKey,
		Promise.all([resolveKey(A.personKey), resolveKey(A.identityKey), resolveKey(B.personKey), resolveKey(B.identityKey)])
			.then(([ap, ar, bp, br]) => api(`api/person-persons`, JSON_POST({
				aPersonId: ap, aIdentityId: ar, bPersonId: bp, bIdentityId: br,
				forward: payload.forward, backward: payload.backward,
			}))), personPerson
	)
}

// 删除关系的本地缓存修改（共用；目标不存在时返回 false）
function deletePersonPersonLocal(personPersonKey) {
	const personPerson = store.personPersons.find(r => keyOf(r) === personPersonKey)
	if (!personPerson) return false
	store.personPersons = store.personPersons.filter(r => keyOf(r) !== personPersonKey)
	return true
}

export function deletePersonPersonOp(personPersonKey) {
	if (!deletePersonPersonLocal(personPersonKey)) return
	notify(false)
	bgSync(resolveKey(personPersonKey).then(id => api(`api/person-persons?id=${encodeURIComponent(id)}`, {method: `DELETE`})))
}

// patch = {forward?: {authoritative?, value?, l10n?}, backward?: {...}}（本地乐观更新与远端 update 广播共用）
function applyPersonPersonPatch(personPersonKey, patch, lang) {
	const personPerson = store.personPersons.find(r => keyOf(r) === personPersonKey)
	if (!personPerson) return false
	for (const dir of [`forward`, `backward`]) {
		const dp = patch[dir]
		if (dp) applyPpPatchLocal(personPerson, dir, dp, lang)
	}
	return true
}

export function updatePersonPersonOp(personPersonKey, patch) {
	if (!applyPersonPersonPatch(personPersonKey, patch, getLocale())) return
	notify(false)
	bgSync(resolveKey(personPersonKey).then(id => api(`api/person-persons/update`, JSON_POST({id, ...patch}))))
}

// 重命名的本地缓存修改（共用；目标不存在时返回 false）：patch 应用后 .name 为当前语言解析值，传播到关联展示位
function renameOrganizationLocal(key, patch) {
	const node = findNode(key)
	if (!node) return false
	applyNamePatchLocal(node, patch, patch.lang || getLocale())
	const name = node.name
	const identityKeys = new Set((node.identities || []).map(r => keyOf(r)))
	store.persons.forEach(p => p.identities.forEach(r => {
		if (identityKeys.has(r.key)) r.organization = name
	}))
	store.personPersons.forEach(r => {
		if (identityKeys.has(r.a.identityKey)) r.a.organizationName = name
		if (identityKeys.has(r.b.identityKey)) r.b.organizationName = name
	})
	return true
}

// patch = {value}（只写当前语言槽）| {authoritative, value?} | {authoritative, l10n}（高级模式；作准槽必须非空）
export function renameOrganizationOp(key, patch) {
	if (!renameOrganizationLocal(key, patch)) return
	notify(false)
	bgSync(resolveKey(key).then(id => api(`api/organizations/rename`, JSON_POST({id, ...patch}))))
}

function renameIdentityLocal(identityKey, patch) {
	const ref = findIdentityRef(identityKey)
	if (!ref) return false
	applyNamePatchLocal(ref.identity, patch, patch.lang || getLocale())
	const name = ref.identity.name
	store.persons.forEach(p => p.identities.forEach(r => {
		if (r.key === identityKey) r.name = name
	}))
	store.personPersons.forEach(r => {
		if (r.a.identityKey === identityKey) r.a.identityName = name
		if (r.b.identityKey === identityKey) r.b.identityName = name
	})
	return true
}

export function renameIdentityOp(identityKey, patch) {
	if (!renameIdentityLocal(identityKey, patch)) return
	notify(false)
	bgSync(resolveKey(identityKey).then(id => api(`api/identities/rename`, JSON_POST({id, ...patch}))))
}

function renamePersonLocal(personKey, patch) {
	const p = store.persons.find(x => keyEq(x, personKey))
	if (!p) return false
	const pk = keyOf(p)
	applyNamePatchLocal(p, patch, patch.lang || getLocale())
	const name = p.name
	const scan = nodes => {
		nodes.forEach(n => {
			(n.identities || []).forEach(rl => rl.persons.forEach(x => {
				if (keyEq(x, pk)) x.name = name
			}))
			scan(n.children)
		})
	}
	scan(store.roots)
	store.personPersons.forEach(r => {
		if (r.a.personKey === pk) r.a.personName = name
		if (r.b.personKey === pk) r.b.personName = name
	})
	return true
}

export function renamePersonOp(personKey, patch) {
	if (!renamePersonLocal(personKey, patch)) return
	notify(false)
	bgSync(resolveKey(personKey).then(id => api(`api/persons/rename`, JSON_POST({id, ...patch}))))
}

// 新建上级组织（任意节点通用）：新组织的父 = 本节点的父，插到本节点原位，本节点移入其下
// 若本节点是一级组织：新组织成为新的一级，且视图切换到新上级（历史行为保留）
export function insertParentOrganizationOp(n, payload) {
	const nk = keyOf(n)
	const parentKey = n.parent_id || null // 可能是 Symbol 临时 key 或 null（一级）
	const siblings = realListOf(nk)
	const idx = indexIn(siblings, nk)
	const {l10n} = localizeForCreate(payload, getLocale())
	const pnode = {
		id: null, tempKey: Symbol(`organization`),
		l10n, name: resolveNameFor(getLocale(), l10n),
		parent_id: parentKey, identities: [], children: [],
	}
	siblings.splice(idx, 0, pnode)       // 新上级插到本节点原位
	siblings.splice(indexIn(siblings, nk), 1) // 本节点移出
	pnode.children.push(n)
	n.parent_id = pnode.tempKey
	notify(false)
	if (organizationCreatedHook) organizationCreatedHook(keyOf(pnode)) // 统一呈现：可见则定位，不可见则切换聚焦
	registerCreate(pnode.tempKey,
		(parentKey ? resolveKey(parentKey) : Promise.resolve(null))
			.then(pid => api(`api/organizations`, JSON_POST({...payload, parentId: pid, index: idx}))), pnode)
	bgSync(
		Promise.all([resolveKey(nk), resolveKey(pnode.tempKey)])
			.then(([cid, pid]) => api(`api/organizations/move`, JSON_POST({id: cid, parentId: pid, index: 0})))
	)
}

// ============================================================
// 协作同步：应用服务器广播的远端变更（collab.js 收到 WebSocket 消息后调用）
// 约定：全部只做本地缓存修改 + 轻量重绘（render(false)），
// 不动缩放/聚焦/折叠/筛选等视图状态；返回 false = 本地缺前置数据（漏消息），
// 由 collab.js 全量重拉兜底
// ============================================================

function remoteCreateOrganization(msg) {
	if (findNode(msg.id)) return true // 幂等：已存在（自己发起的回环等）
	const l10n = msg.l10n || {}
	const node = {
		id: msg.id,
		l10n,
		name: resolveNameFor(getLocale(), l10n),
		parent_id: msg.parentId || null, identities: [], children: [],
	}
	if (!insertOrganizationNode(node, msg.parentId || null, msg.index)) return false
	notify(false)
	return true
}

function remoteMoveOrganization(msg) {
	if (!moveOrganizationLocal(msg.id, msg.parentId || null, msg.index)) return false
	notify(false)
	return true
}

function remoteDeleteOrganization(msg) {
	const r = deleteOrganizationLocal(msg.id, msg.mode !== `promote`)
	if (!r) return false
	notify(false)
	return true
}

function remoteRenameOrganization(msg) {
	if (!renameOrganizationLocal(msg.id, msg)) return false
	notify(false)
	return true
}

function remoteCreateIdentity(msg) {
	const node = findNode(msg.organizationId)
	if (!node) return false
	if ((node.identities || []).some(r => r.id === msg.id)) return true
	const l10n = msg.l10n || {}
	const identity = {
		id: msg.id,
		l10n,
		name: resolveNameFor(getLocale(), l10n),
		persons: [],
	}
	const list = node.identities
	const at = msg.index == null ? list.length : Math.max(0, Math.min(msg.index, list.length))
	list.splice(at, 0, identity)
	notify(false)
	return true
}

function remoteMoveIdentity(msg) {
	if (!moveIdentityLocal(msg.id, msg.index)) return false
	notify(false)
	return true
}

function remoteMoveIdentityToOrganization(msg) {
	if (!moveIdentityToOrganizationLocal(msg.id, msg.organizationId, msg.index)) return false
	notify(false)
	return true
}

function remoteDeleteIdentity(msg) {
	if (!deleteIdentityLocal(msg.id)) return false
	notify(false)
	return true
}

function remoteRenameIdentity(msg) {
	if (!renameIdentityLocal(msg.id, msg)) return false
	notify(false)
	return true
}

function remoteCreatePerson(msg) {
	if (store.persons.some(p => p.id === msg.id)) return true
	const l10n = msg.l10n || {}
	store.persons.push({
		id: msg.id,
		l10n,
		name: resolveNameFor(getLocale(), l10n),
		identities: [],
	})
	notify(false)
	return true
}

function remoteDeletePerson(msg) {
	if (!deletePersonLocal(msg.id)) return false
	notify(false)
	return true
}

function remoteRenamePerson(msg) {
	if (!renamePersonLocal(msg.id, msg)) return false
	notify(false)
	return true
}

function remoteAssign(msg) {
	if (!assignLocal(msg.personId, msg.identityId, msg.index)) return false
	notify(false)
	return true
}

function remoteUnassign(msg) {
	if (!unassignLocal(msg.personId, msg.identityId)) return false
	notify(false)
	return true
}

function remoteMoveAssignment(msg) {
	if (!moveAssignmentLocal(msg.personId, msg.identityId, msg.index)) return false
	notify(false)
	return true
}

function remoteCreatePersonPerson(msg) {
	const x = msg.data
	if (!x || !x.id) return false
	if (store.personPersons.some(r => r.id === x.id)) return true
	// 归一化：端点补 key/dom + 解析展示名（与 loadAll 对齐）
	store.personPersons.push(normalizePersonPerson(x))
	notify(false)
	return true
}

function remoteDeletePersonPerson(msg) {
	if (!deletePersonPersonLocal(msg.id)) return false
	notify(false)
	return true
}

function remoteUpdatePersonPerson(msg) {
	if (!applyPersonPersonPatch(msg.id, msg, msg.lang || getLocale())) return false
	notify(false)
	return true
}

// 平移担任导致的关系端点随迁：全量数据整替换（与 loadAll 归一化对齐）
function remoteRetargetPersonPerson(msg) {
	const x = msg.data
	if (!x || !x.id) return false
	const i = store.personPersons.findIndex(r => r.id === x.id)
	if (i < 0) return false
	store.personPersons[i] = normalizePersonPerson(x)
	notify(false)
	return true
}

/** 远端变更分发：按 op 落到本地缓存；返回 false 表示本地缺前置数据，应全量重拉 */
export function applyRemote(msg) {
	switch (msg.op) {
		case `organization:create`:
			return remoteCreateOrganization(msg)
		case `organization:move`:
			return remoteMoveOrganization(msg)
		case `organization:delete`:
			return remoteDeleteOrganization(msg)
		case `organization:rename`:
			return remoteRenameOrganization(msg)
		case `identity:create`:
			return remoteCreateIdentity(msg)
		case `identity:move`:
			return remoteMoveIdentity(msg)
		case `identity:move-organization`:
			return remoteMoveIdentityToOrganization(msg)
		case `identity:delete`:
			return remoteDeleteIdentity(msg)
		case `identity:rename`:
			return remoteRenameIdentity(msg)
		case `person:create`:
			return remoteCreatePerson(msg)
		case `person:delete`:
			return remoteDeletePerson(msg)
		case `person:rename`:
			return remoteRenamePerson(msg)
		case `assign`:
			return remoteAssign(msg)
		case `unassign`:
			return remoteUnassign(msg)
		case `assign:move`:
			return remoteMoveAssignment(msg)
		case `personPerson:create`:
			return remoteCreatePersonPerson(msg)
		case `personPerson:delete`:
			return remoteDeletePersonPerson(msg)
		case `personPerson:update`:
			return remoteUpdatePersonPerson(msg)
		case `personPerson:retarget`:
			return remoteRetargetPersonPerson(msg)
		case `meta`:
			return remoteMeta(msg)
		default:
			return true // 未知消息忽略
	}
}

// 远端元信息变更：落到本地缓存并应用（标题/背景/作准语言/启用语言）
// display_name 是纯本地化键：msg.l10n 逐槽合并（空串删槽），无 l10n 字段则不动；bg_color 用 msg.value；
// authoritative_lang：更新作准语言并全量重解析显示名（setAuthLang 内建重绘）；
// enabled_langs：msg.value 为逗号串，更新启用语言集（服务端保证含作准语言）
function remoteMeta(msg) {
	if (msg.key === `authoritative_lang`) {
		setAuthLang(msg.value)
		if (langMetaHook) langMetaHook() // 语言弹窗若开着，远端切换后勾选态即时跟随
		return true
	}
	if (msg.key === `enabled_langs`) {
		setEnabledLangsLocal(String(msg.value || ``).split(`,`))
		if (langMetaHook) langMetaHook()
		return true
	}
	if (msg.key === `display_name`) {
		if (msg.l10n) {
			const L = store.meta.displayNameL10n || (store.meta.displayNameL10n = {})
			for (const [k, v] of Object.entries(msg.l10n)) {
				if (v) L[k] = v
				else delete L[k]
			}
			store.meta.displayName = L[getLocale()] || null
		}
	} else if (msg.key === `bg_color`) {
		store.meta.bgColor = msg.value
	} else return true
	if (metaChangedHook) metaChangedHook()
	return true
}

/**
 * 破坏性变更（删除）波及的 key 集合：对象本身 + 级联对象
 * （组织删除 → 子孙组织/身份/相关关系；身份/人物删除 → 相关关系）。
 * 非破坏性变更返回 null。用于判断「客户端正在编辑的对象是否已被删除」。
 */
export function affectedKeys(msg) {
	let keys = null
	if (msg.op === `organization:delete`) {
		keys = new Set()
		const node = findNode(msg.id)
		if (node) {
			const collect = n => {
				keys.add(n.id)
				const identities = n.identities || []
				identities.forEach(r => keys.add(r.id))
				n.children.forEach(collect)
			}
			collect(node)
		} else {
			keys.add(msg.id)
		}
		store.personPersons.forEach(r => {
			if (keys.has(r.a.identityKey) || keys.has(r.b.identityKey)) keys.add(r.id)
		})
	} else if (msg.op === `identity:delete`) {
		keys = new Set([msg.id])
		store.personPersons.forEach(r => {
			if (r.a.identityKey === msg.id || r.b.identityKey === msg.id) keys.add(r.id)
		})
	} else if (msg.op === `person:delete`) {
		keys = new Set([msg.id])
		store.personPersons.forEach(r => {
			if (r.a.personKey === msg.id || r.b.personKey === msg.id) keys.add(r.id)
		})
	} else if (msg.op === `personPerson:delete`) {
		keys = new Set([msg.id])
	}
	return keys
}

/** 全量重拉对齐（重连/兜底）：重建数据后轻量重绘，不动视图状态 */
export async function resync() {
	try {
		await loadAll()
		notify(false)
	} catch (err) {
		console.warn(t(`log.resyncFailed`), err)
	}
}
