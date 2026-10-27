// controls.js — 统一控件管理：菜单（右键菜单 / 导出下拉与二级子菜单）与模态框
// 所有弹出控件（.pop 面板 / 模态框遮罩）的显隐统一走 .hidden 类或建删 DOM；
// 菜单项渲染（html.js menuHtml）、分发、互斥、外部点击收起只在此一处维护。
import {keyOf, domKey, store, setMetaOp, createOrganizationOp, createPersonOp, createPersonPersonOp, updatePersonPersonOp, getAuthLang, getEnabledLangs, putEnabledLangs, personByAuthName, resolveNameFor, resolveViaChain, fallbackChainLangs} from './data.js'
import {menuHtml, nameModalHtml, bgColorModalHtml, personPersonFormHtml, organizationDeleteConfirmHtml, languageModalHtml, enabledLangsModalHtml, personExistsConfirmHtml, personPickerHtml, esc} from './html.js'
import {render, revealPerson, getDbUiLang} from './view.js'
import {availableLocales, getLocale, t} from './i18n.js'
import {nameModalMode, entryMode, chooseEntryMode} from './settings.js'

// ============================================================
// 菜单引擎：一棵 items 树同时服务右键菜单（光标定位）与导出下拉（按钮锚定）
// item: {label, onClick?, danger?, header?, divider?, children?}
// ============================================================
const itemReg = new Map() // "menuId:路径" → item（点击/悬停分发用）

function registerItems(items, menuId, prefix = ``) {
	items.forEach((it, i) => {
		const mi = `${menuId}:${prefix}${i}`
		itemReg.set(mi, it)
		if (it.children) registerItems(it.children, menuId, `${prefix}${i}-`)
	})
}

function renderMenu(el, items, menuId) {
	registerItems(items, menuId)
	el.innerHTML = menuHtml(items, menuId)
}

function openSub(row) {
	const pop = row.querySelector(`:scope > .sub-pop`)
	row.closest(`.menu-root`).querySelectorAll(`.sub-pop`).forEach(x => x.classList.toggle(`hidden`, x !== pop))
}

function closeSubs(root = document) {
	root.querySelectorAll(`.sub-pop`).forEach(x => x.classList.add(`hidden`))
}

export function closeAllMenus() {
	closeCtxMenu()
	closeExportMenu()
}

// ---- 右键菜单（#ctx-menu，fixed 定位到光标） ----
const ctxMenu = document.getElementById(`ctx-menu`)

export function showCtxMenu(x, y, items) {
	renderMenu(ctxMenu, items, `ctx`)
	ctxMenu.classList.remove(`hidden`)
	// RTL 下同需防左侧出屏：双侧钳制
	ctxMenu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - 170))}px`
	ctxMenu.style.top = `${Math.min(y, window.innerHeight - items.length * 34 - 16)}px`
}

export function closeCtxMenu() {
	ctxMenu.classList.add(`hidden`)
	ctxMenu.innerHTML = ``
}

// ---- 导出下拉（#export-pop，锚定头部按钮，可带二级子菜单） ----
const exportPop = document.getElementById(`export-pop`)

export function toggleExportMenu() {
	exportPop.classList.toggle(`hidden`)
}

export function closeExportMenu() {
	exportPop.classList.add(`hidden`)
	closeSubs(exportPop)
}

export function renderExportMenu(items) {
	renderMenu(exportPop, items, `export`)
}

// 渲染导出菜单并绑定按钮开合（菜单项分发/互斥/收起走下方全局代理）
export function bindExportMenu(items) {
	renderExportMenu(items)
	document.getElementById(`btn-export`).addEventListener(`click`, toggleExportMenu)
}

// ---- 菜单全局代理：项分发、子菜单悬停互斥、外部按下收起（一处维护，全部菜单通用） ----
document.addEventListener(`click`, e => {
	const row = e.target.closest && e.target.closest(`[data-mi]`)
	if (!row) return
	const it = itemReg.get(row.dataset.mi)
	if (!it) return
	if (it.children) {
		openSub(row) // 触屏无悬停：点按父项展开子菜单
		return
	}
	closeAllMenus()
	if (it.onClick) it.onClick()
})

document.addEventListener(`mouseover`, e => {
	const t = e.target
	if (t.closest && t.closest(`.sub-pop`)) return // 子菜单内部：保持展开
	const row = t.closest && t.closest(`[data-mi]`)
	if (row) {
		const it = itemReg.get(row.dataset.mi)
		if (it && it.children) {
			openSub(row) // 悬停父项展开子菜单（兄弟项互斥）
			return
		}
	}
	closeSubs() // 普通项或菜单外：收起全部子菜单
})

document.addEventListener(`pointerdown`, e => {
	if (e.target.closest && e.target.closest(`.menu-root`)) return
	closeAllMenus() // 菜单外任意按下：收起全部菜单
})

// ============================================================
// 模态框栈：叠层语义——新弹窗压在旧弹窗之上（不替换），closeModal 只关最上层；
// 点遮罩 / Escape 逐层退栈；协作强制退出编辑用 closeAllModals 清空全栈
// ============================================================
const modalStack = [] // {mask, kind, payload}
const topModal = () => modalStack[modalStack.length - 1] || null

export function showModal(html, kind, payload) {
	const mask = document.createElement(`div`)
	mask.className = `modal-mask`
	mask.innerHTML = `<div class="modal modal-${kind}">${html}</div>`
	document.body.appendChild(mask)
	modalStack.push({mask, kind, payload})
	refreshEntryPlaceholders() // 建框后刷一次 placeholder（html.js 语言行渲染不带 placeholder，由这里统一填）
	const input = mask.querySelector(`input`)
	if (input) {
		input.focus()
		input.select()
	}
}

// ---- 弹窗 placeholder 统一刷新 ----
// 原则：placeholder = 假设本行为空时的显示值（own-slot-excluded——本行现值不参与回退链解析：改本行文本不影响本行 placeholder，清空后即时显现回退链解析值）
// 一次收集 DOM 当前槽值，对框内每个语言行以 {...slots, [code]: ''} 重算；名称弹窗（nm-*）与关系表单两方向（pp-f-*/pp-b-*）各自独立槽表，没有对应输入框时静默跳过
// 全框统一刷新而非只刷编辑行：链依赖任意方向都覆盖——改 zh-Hans 行的值，回退到它的 zh-Hant 行 placeholder 同步更新；作准行/作准组（字段名）与 nm-bare / pp-{dir}-bare（静态 placeholder）不动
// 标题弹窗无 nm-auth 行（作准语言行也是 nm-<code>）：行值全量进槽表（含作准码），placeholder 用链本体解析、链尽兜底库名——与页头 resolveTitleName 同一语义
export function refreshEntryPlaceholders() {
	const auth = getAuthLang()
	const nmRows = [...document.querySelectorAll(`input[id^="nm-"]`)]
	if (nmRows.length) {
		const codeOf = el => el.id.slice(3)
		const mask = nmRows[0].closest(`.modal-mask`)
		const entry = modalStack.find(m => m.mask === mask)
		if (entry && entry.payload && entry.payload.isTitle) {
			const libVal = entry.payload.libVal || ``
			const slots = {}
			nmRows.forEach(el => { if (el.id !== `nm-bare` && el.value) slots[codeOf(el)] = el.value })
			nmRows.forEach(el => {
				if (el.id === `nm-bare`) return // 单输入形态 placeholder 静态 = 库名（html.js 渲染），不动
				const code = codeOf(el)
				const v = resolveViaChain(code, {...slots, [code]: ``})
				el.placeholder = v !== undefined ? v : libVal
			})
		} else {
			const authEl = document.getElementById(`nm-auth`)
			const slots = {}
			if (authEl) slots[auth] = authEl.value
			nmRows.forEach(el => {
				if (el.id === `nm-auth` || el.id === `nm-bare`) return
				const code = codeOf(el)
				if (code !== auth && el.value) slots[code] = el.value
			})
			nmRows.forEach(el => {
				if (el.id === `nm-auth` || el.id === `nm-bare`) return
				el.placeholder = resolveNameFor(codeOf(el), {...slots, [codeOf(el)]: ``})
			})
		}
	}
	for (const dir of [`f`, `b`]) {
		const pre = `pp-${dir}-`
		const rows = [...document.querySelectorAll(`input[id^="${pre}"]`)]
		if (!rows.length) continue
		const authEl = document.getElementById(pre + `auth`)
		const slots = {}
		if (authEl) slots[auth] = authEl.value
		rows.forEach(el => {
			if (el.id === pre + `auth` || el.id === pre + `bare`) return
			if (el.value) slots[el.id.slice(pre.length)] = el.value
		})
		rows.forEach(el => {
			if (el.id === pre + `auth` || el.id === pre + `bare`) return
			const code = el.id.slice(pre.length)
			el.placeholder = resolveNameFor(code, {...slots, [code]: ``})
		})
	}
}

export function closeModal() {
	const top = modalStack.pop()
	if (!top) return
	top.mask.remove()
	// 取消「新建关系」时重建画布：清掉拉线期间的淡化打标
	if (top.kind === `person-person-create`) render(false)
}

export function closeAllModals() {
	while (modalStack.length) closeModal()
}

export function isModalOpen() {
	return modalStack.length > 0
}

// ---- 操作提示：校验失败等轻提示，底部居中浮出、自动消退（同一时间只显示一条） ----
let toastEl = null

export function showToast(text) {
	if (toastEl) toastEl.remove()
	toastEl = document.createElement(`div`)
	toastEl.className = `toast`
	toastEl.textContent = text
	document.body.appendChild(toastEl)
	setTimeout(() => {
		if (toastEl) {
			toastEl.remove()
			toastEl = null
		}
	}, 2300)
}

// 校验失败：输入框红框标记并聚焦（1.6s 后褪色）
function flagInvalid(el) {
	if (!el) return
	el.classList.add(`invalid`)
	el.focus()
	setTimeout(() => el.classList.remove(`invalid`), 1600)
}

// 当前编辑目标的 key 列表（协作同步用）：破坏性变更命中其中任一 key 时强制退出编辑模式
// 当前编辑目标的 key 列表（协作同步用）：破坏性变更命中其中任一 key 时强制退出编辑模式；叠层时取全栈并集
export function editTargetKeys() {
	const keys = []
	for (const {kind, payload: p} of modalStack) {
		if (kind === `name` || kind === `confirm`) keys.push(...(p.targets || []))
		else if (kind === `person-person-edit`) keys.push(keyOf(p.personPerson))
		else if (kind === `person-person-create`) {
			keys.push(...[p.A && p.A.personKey, p.A && p.A.identityKey, p.B && p.B.personKey, p.B && p.B.identityKey].filter(k => k != null))
		}
	}
	return keys
}

// 模态框确定（events.js 代理点击 data-act 后调用，只作用于栈顶）
// name 弹窗按形态组 patch：bare {value} / auth {authoritative} / L10N_MODES {authoritative, l10n}（作准槽必填，空则中止；l10n 收拢已渲染语言行，空串清槽）
// person-person 弹窗同理：bare {forward: {value}, backward: {value}} | auth {forward: {authoritative}, backward: {authoritative}} | 其余形态 {forward: {authoritative, l10n?}, backward: {...}}
const L10N_MODES = [`full`, `chain`, `dual`, `fill`]
export function submitModal() {
	const ms = topModal()
	if (!ms) return
	if (ms.kind === `name`) {
		const mode = ms.payload.mode || `bare`
		if (mode === `readonly`) { closeModal(); return } // 标题只读形态：无输入框，确定即关窗（无 patch）
		const fixedAuth = !!ms.payload.fixedAuth // 作准值固定（显示名 = 库名）：只读展示，提交不写库
		let patch = null
		const authEl = document.getElementById(`nm-auth`)
		if (mode === `bare`) {
			// bare：单输入 = 当前语言槽（创建场景服务端把 value 同时回填作准槽）；空值拒绝（allowEmpty 的显示名留空 = 清空当前槽回退库名）
			const input = document.getElementById(`nm-bare`)
			const v = input ? input.value.trim() : ``
			if (!v && !ms.payload.allowEmpty) {
				flagInvalid(input)
				showToast(t(`error.name_required`))
				return
			}
			patch = {value: v}
		} else if (mode === `auth`) {
			// auth：单输入 = 作准槽（界面语言∉启用集时 bare 的退化形态，带标签渲染于 html.js）；作准必填
			const v = authEl ? authEl.value.trim() : ``
			if (!v) {
				flagInvalid(authEl)
				showToast(t(`error.authoritative_required`))
				return
			}
			patch = {authoritative: v}
		} else if (L10N_MODES.includes(mode)) {
			const l10n = {}
			// 实体弹窗：作准槽由 authoritative 写入，不重复收拢；其余语言行逐槽（空串清槽；行集各形态见 data.js modalRowSet）
			// 标题弹窗：无作准语义，收拢全部已渲染语言行（full=[当前, 其他…]/chain=回退链语言 全带标签，el 守卫兜底缺失）
			for (const {code} of availableLocales()) {
				if (!ms.payload.isTitle && code === getAuthLang()) continue
				const el = document.getElementById(`nm-${code}`)
				if (el) l10n[code] = el.value.trim()
			}
			if (fixedAuth) {
				patch = {l10n}
			} else {
				const authVal = authEl.value.trim()
				if (!authVal) { // 作准槽必填（= 后端 authoritative_required 的前置校验）
					flagInvalid(authEl)
					showToast(t(`error.authoritative_required`))
					return
				}
				patch = {authoritative: authVal, l10n}
			}
		}
		const cb = ms.payload.onSubmit
		// onSubmit 返回 false = 已叠新弹层接管（如同名确认压在上方）：本弹窗保持打开，叠层取消后输入原样保留
		if (cb && cb(patch) === false) return
		closeModal()
	} else if (ms.kind === `person-person-create`) {
		const patch = collectPersonPersonPatch(ms.payload.mode || `bare`)
		if (!patch) return
		const {A, B} = ms.payload
		closeModal()
		createPersonPersonOp(A, B, patch)
	} else if (ms.kind === `person-person-edit`) {
		const patch = collectPersonPersonPatch(ms.payload.mode || `bare`)
		if (!patch) return
		const personPerson = ms.payload.personPerson
		closeModal()
		updatePersonPersonOp(keyOf(personPerson), patch)
	} else if (ms.kind === `bg-color`) {
		// 拾色器(hex) + 透明度滑杆(0-100) 组合为 rgba
		const hex = document.getElementById(`bg-color-input`).value
		const a = Math.round(Number(document.getElementById(`bg-alpha-input`).value)) / 100
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		const cb = ms.payload.onSubmit
		closeModal()
		cb(`rgba(${r}, ${g}, ${b}, ${a})`)
	}
}

// 关系表单按形态收拢（新建 / 编辑同构）：
// bare → 每方向 {value}（空值拒绝；创建场景服务端把 value 回填作准槽，编辑场景只写当前语言槽）
// auth → 每方向 {authoritative}（界面语言∉启用集时 bare 的退化形态；作准必填）
// dual/full → 每方向 {authoritative, l10n}（作准必填；l10n 逐槽收拢已渲染输入框，空串清槽——清作准槽由后端拒绝）
// 校验失败：必填输入为空 → 红框 + 轻提示（返回 null 由调用方中止提交）
function collectPersonPersonPatch(mode) {
	const collectDir = dir => {
		if (mode === `bare`) {
			// bare：单输入 = 当前界面语言槽，无作准输入（placeholder 静态 = 本方向作准值，无实时联动源）
			const el = document.getElementById(`pp-${dir}-bare`)
			const value = el ? el.value.trim() : ``
			if (!value) {
				flagInvalid(el)
				showToast(t(`error.authoritative_required`))
				return null
			}
			return {value}
		}
		if (mode === `auth`) {
			// auth：每方向仅作准输入（界面语言∉启用集时 bare 的退化形态，带标签渲染于 html.js）；作准必填
			const authEl = document.getElementById(`pp-${dir}-auth`)
			const authoritative = authEl ? authEl.value.trim() : ``
			if (!authoritative) {
				flagInvalid(authEl)
				showToast(t(`error.authoritative_required`))
				return null
			}
			return {authoritative}
		}
		const authEl = document.getElementById(`pp-${dir}-auth`)
		const authoritative = authEl ? authEl.value.trim() : ``
		if (!authoritative) {
			flagInvalid(authEl)
			showToast(t(`error.authoritative_required`))
			return null
		}
		const l10n = {}
		// 作准槽由 authoritative 写入，不重复收拢；dual/full 同规则：只收拢已渲染的语言输入框（el 守卫跳过缺失行），空串清槽
		for (const {code} of availableLocales()) {
			if (code === getAuthLang()) continue
			const el = document.getElementById(`pp-${dir}-${code}`)
			if (el) l10n[code] = el.value.trim()
		}
		return {authoritative, l10n}
	}
	const fwd = collectDir(`f`)
	const bwd = collectDir(`b`)
	if (!fwd || !bwd) return null
	return {forward: fwd, backward: bwd}
}

// 确认弹窗（组织删除 / 同名人物）的按钮经 submitConfirm 分发到 payload 上的 on{Choice} 回调
// 确认叠层提交时：先退叠层，回调里再自行 closeModal 退掉底下的一级弹窗（如需）
export function submitConfirm(choice) {
	const ms = topModal()
	if (!ms || ms.kind !== `confirm`) return
	const p = ms.payload
	closeModal()
	if (choice === `promote` && p.onPromote) p.onPromote()
	else if (choice === `cascade` && p.onCascade) p.onCascade()
	else if (choice === `reference` && p.onReference) p.onReference()
	else if (choice === `create` && p.onCreate) p.onCreate()
}

// 同名人物确认：withRef（身份处新建人物并指派）= 取消/引用/新建；否则（右侧新建人物）= 取消/确定
export function openPersonExistsConfirm({withRef, targets = [], onReference, onCreate}) {
	showModal(personExistsConfirmHtml(withRef), `confirm`, {onReference, onCreate, targets})
}

// 多同名引用的选人叠层（压在名称弹窗上）：点行选中退本层，onPick 再关底层弹窗执行指派
export function openPersonPicker(persons, onPick) {
	showModal(personPickerHtml(persons), `confirm`, {onPick, targets: persons.map(keyOf)})
}

export function submitPick(dom) {
	const ms = topModal()
	if (!ms || ms.kind !== `confirm`) return
	const p = ms.payload
	closeModal()
	if (p.onPick) p.onPick(dom)
}

// ---- 各类弹窗入口 ----
// 标题弹窗的模式解析与实体不同（无作准概念），按状态表定形（A=界面语言）：
//   A∈启用：选项1 = 单输入（A 槽，无标签）；选项2 = A + 全启用的回退链语言（链长>1 带标签多行，=1 退化为单输入无标签）；选项3 = 全部已启用语言带标签（A 第一、其余启用序）
//   A∉启用：选项1 = 只读本名（readonly，无输入框）；选项2 = 全启用的回退链语言（有标签；一个都没有则同选项1 只读本名）；选项3 = 全部已启用语言带标签（启用序，作准恒首位）
// 实体弹窗：传入的 dual（作准≠界面）或 auth（界面语言∉启用集）维持原语义
export function openNameModal(opts) {
	let mode = opts.mode || `bare`
	if (opts.isTitle) {
		// 标题弹窗换算（无作准概念，状态表见上）：链长 = A 的启用回退链语言数
		const chainLen = fallbackChainLangs(getLocale()).length
		if (!getEnabledLangs().includes(getLocale())) {
			if (mode === `full`) mode = `full`
			else if (mode === `dual` && chainLen) mode = `chain`
			else mode = `readonly`
		} else {
			if (mode === `full`) mode = `full`
			else if (mode === `dual` && chainLen > 1) mode = `chain`
			else mode = `bare`
		}
	}
	showModal(nameModalHtml({...opts, mode, title: mode === `readonly` ? t(`home.dbName`) : opts.title}), `name`, {
		onSubmit: opts.onSubmit,
		targets: opts.targets || [],
		allowEmpty: !!opts.allowEmpty,
		mode,
		fixedAuth: opts.fixedAuth != null,
		libVal: opts.fixedAuth == null ? null : String(opts.fixedAuth), // 标题弹窗的库名（placeholder 链尽兜底）
		isTitle: !!opts.isTitle,
	})
}

// 语言弹窗（🌐 统一语言设置）：界面语言（本库配置，可「跟随作准语言」）+ 作准语言（库级配置）
// + 启用语言（二级叠层勾选）+ 底部文本录入开关
export function openLanguageModal() {
	showModal(languageModalHtml(getDbUiLang(), getAuthLang(), getEnabledLangs(), entryMode()), `language`)
}

// 语言弹窗打开时原地重刷（界面语言 / 作准语言 / 文本录入模式 切换后即时反馈勾选态）
export function refreshLanguageModal() {
	const box = document.getElementById(`language-modal`)
	if (!box) return
	const modal = box.closest(`.modal`)
	if (modal) modal.innerHTML = languageModalHtml(getDbUiLang(), getAuthLang(), getEnabledLangs(), entryMode())
}

// 启用语言勾选层：叠在语言弹窗之上的二级卡片（语言弹窗保持打开）；确定整集保存后原地重刷一级弹窗
export function openEnabledLangsModal() {
	const top = topModal()
	if (!top) return
	closeEnabledLayer()
	top.mask.insertAdjacentHTML(`beforeend`,
		`<div class="modal-child-mask" id="enabled-layer"><div class="modal modal-child">${enabledLangsModalHtml(getAuthLang(), getEnabledLangs())}</div></div>`)
	const layer = document.getElementById(`enabled-layer`)
	// 点遮罩空白 = 取消（只移除本层，不动一级弹窗）
	layer.addEventListener(`click`, e => { if (e.target === layer) closeEnabledLayer() })
}

export function closeEnabledLayer() {
	const layer = document.getElementById(`enabled-layer`)
	if (layer) layer.remove()
}

// 远端作准/启用语言广播且叠层正开着：按最新状态重排重绘（新作准固定首行、旧作准降为可排序启用行、行序随广播顺序）
export function refreshEnabledLayer() {
	const layer = document.getElementById(`enabled-layer`)
	if (!layer) return
	const card = layer.querySelector(`.modal-child`)
	if (card) card.innerHTML = enabledLangsModalHtml(getAuthLang(), getEnabledLangs())
}

// 勾选层「确定」：收集勾选行（含作准语言固定行）整集 PUT；成功/失败都原地重刷一级弹窗（失败 toast 且服务端未落库）
export function submitEnabledLayer() {
	const langs = []
	const layer = document.getElementById(`enabled-layer`)
	if (layer) {
		layer.querySelectorAll(`.set-row`).forEach(row => {
			const chk = row.querySelector(`.menu-check`)
			if (row.dataset.lang && chk && chk.textContent.trim() === `✓`) langs.push(row.dataset.lang)
		})
	}
	closeEnabledLayer()
	putEnabledLangs(langs).then(() => {
		refreshLanguageModal()
	}).catch(err => {
		showToast(t(`error.${err.code || `internal_error`}`))
		refreshLanguageModal()
	})
}

export function openOrganizationDeleteConfirm(node, {onPromote, onCascade}) {
	showModal(organizationDeleteConfirmHtml(node.name), `confirm`, {
		onPromote,
		onCascade,
		targets: [keyOf(node)],
	})
}

export function openPersonPersonForm(A, B) {
	const mode = nameModalMode(true) // 新建的作准槽必为空 → 同填坑规则：作准≠界面强制 dual（作准值必须显式录入）
	showModal(personPersonFormHtml(A, B, {mode, title: t(`modal.newRelation`)}), `person-person-create`, {A, B, mode})
}

export function openPersonPersonEdit(personPerson) {
	// 与新建同款表单，预填各方向作准槽（加粗组）与全部语言槽；bare/单语言的当前语言输入预填当前槽
	// 填坑编辑强制 dual：作准≠界面 且 任一方向作准槽为空（切换作准语言后未回填），下次编辑必须补回作准值
	const ppL10n = personPerson.l10n || {}
	const fwdAuth = (ppL10n.forward && ppL10n.forward[getAuthLang()]) || ``
	const bwdAuth = (ppL10n.backward && ppL10n.backward[getAuthLang()]) || ``
	const mode = nameModalMode(!fwdAuth || !bwdAuth)
	showModal(personPersonFormHtml(personPerson.a, personPerson.b, {
		mode,
		title: t(`modal.editRelation`),
		forward: fwdAuth,
		backward: bwdAuth,
		values: ppL10n,
	}), `person-person-edit`, {personPerson, mode})
}

export function openNewRootOrganization() {
	openNameModal({
		title: t(`action.newRootOrganization`),
		placeholder: t(`placeholder.organizationName`),
		mode: nameModalMode(true),
		onSubmit: patch => createOrganizationOp(patch, null),
	})
}

// 背景色设置：已有配置解析回 色值+透明度 预填（未配置给默认 全透明白）
export function openBgColorModal() {
	let hex = `#ffffff`, alpha = 0
	const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(store.meta.bgColor || ``)
	if (m) {
		const h = n => Number(n).toString(16).padStart(2, `0`)
		hex = `#${h(m[1])}${h(m[2])}${h(m[3])}`
		alpha = Math.round(Number(m[4]) * 100)
	}
	showModal(bgColorModalHtml(hex, alpha), `bg-color`, {onSubmit: v => setMetaOp(`bg_color`, {description: v})})
}

export function openAddPerson() {
	// 新建后滚动定位到该人物卡片（data.js 已记高亮标记，渲染自动挂类）
	const doCreate = patch => {
		const p = createPersonOp(patch)
		if (p) revealPerson(domKey(p))
	}
	openNameModal({
		title: t(`action.newPerson`),
		placeholder: t(`placeholder.personName`),
		mode: nameModalMode(true),
		// 同名校验（依据始终为作准语言槽）：撞名时确认弹窗叠在本弹窗之上——取消只撤叠层、输入保留；确定才关弹窗新建
		onSubmit: patch => {
			const incoming = patch.authoritative !== undefined ? patch.authoritative : patch.value
			if (!personByAuthName(incoming)) { doCreate(patch); return }
			openPersonExistsConfirm({withRef: false, onCreate: () => { closeModal(); doCreate(patch) }})
			return false
		},
	})
}
