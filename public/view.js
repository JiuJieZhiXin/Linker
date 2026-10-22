// view.js — 视图层：把 html.js 产出的文本挂载到 DOM，持有视图状态，管理模态框与右键菜单
// 事件绑定全部在 events.js（全局代理），本文件只暴露状态与动作。
import {
	store, keyOf, domKey, loadAll, setNotify, currentRoots, findNode, findIdentityRef, parentOf,
	onIdAdopted, onOrganizationCreated, setMetaChangedHook, onPersonTouched, getAuthLang, setAuthLangHook,
} from './data.js'
import {
	buildCanvas, buildOrganizationPanel, buildSidebar,
} from './html.js'
import {applyStatic, getLocale, setLocale, t} from './i18n.js'

const svg = document.getElementById(`svg`)
const viewport = document.getElementById(`viewport`)
const wrap = document.getElementById(`canvas-wrap`)
const organizationTreeEl = document.getElementById(`organization-tree`)
const personListEl = document.getElementById(`person-list`)

// ---- 视图状态（events.js 可读写） ----
export const vs = {
	// 画布几何
	scale: 1, tx: 0, ty: 0,
	treeW: 0, treeH: 0,
	chipPos: new Map(),
	identityPos: new Map(),
	// 左侧收拢
	collapsedOrganizationIds: new Set(),
	// 画布连线交点收拢：隐藏该组织的全部下级组织
	collapsedCanvasIds: new Set(),
	// 画布内容收拢：组织只藏本格身份、身份只藏人物，实底小盒（不影响下级组织）
	foldedIds: new Set(),
	// 拖动中的源元素（从文档流隐藏）
	hiddenIdentityKey: null,
	hiddenOrganizationKey: null,
	hiddenChipKey: null,
	// 左侧拖拽中的组织 key
	draggedOrganizationKey: null,
}

// ---- 整体渲染 ----
export function render(refit) {
	const view = currentRoots()

	const c = buildCanvas(view, {
		hiddenOrganizationKey: vs.hiddenOrganizationKey,
		hiddenIdentityKey: vs.hiddenIdentityKey,
		hiddenChipKey: vs.hiddenChipKey,
		collapsedCanvasIds: vs.collapsedCanvasIds,
		foldedIds: vs.foldedIds,
	})
	viewport.innerHTML = c.markup
	vs.chipPos = c.chipPos
	vs.identityPos = c.identityPos
	vs.treeW = c.treeW
	vs.treeH = c.treeH

	document.getElementById(`row-global`).classList.toggle(`active`, store.focusOrganizationId == null)
	organizationTreeEl.innerHTML = buildOrganizationPanel(store.roots, store.focusOrganizationId, vs.collapsedOrganizationIds)
	renderSidebar()

	// innerHTML 只替换子节点，#viewport 上的 transform 还在；按需复位视图
	if (refit) fitView()
}

// ---- 右侧人物边栏（独立重刷：筛选输入时不必重建整个画布） ----
// 计数徽标统计当前视图（聚焦组织及以下）内的全部身份，与收拢/展开状态无关
// viewIdentityDoms：dom → 视图树序序号（上级到下级、从前到后），悬浮提示与定位循环共用此序
export function renderSidebar() {
	const view = currentRoots()
	const viewIdentityDoms = new Map()
	let order = 0
	const collect = nodes => {
		nodes.forEach(n => {
			(n.identities || []).forEach(r => viewIdentityDoms.set(domKey(r), order++))
			collect(n.children)
		})
	}
	collect(view)
	const filterEl = document.getElementById(`person-filter`)
	personListEl.innerHTML = buildSidebar(store.persons, viewIdentityDoms, filterEl ? filterEl.value : ``)
}

// ---- 右侧人物卡片定位：滚动到对应人物（被筛选隐藏时先清空筛选） ----
export function revealPerson(pDom) {
	const list = document.getElementById(`person-list`)
	const find = () => list.querySelector(`.person-card[data-person-id="${CSS.escape(pDom)}"]`)
	let card = find()
	if (!card) {
		// 人物被筛选条件隐藏：清空筛选重刷列表后再定位
		const filterEl = document.getElementById(`person-filter`)
		if (filterEl && filterEl.value) {
			filterEl.value = ``
			renderSidebar()
			card = find()
		}
	}
	if (card) card.scrollIntoView({block: `center`, behavior: `smooth`})
}

// ---- 平移缩放 ----
export function applyTransform() {
	viewport.setAttribute(`transform`, `translate(${vs.tx},${vs.ty}) scale(${vs.scale})`)
}

export function fitView() {
	const w = wrap.clientWidth, h = wrap.clientHeight
	vs.scale = Math.min(w / (vs.treeW + 120), h / (vs.treeH + 120), 1.5)
	vs.tx = (w - vs.treeW * vs.scale) / 2
	vs.ty = Math.max(40, (h - vs.treeH * vs.scale) / 2)
	applyTransform()
}

// 缩放（以光标为中心）；precise = 连续模式（触控板捏合、双击放大），按 deltaY 指数平滑
export function zoomAt(clientX, clientY, deltaY, precise = false) {
	const factor = precise ? Math.pow(1.0015, -deltaY) : (deltaY < 0 ? 1.1 : 1 / 1.1)
	const rect = svg.getBoundingClientRect()
	const mx = clientX - rect.left, my = clientY - rect.top
	const ns = Math.min(3, vs.scale * factor) // 不设下限：适应视图的比例可能远低于手动缩放范围，需能缩回去
	vs.tx = mx - (mx - vs.tx) * (ns / vs.scale)
	vs.ty = my - (my - vs.ty) * (ns / vs.scale)
	vs.scale = ns
	applyTransform()
}

// ---- 聚焦 ----
export function setFocus(key) {
	store.focusOrganizationId = key
	render(true)
}

export function toggleCollapse(key) {
	if (vs.collapsedOrganizationIds.has(key)) vs.collapsedOrganizationIds.delete(key)
	else vs.collapsedOrganizationIds.add(key)
	saveViewState()
	render(false)
}

// 画布连线交点收拢/展开：隐藏或恢复该组织的全部下级组织（按钮位置保持由点击处负责）
export function toggleCanvasCollapse(key) {
	if (vs.collapsedCanvasIds.has(key)) vs.collapsedCanvasIds.delete(key)
	else vs.collapsedCanvasIds.add(key)
	saveViewState()
	render(false)
}

// 画布内容收拢/展开：组织只藏本格内的身份、身份只藏人物（实底小盒，不影响下级组织）
export function toggleFold(key) {
	if (vs.foldedIds.has(key)) vs.foldedIds.delete(key)
	else vs.foldedIds.add(key)
	saveViewState()
	render(false)
}

// 全部展开：清除画布上所有收拢状态（组织/身份的内容收拢 + 下级组织的交点收拢）
export function expandAll() {
	vs.foldedIds.clear()
	vs.collapsedCanvasIds.clear()
	saveViewState()
	render(true)
}

// 展开挡路的收拢节点，使指定身份在画布上可见；
// 祖先链只解交点收拢（藏整棵下级）：祖先的内容收拢只藏本格身份、不影响下级里的目标，须保留用户的收拢；
// 直接挡目标的是宿主组织的内容收拢与身份本身的内容收拢（藏本格身份/人物）。返回是否有节点被展开
export function expandIdentityToShow(identity) {
	const ref = findIdentityRef(keyOf(identity))
	if (!ref) return false
	let changed = false
	let n = parentOf(keyOf(ref.node))
	while (n) {
		if (vs.collapsedCanvasIds.delete(keyOf(n))) changed = true
		n = parentOf(keyOf(n))
	}
	if (vs.foldedIds.delete(keyOf(ref.node))) changed = true
	if (vs.foldedIds.delete(keyOf(ref.identity))) changed = true
	if (changed) {
		saveViewState()
		render(false)
	}
	return changed
}

// ---- 收拢/展开状态持久化：按库（location.pathname）分键存 localStorage，重进后恢复 ----
// 临时 key（Symbol，未落库的新节点）不可序列化，保存时只写字符串 id
// uiLang：本库显式选择的界面语言（null = 「跟随作准语言」，进库时取当时的作准语言并在其变更时自动跟随）；
// i18n.js 启动时只读本字段（键格式与其 dbConfiguredUiLang 保持一致）
const VIEW_STATE_KEY = `linker:view:` + location.pathname
let dbUiLang = null

export const getDbUiLang = () => dbUiLang

// 语言弹窗切换界面语言：null（跟随作准语言）清掉本库配置；其余写入并即时生效
export function setDbUiLang(code) {
	dbUiLang = code || null
	saveViewState()
	setLocale(dbUiLang || getAuthLang())
}

function saveViewState() {
	try {
		const strOnly = set => [...set].filter(k => typeof k === `string`)
		localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
			collapsedOrganizationIds: strOnly(vs.collapsedOrganizationIds),
			collapsedCanvasIds: strOnly(vs.collapsedCanvasIds),
			foldedIds: strOnly(vs.foldedIds),
			uiLang: dbUiLang,
		}))
	} catch (err) {
		// 隐私模式等场景下 localStorage 不可用：静默跳过
	}
}

function loadViewState() {
	try {
		const raw = localStorage.getItem(VIEW_STATE_KEY)
		if (!raw) return
		const d = JSON.parse(raw)
		dbUiLang = d.uiLang || null
		const collapsedOrganization = d.collapsedOrganizationIds || []
		collapsedOrganization.forEach(k => vs.collapsedOrganizationIds.add(k))
		const collapsedCanvas = d.collapsedCanvasIds || []
		collapsedCanvas.forEach(k => vs.collapsedCanvasIds.add(k))
		const folded = d.foldedIds || []
		folded.forEach(k => vs.foldedIds.add(k))
	} catch (err) {
		// 数据损坏或存储不可用：忽略，保持默认全展开
	}
}

// 新建组织后的统一呈现：画布上可见（当前视图内）则平移定位过去（保持缩放）；不可见则切换聚焦到它
export function revealOrganization(key) {
	const scan = nodes => {
		for (const n of nodes) {
			if (keyOf(n) === key) return true
			if (scan(n.children)) return true
		}
		return false
	}
	const visible = scan(currentRoots())
	if (!visible) {
		setFocus(key)
		return
	}
	const n = findNode(key)
	if (n && n.x != null) {
		vs.tx = wrap.clientWidth / 2 - n.x * vs.scale
		vs.ty = wrap.clientHeight / 2 - n.y * vs.scale
		applyTransform()
	}
}

// ---- 初始化 ----
// 元信息应用：左上角标题走 app.titlePattern 词条（含品牌与分隔符，语序由词条决定——阿语等 RTL 模板名为前），
// 代码不判方向；背景色（默认全透明，画布区叠棋盘格透出）
const DEFAULT_BG = `rgba(255, 255, 255, 0)`
export function applyMeta() {
	const title = document.getElementById(`app-title`)
	if (title) {
		const seg = location.pathname.split(`/`).filter(Boolean)
		title.textContent = t(`app.titlePattern`, {name: store.meta.displayName || seg[0] || ``})
	}
	document.documentElement.style.setProperty(`--bg`, store.meta.bgColor || DEFAULT_BG)
}

export async function init() {
	setNotify(render)
	// 新建条目的真实 id 回赋后，把视图状态里的 Symbol key 迁移为真实 id（收拢状态不丢）
	onIdAdopted((tmp, rid) => {
		[vs.collapsedOrganizationIds, vs.collapsedCanvasIds, vs.foldedIds].forEach(s => {
			if (s.has(tmp)) {
				s.delete(tmp)
				s.add(rid)
			}
		})
		if (vs.hiddenOrganizationKey === tmp) vs.hiddenOrganizationKey = rid
		if (vs.hiddenIdentityKey === tmp) vs.hiddenIdentityKey = rid
	})
	// 新建组织的统一呈现：画布上可见则定位，不可见则切换聚焦
	onOrganizationCreated(key => revealOrganization(key))
	setMetaChangedHook(applyMeta) // 本地/远端元信息变更：标题与背景即时生效
	onPersonTouched(pDom => revealPerson(pDom)) // 人物担任类操作后：右侧边栏定位到该人物（同新建人物）
	// 跟随模式：作准语言切换（本地/远端）时界面语言自动跟随
	setAuthLangHook(() => {
		if (!dbUiLang && getAuthLang() !== getLocale()) setLocale(getAuthLang())
	})
	await loadAll()
	loadViewState() // 恢复上次的收拢/展开状态与本库界面语言选择（重进保持）
	// 界面语言裁定：显式选择过的（loadInitialLocale 已读本库配置）保持；「跟随作准语言」（空）则取当时的作准语言。
	// 之后才 applyStatic 摘除 i18n-boot 显隐锁——首帧语言即终态，不闪错误语言（原 events.js 模块级 applyStatic 为此移至此处）
	if (!dbUiLang && getAuthLang() !== getLocale()) setLocale(getAuthLang())
	applyStatic()
	applyMeta()
	render(true)
	window.addEventListener(`resize`, fitView)
}

export {svg, viewport, wrap}
