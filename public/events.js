// events.js — 事件层：所有事件绑定都在这里，用 document 级全局代理
// 视图结构靠 data-* 属性路由；渲染/状态在 view.js，数据在 data.js，文本生成在 html.js。
import {
	store, keyOf, keyEq, domKey, keyFromDom, itemByDom,
	findNode, findIdentityRef, parentOf, siblingsOf, indexIn, currentRoots,
	createOrganizationOp, moveOrganizationOp, createIdentityOp, moveIdentityOp, deleteOrganizationOp, deleteIdentityOp,
	deletePersonOp, assignOp, unassignOp, moveAssignmentOp, moveAssignmentToIdentityOp, moveIdentityToOrganizationOp, setMetaOp, newPerson,
	createPersonOp, personsByAuthName,
	renameOrganizationOp, renameIdentityOp, renamePersonOp, insertParentOrganizationOp, deletePersonPersonOp,
	reresolveAll, getAuthLang, putAuthoritativeLang,
} from './data.js'
import {
	vs, render, renderSidebar, applyTransform, zoomAt, fitView,
	setFocus, toggleCollapse, toggleCanvasCollapse, toggleFold, expandAll, expandIdentityToShow,
	init, svg, viewport, wrap, revealPerson, applyMeta, setDbUiLang,
} from './view.js'
import {
	showCtxMenu, closeCtxMenu, closeModal, isModalOpen, submitModal, submitConfirm,
	openNameModal, openBgColorModal, openPersonPersonForm, openPersonPersonEdit, openNewRootOrganization, openAddPerson, openOrganizationDeleteConfirm, openPersonExistsConfirm, openPersonPicker, submitPick,
	openLanguageModal, refreshLanguageModal, showToast, openEnabledLangsModal, closeEnabledLayer, submitEnabledLayer,
	closeAllMenus,
} from './controls.js'
import {
	NODE_W, GAP_X, GAP_Y, IDENTITY_GAP, PAD_T, SIDE_PAD, CHIP_H, CHIP_GAP, IDENTITY_TOP_ZONE,
} from './html.js'
import {initCollab} from './collab.js'
import {initExportMenu} from './export.js'
import {nameModalMode, chooseEntryMode} from './settings.js'
import {applyStatic, availableLocales, getLocale, isRtl, onLocaleChange, t} from './i18n.js'

const SVGNS = `http://www.w3.org/2000/svg`

// 事件处理器里局部变量 t 被 e.target 占用：翻译函数在模块内以别名 tr 引用
const tr = t

// 静态文案的首帧应用由 view.init 在语言裁定后负责（applyStatic 摘除 i18n-boot 显隐锁）；
// 此处仅注册语言切换后的全局刷新：数据多语言重解析（缓存纯内存重算显示名）+ 静态文案（头部/侧栏）、库标题、
// 面板收起钮悬浮提示、画布与列表重建；设置/导出两个下拉菜单的重建在各自模块里自注册（settings.js / export.js）
function refreshPanelToggleTitles() {
	const refresh = (panelId, btnId) => {
		const panel = document.getElementById(panelId)
		const btn = document.getElementById(btnId)
		if (panel && btn) btn.title = panel.classList.contains(`collapsed`) ? t(`panel.expand`) : t(`panel.collapse`)
	}
	refresh(`organization-panel`, `btn-collapse-left`)
	refresh(`sidebar`, `btn-collapse-right`)
}

onLocaleChange(() => {
	reresolveAll()
	applyStatic()
	applyMeta()
	refreshPanelToggleTitles()
	render(false)
})

// 重命名弹窗入参：按高级开关选形态（bare/dual/full）；作准槽为空（切换作准语言后的填坑编辑）时强制 dual
// 预填作准槽值（加粗行）与各语言槽（高级模式），value 预填当前语言槽（bare 形态 placeholder 规则见 html.js）
function nameEditOpts(entity, extra = {}) {
	const lang = getLocale()
	const l10n = entity.l10n || {}
	const authValue = l10n[getAuthLang()] || ``
	return {
		mode: nameModalMode(!authValue),
		authValue,
		values: l10n,
		value: l10n[lang] || ``,
		...extra,
	}
}

// 拖拽会话一旦激活，结束时随之触发的 click 要抑制（否则拖完排序/拉线会误触发点击动作）
let suppressClick = false

// ---- 触控手势状态 ----
const touchPointers = new Map() // pointerId -> {x, y, inSvg}（只记触屏指针）
let pinch = null                // 捏合锚点 {dist, scale, tx, ty, midX, midY}
let gestureEpoch = 0            // 手势纪元：新手势（双指落下/指针取消）使进行中的单指会话失效
let longPress = null            // 待触发的长按菜单 {x, y, target, timer}
let lastTouchInput = false      // 触屏输入时禁用悬浮聚焦（否则点按后的高亮会粘住）

function el(tag, attrs) {
	const e = document.createElementNS(SVGNS, tag)
	for (const k in attrs) e.setAttribute(k, attrs[k])
	return e
}

// 屏幕坐标 → 视口坐标
function toViewport(ev) {
	const rect = svg.getBoundingClientRect()
	return {x: (ev.clientX - rect.left - vs.tx) / vs.scale, y: (ev.clientY - rect.top - vs.ty) / vs.scale}
}

// ---- 拖放打标（.dimmed 淡化且拒绝交互 / .lit 高亮） ----
function dimAll(sel) {
	viewport.querySelectorAll(sel).forEach(x => x.classList.add(`dimmed`))
}

function litEl(x) {
	if (x) x.classList.add(`lit`)
}

// 拖动结束后不需要手动清理标记：onUp 必然触发 render 重建标记全消（dnd 除外，见 dragend）

// ============================================================
// 指针拖拽会话（指示线是临时 DOM，由本层直接增删）
// ============================================================

// 拖动组织标签：改层级 / 排序（拖动中的节点连同子树从文档流隐藏）
function startOrganizationDrag(e, node) {
	e.stopPropagation()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const startX = e.clientX, startY = e.clientY
	// 目标不能是自身或其后代（父组织不可能拖进子组织）
	const blocked = new Set([keyOf(node)])
	const collect = n => {
		n.children.forEach(c => {
			blocked.add(keyOf(c))
			collect(c)
		})
	}
	collect(node)

	let active = false
	let line = null
	let dropInfo = null // {type:'into', targetKey} | {type:'insert', parentKey, index}

	function clearIndicator() {
		viewport.querySelectorAll(`.node.drop-into`).forEach(elm => elm.classList.remove(`drop-into`))
		if (line) line.style.display = `none`
		dropInfo = null
	}

	// 命中模型：先按纵坐标选「行」（同层节点为一带，带域向上下各扩半个层间距；行间死区归入最近一行），
	// 行内再按横坐标——正落在节点盒上 = into（变下级）；否则插入线贴到横坐标最近节点的左/右侧，
	// 行首/行尾之外也照常插到两端。横方向不再有判定死角，只要位置符合视觉直觉就有插入线
	function hitDrop(p) {
		// 收集可见节点（被拖子树整体排除），按层分组为「行」
		const rows = new Map() // depth -> {top, bottom, nodes}
		const scan = nodes => {
			nodes.forEach(n => {
				if (blocked.has(keyOf(n))) return // 被拖子树整体排除（也不再深入）
				const top = n.y - n.h / 2, bottom = n.y + n.h / 2
				if (!rows.has(n.depth)) rows.set(n.depth, {top, bottom, nodes: []})
				const row = rows.get(n.depth)
				row.top = Math.min(row.top, top)
				row.bottom = Math.max(row.bottom, bottom)
				row.nodes.push(n)
				// 交点收拢的子树不参与命中（下级未重算坐标）
				if (!vs.collapsedCanvasIds.has(keyOf(n))) scan(n.children)
			})
		}
		scan(currentRoots())
		if (!rows.size) return null

		// 选定行：命中扩充值域（±半个层间距）取纵向最近；带域之间归入更近的一行
		const PAD = GAP_Y / 2
		let bestRow = null, bestDy = Infinity
		rows.forEach(row => {
			const dy = p.y < row.top - PAD ? row.top - PAD - p.y
				: p.y > row.bottom + PAD ? p.y - (row.bottom + PAD) : 0
			if (dy < bestDy) {
				bestDy = dy
				bestRow = row
			}
		})
		if (bestDy > GAP_Y) return null // 离任何行都太远：不响应

		// 行内取横坐标最近的节点：正落在其盒上 = into；否则按中心分左右插入其兄弟序列
		let best = null, bestDx = Infinity
		bestRow.nodes.forEach(n => {
			const d = Math.abs(p.x - n.x)
			if (d < bestDx) {
				bestDx = d
				best = n
			}
		})
		// 交点收拢（下级组织已隐藏）的组织不提供拖入：落进去会掉进看不见的子树，与身份收拢挡住人物拖入同理，只给前后插入线；
		// 内容收拢的组织仍可作为组织拖入目标（角色拖入由其身份隐藏天然阻止）
		const overBox = Math.abs(p.x - best.x) <= NODE_W / 2 && p.y >= best.y - best.h / 2 && p.y <= best.y + best.h / 2
		if (overBox && !vs.collapsedCanvasIds.has(keyOf(best))) {
			return {type: `into`, targetKey: keyOf(best), node: best}
		}
		const zone = p.x < best.x ? `before` : `after`
		const list = siblingsOf(keyOf(best), keyOf(node))
		const idx = indexIn(list, keyOf(best)) + (zone === `after` ? 1 : 0)
		let xLine
		if (idx === 0) xLine = list[0].x - NODE_W / 2 - GAP_X / 2
		else if (idx === list.length) xLine = list[list.length - 1].x + NODE_W / 2 + GAP_X / 2
		else xLine = (list[idx - 1].x + list[idx].x) / 2 // 两节点间隙中央
		const parent = parentOf(keyOf(best))
		return {
			type: `insert`,
			parentKey: parent ? keyOf(parent) : null,
			index: idx,
			xLine,
			y1: best.y - best.h / 2 - 6,
			y2: best.y + best.h / 2 + 6
		}
	}

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			vs.hiddenOrganizationKey = keyOf(node)       // 源节点连同子树从文档流隐藏，其余节点收拢
			svg.classList.add(`organization-dragging`)
			setHover(null)
			render(false)
			// 打标：身份、人物、关系淡化（组织常规，落入目标悬浮高亮）
			dimAll(`.identity`)
			dimAll(`.person-chip`)
			dimAll(`.person-person`)
			line = el(`line`, {class: `organization-drop-line`})
			viewport.appendChild(line)
		}
		if (!active) return
		const p = toViewport(ev)
		const hit = hitDrop(p)
		clearIndicator()
		if (!hit) return
		if (hit.type === `into`) {
			dropInfo = {type: `into`, targetKey: hit.targetKey}
			const g = viewport.querySelector(`[data-organization-id="${domKey(hit.node)}"]`)
			if (g) g.classList.add(`drop-into`)
		} else {
			dropInfo = {type: `insert`, parentKey: hit.parentKey, index: hit.index}
			line.style.display = ``
			line.setAttribute(`x1`, hit.xLine)
			line.setAttribute(`x2`, hit.xLine)
			line.setAttribute(`y1`, hit.y1)
			line.setAttribute(`y2`, hit.y2)
		}
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		svg.classList.remove(`organization-dragging`)
	}

	// 手势被接管（双指捏合/系统手势）：恢复被隐藏的源节点
	function onCancel() {
		cleanup()
		vs.hiddenOrganizationKey = null
		render(false)
	}

	function onUp() {
		cleanup()
		if (myEpoch !== gestureEpoch) {
			vs.hiddenOrganizationKey = null
			render(false)
			return
		}
		if (!active) return
		const info = dropInfo
		const draggedKey = keyOf(node)
		vs.hiddenOrganizationKey = null
		if (!info) {
			render(false)
			return
		} // 无落点：恢复显示
		if (info.type === `into`) {
			moveOrganizationOp(draggedKey, info.targetKey, null)
		} else {
			moveOrganizationOp(draggedKey, info.parentKey, info.index)
		}
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// 拖动身份标签排序（不能移出本组织；拖动中的身份从文档流隐藏）
function startIdentityDrag(e, identity, node) {
	e.stopPropagation()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const startX = e.clientX, startY = e.clientY
	const fromIndex = indexIn(node.identities, keyOf(identity))
	let active = false, line = null, gap = -1
	let targetOrg = node // 当前命中的目标组织（默认可视作源组织）

	// 命中指针位置所在的组织节点（跨组织可投放；父子盒重叠时取深层后代）
	const nodeAt = p => {
		let hit = null
		const scan = nodes => nodes.forEach(n => {
			if (Math.abs(p.x - n.x) <= NODE_W / 2 && p.y >= n.y - n.h / 2 - 12 && p.y <= n.y + n.h / 2 + 12) hit = n
			scan(n.children)
		})
		scan(currentRoots())
		return hit
	}

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			vs.hiddenIdentityKey = keyOf(identity)     // 源身份框从文档流隐藏，其余身份收拢
			svg.classList.add(`identity-dragging`)
			setHover(null)
			render(false)
			// 打标：跨组织可投放——组织/身份不整体淡化；人物、关系淡化（投放反馈靠绿色插入线）
			dimAll(`.person-person`)
			dimAll(`.person-chip`)
			line = el(`line`, {class: `identity-drop-line green`}) // 拖身份 → 绿色插入线
			viewport.appendChild(line)
		}
		if (!active) return
		const p = toViewport(ev)
		// 命中视图内任意组织节点，在其身份列表内按位置给出插入线（跨组织）
		targetOrg = nodeAt(p)
		if (!targetOrg) {
			line.style.display = `none`
			gap = -1
			return
		}
		const rest = (targetOrg.identities || []).filter(r => keyOf(r) !== vs.hiddenIdentityKey)
		gap = 0
		rest.forEach(rl => {
			const rc = vs.identityPos.get(domKey(rl))
			if (rc && p.y > rc.y + rc.h / 2) gap++
		})
		let yLine
		if (!rest.length) {
			// 节点内只剩被拖身份本身：指示线放在内容区顶部
			gap = 0
			yLine = targetOrg.y - targetOrg.h / 2 + PAD_T - IDENTITY_GAP / 2
		} else {
			const first = vs.identityPos.get(domKey(rest[0]))
			const last = vs.identityPos.get(domKey(rest[rest.length - 1]))
			if (gap === 0) yLine = first.y - IDENTITY_GAP / 2
			else if (gap >= rest.length) yLine = last.y + last.h + IDENTITY_GAP / 2
			else {
				const a = vs.identityPos.get(domKey(rest[gap - 1]))
				const b = vs.identityPos.get(domKey(rest[gap]))
				yLine = (a.y + a.h + b.y) / 2
			}
		}
		line.style.display = ``
		line.setAttribute(`x1`, targetOrg.x - NODE_W / 2 + SIDE_PAD)
		line.setAttribute(`x2`, targetOrg.x + NODE_W / 2 - SIDE_PAD)
		line.setAttribute(`y1`, yLine)
		line.setAttribute(`y2`, yLine)
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		svg.classList.remove(`identity-dragging`)
	}

	// 手势被接管（双指捏合/系统手势）：恢复被隐藏的源身份
	function onCancel() {
		cleanup()
		vs.hiddenIdentityKey = null
		render(false)
	}

	function onUp() {
		cleanup()
		if (myEpoch !== gestureEpoch) {
			vs.hiddenIdentityKey = null
			render(false)
			return
		}
		if (!active) return
		const targetGap = gap
		const identityKey = keyOf(identity)
		vs.hiddenIdentityKey = null
		if (targetGap < 0) {
			render(false)
			return
		} // 移出所有组织或未动：恢复
		if (keyOf(targetOrg) === keyOf(node)) {
			if (targetGap === fromIndex) {
				render(false)
				return
			}
			// gap 是在「排除自身后的列表」中的插入下标，与后端 moveIdentity 语义一致
			moveIdentityOp(identityKey, targetGap)
		} else {
			// 跨组织移动：只改身份归属，人物担任与关系随迁
			moveIdentityToOrganizationOp(identityKey, keyOf(targetOrg), targetGap)
		}
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// 拖动人物条目白底区（非上色区域）：在本身份内排序，也可平移到视图内其他身份（可跨组织）
// 打标与各拖放同一套：lit = 可投放（本身份 + 同组织未担任的身份）；dimmed = 拒绝
// （已担任的身份、其他组织）；投放位置由紫色插入线指示
function startChipDrag(e, p, identity, node) {
	e.stopPropagation()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const fromKey = `${domKey(p)}|${domKey(identity)}`
	const fromIndex = identity.persons.findIndex(x => keyOf(x) === keyOf(p))
	const startX = e.clientX, startY = e.clientY
	let active = false, line = null, gap = -1
	let targetIdentity = null // 平移模式的目标身份（null = 本身份内排序）

	// 可平移的身份：视图内全部身份（跨组织允许），排除本身份与已担任的身份
	// （p 是身份内条目，人物已担任的身份全集要从人物上取）
	const person = store.persons.find(x => keyEq(x, keyOf(p)))
	const myIdentityKeys = new Set(((person && person.identities) || []).map(r => r.key))
	const sibIdentities = []
	const collectIds = nodes => nodes.forEach(n => {
		(n.identities || []).forEach(r => {
			if (keyOf(r) !== keyOf(identity) && !myIdentityKeys.has(keyOf(r))) sibIdentities.push(r)
		})
		collectIds(n.children)
	})
	collectIds(currentRoots())

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			vs.hiddenChipKey = fromKey         // 源条目从文档流隐藏，其余条目收拢
			svg.classList.add(`chip-dragging`)
			setHover(null)
			render(false)
			// 打标：跨组织可投放——组织不整体淡化；身份按可投放性 lit/dimmed；dimmed 身份内的人物一并 dimmed
			dimAll(`.person-person`)
			const sibDoms = new Set(sibIdentities.map(domKey))
			const litIdentities = new Set()
			viewport.querySelectorAll(`.identity`).forEach(g => {
				const rd = g.dataset.identityId
				if (rd === domKey(identity) || sibDoms.has(rd)) {
					g.classList.add(`lit`)
					litIdentities.add(rd)
				} else {
					g.classList.add(`dimmed`)
				}
			})
			viewport.querySelectorAll(`.person-chip`).forEach(g => {
				if (!litIdentities.has(g.dataset.identityId)) g.classList.add(`dimmed`)
			})
			line = el(`line`, {class: `identity-drop-line purple`}) // 拖人物 → 紫色插入线
			viewport.appendChild(line)
		}
		if (!active) return
		const pt = toViewport(ev)

		// 平移模式：命中可平移身份（跨组织）→ 内部按位置显示插入线（与拖右侧卡片同一套）
		targetIdentity = null
		viewport.querySelectorAll(`.identity.drop-hover`).forEach(x => x.classList.remove(`drop-hover`))
		for (const r of sibIdentities) {
			const rc = vs.identityPos.get(domKey(r))
			if (!rc) continue
			const inside = pt.x >= rc.x - 4 && pt.x <= rc.x + rc.w + 4 && pt.y >= rc.y - 6 && pt.y <= rc.y + rc.h + 6
			if (!inside) continue
			targetIdentity = r
			gap = showIdentityInsert(r, pt.y)
			line.style.display = `none`
			const g = viewport.querySelector(`[data-identity-id="${domKey(r)}"]`)
			if (g) g.classList.add(`drop-hover`)
			return
		}
		hideIdentityInsert()

		// 排序模式：本身份框内（原有逻辑）
		const rc = vs.identityPos.get(domKey(identity))
		if (!rc) {
			line.style.display = `none`
			gap = -1
			return
		}
		// 只允许在本身份框内排序
		const inside = Math.abs(pt.x - (rc.x + rc.w / 2)) <= rc.w / 2 + 8 && pt.y >= rc.y - 8 && pt.y <= rc.y + rc.h + 8
		if (!inside) {
			line.style.display = `none`
			gap = -1
			return
		}
		const rest = (identity.persons || []).filter(x => (`${domKey(x)}|${domKey(identity)}`) !== vs.hiddenChipKey)
		gap = 0
		rest.forEach(x => {
			const cp = vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`)
			if (cp && pt.y > cp.y) gap++
		})
		let yLine
		if (!rest.length) {
			gap = 0
			yLine = rc.y + IDENTITY_TOP_ZONE - CHIP_GAP / 2
		} else {
			const topOf = x => vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`).y - CHIP_H / 2
			const bottomOf = x => vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`).y + CHIP_H / 2
			if (gap === 0) yLine = topOf(rest[0]) - CHIP_GAP / 2
			else if (gap >= rest.length) yLine = bottomOf(rest[rest.length - 1]) + CHIP_GAP / 2
			else yLine = (bottomOf(rest[gap - 1]) + topOf(rest[gap])) / 2
		}
		line.style.display = ``
		line.setAttribute(`x1`, rc.x + 4)
		line.setAttribute(`x2`, rc.x + rc.w - 4)
		line.setAttribute(`y1`, yLine)
		line.setAttribute(`y2`, yLine)
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		svg.classList.remove(`chip-dragging`)
	}

	// 手势被接管（双指捏合/系统手势）：恢复被隐藏的源条目
	function onCancel() {
		cleanup()
		vs.hiddenChipKey = null
		hideIdentityInsert()
		render(false)
	}

	function onUp() {
		cleanup()
		if (myEpoch !== gestureEpoch) {
			vs.hiddenChipKey = null
			hideIdentityInsert()
			render(false)
			return
		}
		if (!active) return
		const targetGap = gap
		const pk = keyOf(p)
		const identityKey = keyOf(identity)
		const toIdentity = targetIdentity
		vs.hiddenChipKey = null
		if (toIdentity) {
			// 平移到其他身份（可跨组织）：单一原子操作，关系端点随迁（线跟着人走）
			if (targetGap < 0) {
				render(false)
				return
			}
			moveAssignmentToIdentityOp(pk, identityKey, keyOf(toIdentity), targetGap)
			return
		}
		if (targetGap < 0 || targetGap === fromIndex) {
			render(false)
			return
		}
		moveAssignmentOp(pk, identityKey, targetGap)
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// 拖动左侧色块：拉出关系线（起点 = 色块中心）
function startPersonPersonDrag(e, pDom, rDom) {
	const fromKey = `${pDom}|${rDom}`
	const from = vs.chipPos.get(fromKey)
	if (!from) return
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const startX = e.clientX, startY = e.clientY
	let active = false
	let tempPath = null
	let lastTarget = null // 当前高亮的落点色块

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			tempPath = el(`path`, {class: `person-person-temp`})
			viewport.appendChild(tempPath)
			svg.classList.add(`person-person-dragging`)
			setHover(null)
			// 打标：组织、身份、关系全部淡化且拒绝交互；只有人物色块（落点）可响应
			dimAll(`.person-person`)
			dimAll(`.identity`)
			dimAll(`.node`)
		}
		if (active && tempPath) {
			const p = toViewport(ev)
			tempPath.setAttribute(`d`, `M ${from.bx} ${from.by} L ${p.x} ${p.y}`) // from = 色区中心
			// 只有移到其他人物色块上才高亮（落点提示）
			const chip = ev.target.closest && ev.target.closest(`.person-chip`)
			const key = chip ? `${chip.dataset.personId}|${chip.dataset.identityId}` : null
			const targetEl = key && key !== fromKey ? chip : null
			if (targetEl !== lastTarget) {
				if (lastTarget) lastTarget.classList.remove(`drop-target`)
				if (targetEl) targetEl.classList.add(`drop-target`)
				lastTarget = targetEl
			}
		}
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		svg.classList.remove(`person-person-dragging`)
		if (lastTarget) lastTarget.classList.remove(`drop-target`)
		if (tempPath) tempPath.remove()
	}

	// 手势被接管（双指捏合/系统手势）：重建画布清除淡化打标
	function onCancel() {
		cleanup()
		if (active) render(false)
	}

	function onUp(ev) {
		cleanup()
		if (myEpoch !== gestureEpoch) {
			if (active) render(false)
			return
		}
		if (!active) return
		const target = ev.target.closest && ev.target.closest(`.person-chip`)
		// 中途取消（没落在色块上 / 落回自身）：重建画布清除淡化打标
		if (!target) {
			render(false)
			return
		}
		const toKey = `${target.dataset.personId}|${target.dataset.identityId}`
		if (toKey === fromKey) {
			render(false)
			return
		}
		const A = vs.chipPos.get(fromKey), B = vs.chipPos.get(toKey)
		if (A && B) openPersonPersonForm(A, B)
		else render(false)
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// 画布平移
function startPan(e) {
	closeCtxMenu()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const sx = e.clientX - vs.tx, sy = e.clientY - vs.ty

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		suppressClick = true
		vs.tx = ev.clientX - sx
		vs.ty = ev.clientY - sy
		applyTransform()
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
	}

	function onUp() {
		cleanup()
	}

	function onCancel() {
		cleanup()
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// ============================================================
// 右键菜单（统一样式：头部显示来源，重命名最前，删除最后，分隔线隔开）
// ============================================================
// stdMenu({ source: '组织 · 集团总部', onRename, middle: [...], onEdit, onDelete })
function stdMenu({source, onRename, onEdit, middle = [], onDelete}) {
	const items = [{header: source}]
	if (onRename) items.push({label: t(`menu.rename`), onClick: onRename})
	if (onEdit) items.push({label: t(`menu.edit`), onClick: onEdit})
	if (middle.length) items.push({divider: true}, ...middle)
	if (onDelete) items.push({divider: true}, {label: t(`menu.delete`), danger: true, onClick: onDelete})
	return items
}

// 删除组织：有下级组织时询问——递推删除全部后代，或保留下级（提升到上级并占据本组织的位置）
function requestDeleteOrganization(nk) {
	const node = findNode(nk)
	if (!node) return
	if (!node.children.length) {
		deleteOrganizationOp(nk)
		return
	}
	openOrganizationDeleteConfirm(node, {
		onPromote: () => deleteOrganizationOp(nk, false),
		onCascade: () => deleteOrganizationOp(nk, true),
	})
}

function organizationMenuItems(node, onCanvas) {
	const nk = keyOf(node)
	const middle = []
	const createOpts = {mode: nameModalMode(true)} // 菜单里全是新建（作准槽必为空）：作准≠界面强制 dual
	if (onCanvas) {
		middle.push({
			label: t(`menu.newIdentity`),
			onClick: () => openNameModal({
				title: t(`modal.newIdentityTitle`, {name: node.name}),
				placeholder: t(`placeholder.identityName`),
				targets: [nk],
				...createOpts,
				onSubmit: patch => createIdentityOp(nk, patch),
			}),
		})
	}
	// 任意层级都可新建上级：新组织的父 = 本节点的父，本节点移入其下
	middle.push({
		label: t(`menu.newParentOrganization`),
		onClick: () => openNameModal({
			title: t(`modal.newParentOrganizationTitle`, {name: node.name}),
			placeholder: t(`placeholder.organizationName`),
			targets: [nk],
			...createOpts,
			onSubmit: patch => insertParentOrganizationOp(node, patch)
		}),
	})
	middle.push(
		{
			label: t(`menu.newSiblingOrganization`),
			onClick: () => openNameModal({
				title: t(`modal.newSiblingOrganizationTitle`, {name: node.name}), placeholder: t(`placeholder.organizationName`),
				targets: [nk],
				...createOpts,
				onSubmit: patch => createOrganizationOp(patch, node.parent_id || null, indexIn(siblingsOf(nk), nk) + 1),
			}),
		},
		{
			label: t(`menu.newChildOrganization`),
			onClick: () => openNameModal({
				title: t(`modal.newChildOrganizationTitle`, {name: node.name}),
				placeholder: t(`placeholder.organizationName`),
				targets: [nk],
				...createOpts,
				onSubmit: patch => createOrganizationOp(patch, nk)
			}),
		},
	)
	return stdMenu({
		source: t(`menu.organizationHeader`, {name: node.name}),
		onRename: () => openNameModal({
			title: t(`modal.renameOrganization`),
			placeholder: t(`placeholder.organizationName`),
			targets: [nk],
			original: node.name,
			...nameEditOpts(node),
			onSubmit: patch => renameOrganizationOp(nk, patch),
		}),
		middle,
		onDelete: () => requestDeleteOrganization(nk),
	})
}

// 身份处「新建人物并指派」提交：同名校验（依据始终为作准语言槽）
// 撞名时确认弹窗叠在名称弹窗之上（取消只撤叠层、输入保留）；引用 = 直接指派已有人物；新建 = 关弹窗建人物再指派（一步接口）
// 引用遇多个同名：再叠选人列表（第一行担任 + 计数消歧），点行选中后关名称弹窗指派
function submitNewPersonToIdentity(identity, patch) {
	const rk = keyOf(identity)
	const doCreate = () => {
		// highlight: false——从身份处新建画布 chip 已可见，右侧不再需要 new-person 常亮
		const p = createPersonOp(patch, {identityKey: rk, highlight: false})
		if (p) revealPerson(domKey(p))
	}
	const incoming = patch.authoritative !== undefined ? patch.authoritative : patch.value
	const dups = personsByAuthName(incoming)
	if (!dups.length) { doCreate(); return }
	openPersonExistsConfirm({
		withRef: true,
		targets: [rk, ...dups.map(keyOf)],
		onReference: () => {
			if (dups.length === 1) { closeModal(); assignOp(keyOf(dups[0]), rk); return }
			openPersonPicker(dups, dom => { closeModal(); assignOp(keyFromDom(dom), rk) })
		},
		onCreate: () => { closeModal(); doCreate() },
	})
	return false
}

function identityMenuItems(identity) {
	const rk = keyOf(identity)
	return stdMenu({
		source: t(`menu.identityHeader`, {name: identity.name}),
		middle: [{
			label: t(`menu.newPersonAssign`),
			onClick: () => openNameModal({
				title: t(`modal.newPersonTitle`, {name: identity.name}),
				placeholder: t(`placeholder.personName`),
				targets: [rk],
				mode: nameModalMode(true),
				onSubmit: patch => submitNewPersonToIdentity(identity, patch),
			}),
		}],
		onRename: () => openNameModal({
			title: t(`modal.renameIdentity`),
			placeholder: t(`placeholder.identityName`),
			targets: [rk],
			original: identity.name,
			...nameEditOpts(identity),
			onSubmit: patch => renameIdentityOp(rk, patch)
		}),
		onDelete: () => deleteIdentityOp(rk),
	})
}

function personMenuItems(p) {
	const pk = keyOf(p)
	return stdMenu({
		source: t(`menu.personHeader`, {name: p.name}),
		onRename: () => openNameModal({
			title: t(`modal.renamePerson`),
			placeholder: t(`placeholder.personName`),
			targets: [pk],
			original: p.name,
			...nameEditOpts(p),
			onSubmit: patch => renamePersonOp(pk, patch),
		}),
		onDelete: () => deletePersonOp(pk),
	})
}

function personPersonMenuItems(personPerson) {
	return stdMenu({
		source: t(`menu.personPersonHeader`),
		onEdit: () => openPersonPersonEdit(personPerson),
		onDelete: () => deletePersonPersonOp(keyOf(personPerson)),
	})
}

// 点击右侧人物卡片：平移视图把人物定位到画布中心；
// 目标序列 = 人物在当前视图内的全部担任（视图树序：上级到下级、从前到后），与收拢状态无关；
// 每次点击取下一个目标：不可见（被收拢）就先展开挡路节点到可见为止，而不是跳过
let locatePDom = null, locateIdx = 0

function personTargets(p) {
	const pk = keyOf(p)
	const targets = []
	const scan = nodes => {
		nodes.forEach(n => {
			(n.identities || []).forEach(r => {
				if ((r.persons || []).some(x => keyEq(x, pk))) targets.push(r)
			})
			scan(n.children)
		})
	}
	scan(currentRoots())
	return targets
}

function locatePerson(pDom) {
	const p = itemByDom(pDom)
	if (!p) return
	const targets = personTargets(p)
	if (!targets.length) return // 当前视图内无担任：维持跳过
	if (locatePDom !== pDom) {
		locatePDom = pDom
		locateIdx = 0
	}
	const target = targets[locateIdx % targets.length]
	locateIdx++
	if (!vs.chipPos.has(`${pDom}|${domKey(target)}`)) expandIdentityToShow(target) // 目标被收拢：展开到可见
	const pt = vs.chipPos.get(`${pDom}|${domKey(target)}`)
	if (!pt) return
	vs.scale = 1 // 点击卡片定位：缩放归一为标准尺寸（100%）再居中
	vs.tx = wrap.clientWidth / 2 - pt.x * vs.scale
	vs.ty = wrap.clientHeight / 2 - pt.y * vs.scale
	applyTransform()
}

// 导出功能在 export.js：JSON / PNG（全局 · 当前）/ SVG（全局 · 当前），静态按钮区做下拉分发

// 侧边栏收起/展开（收起后面板只剩窄条与展开按钮）
// 仅面板在文档流时（桌面 flex 布局）收起/展开才会改变画布宽度，需要重排视图；
// 移动端面板是浮层（position: absolute），画布尺寸不变——保持用户当前的缩放与平移
// RTL 镜像：面板换边，箭头方向随之互换（expandArrow/collapseArrow 按 LTR 语义传入）
function togglePanel(panelId, btnId, expandArrow, collapseArrow) {
	const panel = document.getElementById(panelId)
	const btn = document.getElementById(btnId)
	const w0 = wrap.clientWidth
	const collapsed = panel.classList.toggle(`collapsed`)
	const exp = isRtl() ? collapseArrow : expandArrow
	const col = isRtl() ? expandArrow : collapseArrow
	btn.textContent = collapsed ? col : exp
	btn.title = collapsed ? t(`panel.expand`) : t(`panel.collapse`)
	if (wrap.clientWidth !== w0) fitView() // 画布尺寸变了才重算视图
}

// ============================================================
// 触控手势：双指捏合缩放 / 长按菜单 / 全局指针跟踪
// ============================================================

// 画布上的触屏指针集合（inSvg = 落在画布内，参与捏合）
function canvasTouchPoints() {
	return [...touchPointers.values()].filter(p => p.inSvg)
}

// 双指落下即建立捏合锚点（中点 + 初始距离/缩放/平移），后续 move 按锚点缩放
function anchorPinch() {
	const pts = canvasTouchPoints()
	if (pts.length < 2) return
	const rect = svg.getBoundingClientRect()
	pinch = {
		dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
		scale: vs.scale,
		tx: vs.tx,
		ty: vs.ty,
		midX: (pts[0].x + pts[1].x) / 2 - rect.left,
		midY: (pts[0].y + pts[1].y) / 2 - rect.top,
	}
}

// 捏合中：以锚定中点缩放，并跟随当前中点平移
function updatePinch() {
	if (!pinch) return
	const pts = canvasTouchPoints()
	if (pts.length < 2) return
	const rect = svg.getBoundingClientRect()
	const mx = (pts[0].x + pts[1].x) / 2 - rect.left
	const my = (pts[0].y + pts[1].y) / 2 - rect.top
	const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
	const ns = Math.min(3, pinch.scale * (dist / pinch.dist)) // 与 zoomAt 一致：只封顶不保底
	const k = ns / pinch.scale
	vs.tx = pinch.midX - (pinch.midX - pinch.tx) * k + (mx - pinch.midX)
	vs.ty = pinch.midY - (pinch.midY - pinch.ty) * k + (my - pinch.midY)
	vs.scale = ns
	applyTransform()
}

// 全局指针跟踪：维护触屏指针集合、驱动捏合、取消长按
window.addEventListener(`pointermove`, ev => {
	const tp = touchPointers.get(ev.pointerId)
	if (!tp) return
	tp.x = ev.clientX
	tp.y = ev.clientY
	if (longPress && Math.hypot(ev.clientX - longPress.x, ev.clientY - longPress.y) > 5) cancelLongPress()
	updatePinch()
})

function onGlobalPointerEnd(ev) {
	const wasPinch = !!pinch
	touchPointers.delete(ev.pointerId)
	cancelLongPress()
	if (touchPointers.size < 2) pinch = null
	// 捏合剩单指：剩余手指接管为画布平移
	if (wasPinch && touchPointers.size === 1) {
		const p = [...touchPointers.values()][0]
		if (p.inSvg) startPan({clientX: p.x, clientY: p.y})
	}
}

window.addEventListener(`pointerup`, onGlobalPointerEnd)
window.addEventListener(`pointercancel`, onGlobalPointerEnd)

// 长按（500ms 未移动）触发与右键相同的菜单；触屏没有右键
function armLongPress(e, t) {
	cancelLongPress()
	longPress = {
		x: e.clientX,
		y: e.clientY,
		timer: setTimeout(() => {
			longPress = null
			if (openCtxMenuFor(t, e.clientX, e.clientY)) {
				suppressClick = true // 抬起时跟随的 click 不再触发点按动作
				if (navigator.vibrate) navigator.vibrate(8) // 触觉确认（支持的平台）
			}
		}, 500),
	}
}

function cancelLongPress() {
	if (!longPress) return
	clearTimeout(longPress.timer)
	longPress = null
}

// ============================================================
// 全局代理监听器
// ============================================================

// ---- 左键按下：拖拽会话 / 平移 ----
document.addEventListener(`pointerdown`, e => {
	suppressClick = false // 新一轮按下重新开始，标志只对本会话有效
	if (e.button !== 0) return
	const t = e.target

	// ---- 触控跟踪：第二指落下取消单指会话并建立捏合锚点；单指武装长按菜单 ----
	if (e.pointerType === `touch`) {
		lastTouchInput = true
		touchPointers.set(e.pointerId, {x: e.clientX, y: e.clientY, inSvg: !!(t.closest && t.closest(`#svg`))})
		if (touchPointers.size >= 2) {
			gestureEpoch++ // 多指手势：进行中的单指拖拽/平移会话即刻失效
			cancelLongPress()
			anchorPinch()
			suppressClick = true
			return // 多指不启动新的单指会话
		}
		armLongPress(e, t)
	} else {
		lastTouchInput = false
	}

	// 画布折叠钮（连线交点 / 名字左侧）只响应点击：不起拖拽/平移
	if (t.closest && (t.closest(`[data-fold]`) || t.closest(`[data-junction]`))) return

	// 模态框遮罩：点遮罩关闭
	const mask = t.closest && t.closest(`.modal-mask`)
	if (mask && t === mask) {
		closeModal()
		return
	}
	if (mask) return // 模态框内的按下不往下走

	// 左侧组织行拖拽把手（触屏专用：把手 touch-action:none，手势不被浏览器接管）
	const grip = t.closest && t.closest(`.row-grip`)
	if (grip) {
		const grow = grip.closest(`.organization-row[data-organization-id]`)
		const gnode = grow && findNode(keyFromDom(grow.dataset.organizationId))
		if (gnode) startRowDrag(e, gnode, grow)
		return
	}
	// 左侧组织行：指针拖拽改层级 / 排序（抓手光标 + 跟随幽灵）
	const organizationRow = t.closest && t.closest(`.organization-row[data-organization-id]`)
	if (organizationRow) {
		// 触屏：行体留给原生滚动与长按菜单，拖拽一律走行尾把手
		if (e.pointerType !== `touch`) {
			const node = findNode(keyFromDom(organizationRow.dataset.organizationId))
			if (node) startRowDrag(e, node, organizationRow)
		}
		return
	}
	// 右侧人物卡片圆点 = 拖放把手（触屏专用：圆点 touch-action:none，不与滚动竞争）
	const dot = t.closest && t.closest(`.person-card .dot`)
	if (dot) {
		const dcard = dot.closest(`.person-card`)
		const dp = dcard && itemByDom(dcard.dataset.personId)
		if (dp) startCardDrag(e, dp)
		return
	}
	// 右侧人物卡片：指针拖拽进身份框
	const card = t.closest && t.closest(`.person-card`)
	if (card) {
		// 触屏：卡片本体留给原生滚动与长按菜单，拖拽一律走左侧圆点把手
		if (e.pointerType !== `touch`) {
			const p = itemByDom(card.dataset.personId)
			if (p) startCardDrag(e, p)
		}
		return
	}

	// 左侧上色区域：拉出关系线（起点 = 色区中心）
	const fillZone = t.closest && t.closest(`.chip-fill`)
	if (fillZone) {
		const chip = fillZone.closest(`.person-chip`)
		startPersonPersonDrag(e, chip.dataset.personId, chip.dataset.identityId)
		return
	}
	// 白底区：本身份内排序，或平移到同组织的其他身份
	const chip = t.closest && t.closest(`.person-chip`)
	if (chip) {
		const ref = findIdentityRef(keyFromDom(chip.dataset.identityId))
		if (!ref) return
		const pk = keyFromDom(chip.dataset.personId)
		const entry = ref.identity.persons.find(x => keyOf(x) === pk)
		if (entry) startChipDrag(e, entry, ref.identity, ref.node)
		return
	}
	// 身份标签：拖动排序
	const identityLabel = t.closest && t.closest(`.identity-label`)
	if (identityLabel) {
		const identityG = identityLabel.closest(`.identity`)
		const ref = findIdentityRef(keyFromDom(identityG.dataset.identityId))
		if (ref) startIdentityDrag(e, ref.identity, ref.node)
		return
	}
	// 组织标签：拖动改层级
	const organizationLabel = t.closest && t.closest(`.label`)
	if (organizationLabel && organizationLabel.closest(`.node`)) {
		const node = findNode(keyFromDom(organizationLabel.closest(`.node`).dataset.organizationId))
		if (node) startOrganizationDrag(e, node)
		return
	}
	// 关系线：按下不动作（dblclick 编辑 / 右键菜单）
	if (t.closest && t.closest(`.person-person`)) return
	// 画布空白：平移
	if (t.closest && t.closest(`#svg`)) {
		startPan(e)
		return
	}
})

// ---- 单击 ----
document.addEventListener(`click`, e => {
	const t = e.target
	// 拖拽会话结束后会跟随一次 click：抑制，避免误触发下面的点击动作
	if (suppressClick) {
		suppressClick = false
		return
	}

	// 模态框按钮
	const act = t.closest && t.closest(`[data-act]`)
	if (act) {
		const a = act.dataset.act
		if (a === `modal-ok`) submitModal()
		else if (a === `modal-cancel`) closeModal()
		else if (a === `set-lang`) { // 空值 = 跟随作准语言（清本库配置，取当时作准语言）
			setDbUiLang(act.dataset.lang || null)
			refreshLanguageModal() // 解析结果与当前语言相同时 setLocale 空转、不触发重刷，这里兜底把 ✓ 挪过来
		}
		else if (a === `set-auth-lang`) changeAuthLang(act.dataset.lang)
		else if (a === `open-enabled-modal`) openEnabledLangsModal()
		else if (a === `enabled-cancel`) closeEnabledLayer() // 丢弃勾选，只移除叠层（语言弹窗不动）
		else if (a === `enabled-ok`) submitEnabledLayer()
		else if (a === `enabled-toggle`) toggleEnabledRow(act) // act 即勾选行本身
		else if (a === `entry-mode`) chooseEntryMode(act.dataset.mode) // 文本录入三选一互斥必选
		else if (a === `confirm-promote`) submitConfirm(`promote`)
		else if (a === `confirm-cascade`) submitConfirm(`cascade`)
		else if (a === `confirm-reference`) submitConfirm(`reference`)
		else if (a === `confirm-create`) submitConfirm(`create`)
		else if (a === `pick-person`) submitPick(act.dataset.dom)
		else if (a === `person-person-ok`) submitModal()
		else if (a === `bg-reset`) {
			closeModal()
			setMetaOp(`bg_color`, {description: ``}) // 空值 = 移除库里对应行，恢复默认全透明
		}
		return
	}

	// 画布折叠钮：连线交点收拢下级组织 / 名字左侧收拢本节点内容
	const junctionBtn = t.closest && t.closest(`[data-junction]`)
	if (junctionBtn) {
		// 保持被点击按钮的屏幕位置不动：先记位置，重绘后把画布平移回去
		const before = junctionBtn.getBoundingClientRect()
		const bx = before.left + before.width / 2, by = before.top + before.height / 2
		const jDom = junctionBtn.dataset.junction
		toggleCanvasCollapse(keyFromDom(jDom))
		const afterEl = viewport.querySelector(`[data-junction="${CSS.escape(jDom)}"]`)
		if (afterEl) {
			const after = afterEl.getBoundingClientRect()
			vs.tx += bx - (after.left + after.width / 2)
			vs.ty += by - (after.top + after.height / 2)
			applyTransform()
		}
		return
	}
	const foldBtn = t.closest && t.closest(`[data-fold]`)
	if (foldBtn) {
		toggleFold(keyFromDom(foldBtn.dataset.fold))
		return
	}

	// 静态按钮
	if (t.closest(`#btn-expand-all`)) return expandAll()
	if (t.closest(`#btn-fit`)) return fitView()
	if (t.closest(`#btn-lang`)) return openLanguageModal() // 🌐 统一语言设置（界面/作准/启用语言 + 文本录入开关）
	if (t.closest(`#btn-bg-color`)) {
		openBgColorModal()
		updateBgColorPreview() // 按当前配置/默认值先渲染一次预览
		return
	}
	// 左上角标题：单击改当前语言的显示名（纯本地化键；留空 = 清空当前语言槽、标题回退库名，不影响其他语言）
	// 标题弹窗脱离录入开关管理：多语言形态只由 T2 决定（T1 无影响），无库名固定行——见 html.js isTitle
	if (t.closest(`#app-title`)) {
		const seg = location.pathname.split(`/`).filter(Boolean)
		return openNameModal({
			title: tr(`modal.renameTitle`),
			placeholder: seg[0] || ``,
			allowEmpty: true,
			mode: nameModalMode(),
			fixedAuth: seg[0] || null,
			isTitle: true,
			authValue: seg[0] || ``,
			value: (store.meta.displayNameL10n && store.meta.displayNameL10n[getLocale()]) || ``,
			values: store.meta.displayNameL10n || {},
			onSubmit: patch => setMetaOp(`display_name`, patch),
		})
	}
	// 侧边栏收起/展开
	if (t.closest(`#btn-collapse-left`)) return togglePanel(`organization-panel`, `btn-collapse-left`, `‹`, `›`)
	if (t.closest(`#btn-collapse-right`)) return togglePanel(`sidebar`, `btn-collapse-right`, `›`, `‹`)
	if (t.closest(`#btn-new-root`)) return openNewRootOrganization()
	if (t.closest(`#btn-add-person`)) return openAddPerson()
	if (t.closest(`#row-global`)) return setFocus(null)

	// 左侧组织行
	const toggle = t.closest && t.closest(`.organization-row .toggle`)
	if (toggle && !toggle.classList.contains(`placeholder`)) {
		const row = toggle.closest(`.organization-row`)
		toggleCollapse(keyFromDom(row.dataset.organizationId))
		return
	}
	const organizationRow = t.closest && t.closest(`.organization-row[data-organization-id]`)
	if (organizationRow) {
		setFocus(keyFromDom(organizationRow.dataset.organizationId))
		return
	}

	// 画布人物条目：右侧列表滚动定位到对应人物卡片
	const chip = t.closest && t.closest(`.person-chip`)
	if (chip) {
		revealPerson(chip.dataset.personId)
		return
	}

	// 右侧人物卡片：定位到画布中心（多处担任依次跳转）
	const card = t.closest && t.closest(`.person-card`)
	if (card) {
		locatePerson(card.dataset.personId)
		return
	}
})

// ---- 悬停：人物聚焦（色块与右侧卡片同一套逻辑） ----
// 不包含该人物的组织/身份、其他人物 → 弱化；该人物身上的关系 → 高亮
let hoverPDom = null
let hoverRDom = null

function clearPersonFocus() {
	document.body.classList.remove(`focus-person`)
	document.querySelectorAll(`.pf-host`).forEach(x => x.classList.remove(`pf-host`))
	document.querySelectorAll(`.pf-person-person`).forEach(x => x.classList.remove(`pf-person-person`))
	document.querySelectorAll(`.pf-keep`).forEach(x => x.classList.remove(`pf-keep`))
}

// 悬停聚焦到具体担任（rDom 非空）：只点亮以该担任为端点的关系；卡片悬停（rDom 空）保持人物级
function setHover(pDom, rDom = null) {
	if (pDom === hoverPDom && rDom === hoverRDom) return
	setPersonPersonHover(null) // 与关系聚焦互斥
	if (hoverPDom) {
		document.querySelectorAll(`[data-person-id="${CSS.escape(hoverPDom)}"]`)
			.forEach(x => x.classList.remove(`hl`))
		clearPersonFocus()
	}
	hoverPDom = pDom
	hoverRDom = rDom
	if (!hoverPDom) return

	document.querySelectorAll(`[data-person-id="${CSS.escape(hoverPDom)}"]`)
		.forEach(x => x.classList.add(`hl`))

	const p = itemByDom(hoverPDom)
	if (!p) return
	document.body.classList.add(`focus-person`)
	// 与该担任有关系的关系线：高亮，且只点亮对端「那一条担任」
	// （端点按 人物+身份 精确匹配——悬停 X@C 时 X@A—Y@B 的关系不亮，悬停 X@A 才亮）
	store.personPersons.forEach(personPerson => {
		const aHit = personPerson.a.pDom === hoverPDom && (hoverRDom == null || personPerson.a.rDom === hoverRDom)
		const bHit = personPerson.b.pDom === hoverPDom && (hoverRDom == null || personPerson.b.rDom === hoverRDom)
		if (!aHit && !bHit) return
		const other = aHit ? personPerson.b : personPerson.a
		const g = viewport.querySelector(`[data-person-person-id="${domKey(personPerson)}"]`)
		if (g) g.classList.add(`pf-person-person`) // 身上的关系高亮
		const chip = viewport.querySelector(`.person-chip[data-person-id="${CSS.escape(other.pDom)}"][data-identity-id="${CSS.escape(other.rDom)}"]`)
		if (chip) chip.classList.add(`pf-keep`)
	})
	const pIdentities = p.identities || []
	pIdentities.forEach(r => {
		const ref = findIdentityRef(r.key)
		if (!ref) return
		const nodeEl = viewport.querySelector(`[data-organization-id="${domKey(ref.node)}"]`)
		if (nodeEl) nodeEl.classList.add(`pf-host`)
		const identityEl = viewport.querySelector(`[data-identity-id="${r.dom}"]`)
		if (identityEl) identityEl.classList.add(`pf-host`)
	})
}

// ---- 悬停：关系聚焦 ----
// 其他关系常规化（淡化），高亮显示关系两端的人物，其余节点常规
let hoverPersonPersonDom = null

function clearPersonPersonFocus() {
	svg.classList.remove(`focus-person-person`)
	if (!hoverPersonPersonDom) return
	const prev = viewport.querySelector(`[data-person-person-id="${CSS.escape(hoverPersonPersonDom)}"]`)
	if (prev) prev.classList.remove(`pf-person-person`)
	endpointHl(hoverPersonPersonDom, false)
	hoverPersonPersonDom = null
}

function endpointHl(personPersonDom, on) {
	const personPerson = store.personPersons.find(r => domKey(r) === personPersonDom)
	if (!personPerson) return
	const pDoms = [personPerson.a.pDom, personPerson.b.pDom]
	pDoms.forEach(pd => {
		document.querySelectorAll(`[data-person-id="${CSS.escape(pd)}"]`)
			.forEach(x => x.classList.toggle(`hl`, on))
	})
}

function setPersonPersonHover(personPersonDom) {
	if (personPersonDom === hoverPersonPersonDom) return
	if (hoverPersonPersonDom) clearPersonPersonFocus()
	hoverPersonPersonDom = personPersonDom
	if (!hoverPersonPersonDom) return
	setHover(null) // 与人物聚焦互斥
	svg.classList.add(`focus-person-person`)
	const g = viewport.querySelector(`[data-person-person-id="${CSS.escape(hoverPersonPersonDom)}"]`)
	if (g) g.classList.add(`pf-person-person`)
	endpointHl(hoverPersonPersonDom, true)
}

// 任意拖放进行中：悬浮不高亮（无法被响应的东西悬浮无反应）
function anyDragging() {
	return svg.classList.contains(`person-person-dragging`) || svg.classList.contains(`organization-dragging`)
		|| svg.classList.contains(`identity-dragging`) || svg.classList.contains(`chip-dragging`)
}

document.addEventListener(`mouseover`, e => {
	if (anyDragging()) return
	if (lastTouchInput) return // 触屏点按不触发悬浮聚焦（否则高亮会粘到下一次触摸）
	const t = e.target
	// 关系线：关系聚焦（与人物聚焦互斥）
	const personPersonEl = t.closest && t.closest(`.person-person`)
	if (personPersonEl) {
		setPersonPersonHover(personPersonEl.dataset.personPersonId)
		return
	}
	setPersonPersonHover(null)
	const hit = t.closest && t.closest(`.person-chip, .person-card`)
	setHover(hit ? hit.dataset.personId : null, hit ? (hit.dataset.identityId || null) : null)
	// 新建人物的高亮：鼠标移入即删（标记同时清空，后续渲染不再挂类）
	const npEl = t.closest && t.closest(`.new-person`)
	if (npEl) {
		npEl.classList.remove(`new-person`)
		newPerson.dom = null
	}
})

// ---- 双击 ----
document.addEventListener(`dblclick`, e => {
	const t = e.target
	// 关系线：直接进入编辑
	const personPerson = t.closest && t.closest(`.person-person`)
	if (personPerson) {
		const r = store.personPersons.find(x => domKey(x) === personPerson.dataset.personPersonId)
		if (r) openPersonPersonEdit(r)
		return
	}
	// 组织标签：重命名
	const organizationLabel = t.closest && t.closest(`.label`)
	if (organizationLabel && organizationLabel.closest(`.node`)) {
		const node = findNode(keyFromDom(organizationLabel.closest(`.node`).dataset.organizationId))
		if (node) openNameModal({
			title: tr(`modal.renameOrganization`),
			placeholder: tr(`placeholder.organizationName`),
			targets: [keyOf(node)],
			original: node.name,
			...nameEditOpts(node),
			onSubmit: patch => renameOrganizationOp(keyOf(node), patch)
		})
		return
	}
	// 身份标签：重命名
	const identityLabel = t.closest && t.closest(`.identity-label`)
	if (identityLabel) {
		const ref = findIdentityRef(keyFromDom(identityLabel.closest(`.identity`).dataset.identityId))
		if (ref) openNameModal({
			title: tr(`modal.renameIdentity`),
			placeholder: tr(`placeholder.identityName`),
			targets: [keyOf(ref.identity)],
			original: ref.identity.name,
			...nameEditOpts(ref.identity),
			onSubmit: patch => renameIdentityOp(keyOf(ref.identity), patch)
		})
		return
	}
	// 画布空白：双击放大（触屏无滚轮，双击是唯一的快速放大入口）
	if (t.closest && t.closest(`#svg`)) zoomAt(e.clientX, e.clientY, -220, true)
})

// ---- 右键 / 长按菜单（共用）：依据目标构建并弹出菜单，命中可出菜单的目标返回 true ----
function openCtxMenuFor(t, x, y) {
	// 节点上的人物条目：保持现状（仅「移出身份」，不加头部）
	const chip = t.closest && t.closest(`.person-chip`)
	if (chip) {
		const ref = findIdentityRef(keyFromDom(chip.dataset.identityId))
		if (!ref) return false
		const pk = keyFromDom(chip.dataset.personId)
		showCtxMenu(x, y, [
			{label: tr(`menu.removeFromIdentity`), danger: true, onClick: () => unassignOp(pk, keyOf(ref.identity))},
		])
		return true
	}
	// 身份框
	const identityG = t.closest && t.closest(`.identity`)
	if (identityG) {
		const ref = findIdentityRef(keyFromDom(identityG.dataset.identityId))
		if (!ref) return false
		showCtxMenu(x, y, identityMenuItems(ref.identity))
		return true
	}
	// 关系线：编辑 / 删除
	const personPerson = t.closest && t.closest(`.person-person`)
	if (personPerson) {
		const r = store.personPersons.find(x => domKey(x) === personPerson.dataset.personPersonId)
		if (!r) return false
		showCtxMenu(x, y, personPersonMenuItems(r))
		return true
	}
	// 组织节点（画布）
	const nodeG = t.closest && t.closest(`.node`)
	if (nodeG) {
		const node = findNode(keyFromDom(nodeG.dataset.organizationId))
		if (!node) return false
		showCtxMenu(x, y, organizationMenuItems(node, true))
		return true
	}
	// 左侧组织行
	const organizationRow = t.closest && t.closest(`.organization-row[data-organization-id]`)
	if (organizationRow) {
		const node = findNode(keyFromDom(organizationRow.dataset.organizationId))
		if (!node) return false
		showCtxMenu(x, y, organizationMenuItems(node, false))
		return true
	}
	// 右侧人物卡片
	const card = t.closest && t.closest(`.person-card`)
	if (card) {
		const p = itemByDom(card.dataset.personId)
		if (!p) return false
		showCtxMenu(x, y, personMenuItems(p))
		return true
	}
	// 画布空白：仅全局（顶层）视图才有「新建一级组织」；聚焦视图不出菜单
	if (t.closest && t.closest(`#svg`)) {
		if (store.focusOrganizationId == null) {
			showCtxMenu(x, y, [
				{label: tr(`action.newRootOrganization`), onClick: () => openNewRootOrganization()},
			])
		}
		return true
	}
	return false
}

document.addEventListener(`contextmenu`, e => {
	if (openCtxMenuFor(e.target, e.clientX, e.clientY)) {
		e.preventDefault()
		e.stopPropagation()
	}
})

// ---- 输入框：人物筛选（只重刷右侧列表，不动画布） ----
document.addEventListener(`input`, e => {
	if (e.target && e.target.id === `person-filter`) renderSidebar()
})

// ---- 背景色模态框：拾色器/透明度实时预览 ----
function updateBgColorPreview() {
	const hexEl = document.getElementById(`bg-color-input`)
	const alphaEl = document.getElementById(`bg-alpha-input`)
	if (!hexEl || !alphaEl) return
	const alpha = Number(alphaEl.value)
	const label = document.getElementById(`bg-alpha-val`)
	const preview = document.getElementById(`bg-preview`)
	if (label) label.textContent = `${alpha}%`
	if (preview) {
		const a = Math.round(alpha * 2.55).toString(16).padStart(2, `0`)
		const c = `${hexEl.value}${a}` // 8 位 hex（含 alpha）
		// 颜色层作渐变顶层（盖棋盘格），alpha<1 时半透明透出下方棋盘格
		preview.style.backgroundImage = `linear-gradient(${c}, ${c}), conic-gradient(#ececec 0 25%, #ffffff 0 50%, #ececec 0 75%, #ffffff 0)`
	}
}
document.addEventListener(`input`, e => {
	if (e.target && (e.target.id === `bg-color-input` || e.target.id === `bg-alpha-input`)) updateBgColorPreview()
	// 名称弹窗（dual/full）：作准值实时同步为各语言输入框的 placeholder（提示翻译来源）
	if (e.target && e.target.id === `nm-auth`) {
		document.querySelectorAll(`input[id^="nm-"]`).forEach(el => {
			if (el.id !== `nm-auth`) el.placeholder = e.target.value
		})
	}
	// 关系表单多语言：某方向作准值实时同步为该方向各语言输入框的 placeholder
	if (e.target && (e.target.id === `pp-f-auth` || e.target.id === `pp-b-auth`)) {
		const dir = e.target.id === `pp-f-auth` ? `f` : `b`
		document.querySelectorAll(`input[id^="pp-${dir}-"]`).forEach(el => {
			if (el.id !== `pp-${dir}-auth`) el.placeholder = e.target.value
		})
	}
})

// 语言弹窗：作准语言变更 → PUT meta（落库并广播）；成功本地 setAuthLang 全量重解析显示名，失败 toast 错误码
function changeAuthLang(lang) {
	putAuthoritativeLang(lang).then(() => {
		refreshLanguageModal()
	}).catch(err => {
		showToast(tr(`error.${err.code || `internal_error`}`))
	})
}

// 启用语言勾选层：行内暂存（只翻 ✓ 并即时升降区块，不触发保存）；提交在 submitEnabledLayer 按 DOM 行序收集
function toggleEnabledRow(row) {
	if (!row || row.classList.contains(`disabled`)) return // 作准行固定不可动
	const chk = row.querySelector(`.menu-check`)
	if (!chk) return
	const list = document.getElementById(`enabled-langs-modal`)
	const handle = row.querySelector(`.drag-handle`)
	const on = chk.textContent.trim() === `✓`
	chk.textContent = on ? `` : `✓`
	if (!list) return
	if (!on) {
		// 勾选：升入可排序区末尾（启用序末位），获得抓板（先取列表再改类，避免把自己算进去）
		const sortables = [...list.querySelectorAll(`.set-row.sortable`)].filter(r => r !== row)
		row.classList.add(`sortable`)
		if (handle) handle.classList.remove(`placeholder`)
		const last = sortables[sortables.length - 1]
		if (last) list.insertBefore(row, last.nextSibling)
		else {
			// 除作准外无其他启用行：插到作准行正下方
			const authRow = list.querySelector(`.set-row.disabled`)
			list.insertBefore(row, authRow ? authRow.nextSibling : list.firstChild)
		}
	} else {
		// 取消勾选：按注册顺序归位到未启用区（未启用区恒保持注册序），抓板置灰占位（保持三列对齐）
		row.classList.remove(`sortable`)
		if (handle) handle.classList.add(`placeholder`)
		const order = availableLocales().map(x => x.code)
		const myIdx = order.indexOf(row.dataset.lang)
		const anchor = [...list.querySelectorAll(`.set-row`)].find(r => {
			if (r === row || r.classList.contains(`sortable`) || r.classList.contains(`disabled`)) return false
			return order.indexOf(r.dataset.lang) > myIdx
		})
		list.insertBefore(row, anchor || null)
	}
}

// ---- 启用语言排序：抓板拖拽（Pointer Events 桌面/触屏通用；只重排 DOM，确定时按行序收集） ----
let enabledDrag = null

function startEnabledDrag(e, handle) {
	const row = handle.closest(`.set-row`)
	const list = document.getElementById(`enabled-langs-modal`)
	if (!row || !list || !row.classList.contains(`sortable`)) return
	e.preventDefault()
	const rect = row.getBoundingClientRect()
	enabledDrag = {row, list, pointerId: e.pointerId, offsetY: e.clientY - rect.top, rowH: rect.height, delta: 0}
	row.classList.add(`dragging`)
	try {
		row.setPointerCapture(e.pointerId)
	} catch (err) {
	}
	suppressClick = true // 抬起时跟随的 click 不再触发勾选
}

function moveEnabledDrag(e) {
	if (!enabledDrag || e.pointerId !== enabledDrag.pointerId) return
	const {row, list, offsetY} = enabledDrag
	// 平移跟随「指针在行内的偏移」：布局顶 = 当前盒顶 − 已累积平移
	let layoutTop = row.getBoundingClientRect().top - enabledDrag.delta
	enabledDrag.delta = (e.clientY - offsetY) - layoutTop
	// 插位判定（被拖行 pointer-events:none，命中落在下方行）：过半线换位，真实换位时按槽高补偿平移，防飘行
	const hit = document.elementFromPoint(e.clientX, e.clientY)
	const tRow = hit && hit.closest ? hit.closest(`.set-row.sortable`) : null
	if (tRow && tRow !== row && list.contains(tRow)) {
		const r = tRow.getBoundingClientRect()
		if (e.clientY < r.top + r.height / 2) {
			if (row.nextSibling !== tRow) { // 已在目标前则不重复插（重复插会错加补偿）
				list.insertBefore(row, tRow)
				enabledDrag.delta += enabledDrag.rowH // 布局上移一槽
			}
		} else if (tRow.nextSibling !== row) {
			list.insertBefore(row, tRow.nextSibling)
			enabledDrag.delta -= enabledDrag.rowH // 布局下移一槽
		}
	}
	row.style.transform = `translateY(${enabledDrag.delta}px)`
}

function endEnabledDrag(e) {
	if (!enabledDrag || (e.pointerId !== undefined && e.pointerId !== enabledDrag.pointerId)) return
	enabledDrag.row.classList.remove(`dragging`)
	enabledDrag.row.style.transform = ``
	enabledDrag = null
}

document.addEventListener(`pointermove`, moveEnabledDrag)
document.addEventListener(`pointerup`, endEnabledDrag)
document.addEventListener(`pointercancel`, endEnabledDrag)

// 抓板按下启动排序拖拽（点按不移动时由 suppressClick 吃掉随后的 click，避免误触发勾选）
document.addEventListener(`pointerdown`, e => {
	const handle = e.target && e.target.closest ? e.target.closest(`.drag-handle`) : null
	if (handle && !handle.classList.contains(`placeholder`)) startEnabledDrag(e, handle)
})

// ---- 键盘 ----
document.addEventListener(`keydown`, e => {
	if (e.key === `Escape`) {
		// 叠层（启用语言勾选）优先于一级弹窗：先只移除叠层
		if (document.getElementById(`enabled-layer`)) closeEnabledLayer()
		else closeModal()
		closeAllMenus() // 右键菜单 + 导出下拉（含子菜单）
	}
	if (e.key === `Enter` && isModalOpen() && e.target && e.target.tagName === `INPUT`) submitModal()
})

// ---- 滚轮缩放（ctrl+wheel = 触控板捏合，走连续缩放曲线） ----
document.addEventListener(`wheel`, e => {
	if (e.target.closest && e.target.closest(`#svg`)) {
		e.preventDefault()
		zoomAt(e.clientX, e.clientY, e.deltaY, e.ctrlKey)
	}
}, {passive: false})

// ============================================================
// 面板指针拖拽（左侧组织行 / 右侧人物卡片）：统一抓手光标 + 跟随幽灵
// ============================================================

function clearDropMarks() {
	document.querySelectorAll(`.organization-row`).forEach(r2 =>
		r2.classList.remove(`drop-before`, `drop-after`, `drop-into`))
}

function makeGhost(text) {
	const g = document.createElement(`div`)
	g.className = `drag-ghost`
	g.textContent = text
	document.body.appendChild(g)
	return g
}

// 身份框投放的插入位置预览线（拖人物进来时直接控制顺序）
let identityInsertLine = null
function hideIdentityInsert() {
	if (identityInsertLine) {
		identityInsertLine.remove()
		identityInsertLine = null
	}
}
// 按投放高度计算插入间隙并画预览线，返回间隙下标
function showIdentityInsert(identity, ptY) {
	const rc = vs.identityPos.get(domKey(identity))
	if (!rc) return 0
	const persons = identity.persons || []
	let gap = 0
	persons.forEach(x => {
		const cp = vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`)
		if (cp && ptY > cp.y) gap++
	})
	let yLine
	const topOf = x => vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`).y - CHIP_H / 2
	const bottomOf = x => vs.chipPos.get(`${domKey(x)}|${domKey(identity)}`).y + CHIP_H / 2
	if (!persons.length) yLine = rc.y + IDENTITY_TOP_ZONE - CHIP_GAP / 2
	else if (gap === 0) yLine = topOf(persons[0]) - CHIP_GAP / 2
	else if (gap >= persons.length) yLine = bottomOf(persons[persons.length - 1]) + CHIP_GAP / 2
	else yLine = (bottomOf(persons[gap - 1]) + topOf(persons[gap])) / 2
	if (!identityInsertLine) {
		identityInsertLine = el(`line`, {class: `identity-drop-line purple`})
		viewport.appendChild(identityInsertLine)
	}
	identityInsertLine.setAttribute(`x1`, rc.x + 4)
	identityInsertLine.setAttribute(`x2`, rc.x + rc.w - 4)
	identityInsertLine.setAttribute(`y1`, yLine)
	identityInsertLine.setAttribute(`y2`, yLine)
	return gap
}

// 左侧组织行：拖动改层级 / 排序（源节点连同子树从文档流隐藏；触屏经行尾把手发起）
function startRowDrag(e, node, row) {
	e.stopPropagation()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const startX = e.clientX, startY = e.clientY
	const treeEl = document.getElementById(`organization-tree`)
	let active = false, ghost = null, dropInfo = null // {zone, targetRow}
	let lastX = e.clientX, lastY = e.clientY
	let rafId = 0

	// 命中目标行并打 before/after/into 标记（自动滚动后用最后指针位置重算）
	function pickDrop() {
		clearDropMarks()
		dropInfo = null
		const under = document.elementFromPoint(lastX, lastY)
		const trow = under && under.closest ? under.closest(`.organization-row[data-organization-id]`) : null
		if (trow && keyFromDom(trow.dataset.organizationId) !== keyOf(node)) {
			const rect = trow.getBoundingClientRect()
			const ratio = (lastY - rect.top) / rect.height
			const zone = ratio < 0.3 ? `before` : ratio > 0.7 ? `after` : `into`
			trow.classList.add(`drop-${zone}`)
			dropInfo = {zone, targetRow: trow}
		}
	}

	// 拖拽悬停到列表边缘时自动滚动（纵横双向），长列表也能拖到屏外的位置
	function tick() {
		rafId = 0
		if (!active) return
		const r = treeEl.getBoundingClientRect()
		const EDGE = 56, SPEED = 12
		if (lastY < r.top + EDGE) treeEl.scrollTop -= SPEED
		else if (lastY > r.bottom - EDGE) treeEl.scrollTop += SPEED
		if (lastX < r.left + EDGE) treeEl.scrollLeft -= SPEED
		else if (lastX > r.right - EDGE) treeEl.scrollLeft += SPEED
		pickDrop()
		rafId = requestAnimationFrame(tick)
	}

	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			ghost = makeGhost(node.name)
			document.body.classList.add(`is-dragging`)
			const nodeEl = row.closest(`.organization-node`)
			if (nodeEl) nodeEl.classList.add(`drag-src`) // 源节点连同子树从文档流隐藏
			if (navigator.vibrate) navigator.vibrate(8) // 触觉确认（支持的平台）
		}
		if (!active) return
		lastX = ev.clientX
		lastY = ev.clientY
		ghost.style.left = `${lastX}px`
		ghost.style.top = `${lastY}px`
		pickDrop()
		if (!rafId) rafId = requestAnimationFrame(tick)
	}

	function cleanup() {
		if (rafId) cancelAnimationFrame(rafId)
		rafId = 0
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		if (ghost) ghost.remove()
		document.body.classList.remove(`is-dragging`)
		const nodeEl = row.closest(`.organization-node`)
		if (nodeEl) nodeEl.classList.remove(`drag-src`)
		clearDropMarks()
	}

	// 手势被接管（双指捏合/系统手势）：恢复源节点显示
	function onCancel() {
		cleanup()
	}

	function onUp() {
		cleanup()
		if (myEpoch !== gestureEpoch) return
		if (!active || !dropInfo) return
		const key = keyOf(node)
		const targetKey = keyFromDom(dropInfo.targetRow.dataset.organizationId)
		let parentKey, index = null
		if (dropInfo.zone === `into`) {
			parentKey = targetKey
			vs.collapsedOrganizationIds.delete(parentKey) // 落入收拢的节点时自动展开
		} else {
			// 下标在「排除被拖节点的兄弟列表」上计算：放回原位不会下移
			const list = siblingsOf(targetKey, key)
			index = indexIn(list, targetKey) + (dropInfo.zone === `after` ? 1 : 0)
			const parent = parentOf(targetKey)
			parentKey = parent ? keyOf(parent) : null
		}
		moveOrganizationOp(key, parentKey, index)
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// 右侧人物卡片：拖进身份框（按位置插入）
function startCardDrag(e, p) {
	e.stopPropagation()
	const myEpoch = gestureEpoch // 手势纪元：双指落下等新手势使其失效
	const startX = e.clientX, startY = e.clientY
	let active = false, ghost = null
	let targetIdentity = null, targetGap = null

	function mark() {
		svg.classList.add(`dnd-dragging`)
		setHover(null) // 该人物已有色块的残留高亮清掉
		dimAll(`.person-person`)
		// 身份：已包含该人物 → dimmed（拒绝投放）；未包含 → lit（可投放）
		// 组织：内含 lit 身份 → lit；否则 dimmed（整组拒绝交互）
		const myIdentities = new Set(((p && p.identities) || []).map(r => r.key))
		const scan = nodes => {
			nodes.forEach(n => {
				const identities = n.identities || []
				let lit = false
				identities.forEach(r => {
					const identityEl = viewport.querySelector(`[data-identity-id="${domKey(r)}"]`)
					if (!identityEl) return
					if (myIdentities.has(keyOf(r))) identityEl.classList.add(`dimmed`)
					else {
						identityEl.classList.add(`lit`)
						lit = true
					}
				})
				const g = viewport.querySelector(`[data-organization-id="${domKey(n)}"]`)
				if (g) g.classList.add(lit ? `lit` : `dimmed`)
				scan(n.children)
			})
		}
		scan(currentRoots())
	}
	function clearMarks() {
		svg.classList.remove(`dnd-dragging`)
		viewport.querySelectorAll(`.dimmed`).forEach(x => x.classList.remove(`dimmed`))
		viewport.querySelectorAll(`.lit`).forEach(x => x.classList.remove(`lit`))
		viewport.querySelectorAll(`.identity.drop-hover`).forEach(x => x.classList.remove(`drop-hover`))
		hideIdentityInsert()
	}
	function onMove(ev) {
		if (myEpoch !== gestureEpoch) {
			onCancel()
			return
		}
		if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
			active = true
			suppressClick = true
			closeCtxMenu() // 长按菜单可能已弹出，拖拽开始即收起
			ghost = makeGhost(p.name)
			document.body.classList.add(`is-dragging`)
			mark()
			if (navigator.vibrate) navigator.vibrate(8) // 触觉确认（支持的平台）
		}
		if (!active) return
		ghost.style.left = `${ev.clientX}px`
		ghost.style.top = `${ev.clientY}px`
		targetIdentity = null
		targetGap = null
		viewport.querySelectorAll(`.identity.drop-hover`).forEach(x => x.classList.remove(`drop-hover`))
		hideIdentityInsert()
		const under = document.elementFromPoint(ev.clientX, ev.clientY)
		if (!under || !under.closest || !under.closest(`#svg`)) return // 画布外不响应
		// 人物色块脱离身份框嵌套：落到色块上 = 落到它所在身份的对应位置
		const chipEl = under.closest(`.person-chip`)
		const identityEl = chipEl
			? viewport.querySelector(`[data-identity-id="${chipEl.dataset.identityId}"]`)
			: under.closest(`.identity`)
		if (!identityEl || identityEl.classList.contains(`dimmed`)) return // 淡化的身份不响应
		const ref = findIdentityRef(keyFromDom(identityEl.dataset.identityId))
		if (!ref) return
		identityEl.classList.add(`drop-hover`)
		targetGap = showIdentityInsert(ref.identity, toViewport(ev).y)
		targetIdentity = ref.identity
	}

	function cleanup() {
		window.removeEventListener(`pointermove`, onMove)
		window.removeEventListener(`pointerup`, onUp)
		window.removeEventListener(`pointercancel`, onCancel)
		if (ghost) ghost.remove()
		document.body.classList.remove(`is-dragging`)
		clearMarks()
	}

	// 手势被接管（双指捏合/系统手势）：清除投放打标
	function onCancel() {
		cleanup()
	}

	function onUp() {
		cleanup()
		if (myEpoch !== gestureEpoch) return
		if (!active || !targetIdentity) return
		assignOp(keyOf(p), keyOf(targetIdentity), targetGap)
	}

	window.addEventListener(`pointermove`, onMove)
	window.addEventListener(`pointerup`, onUp)
	window.addEventListener(`pointercancel`, onCancel)
}

// ============================================================
// 启动
// ============================================================
init().then(() => {
	// 窄屏默认收起两侧面板：画布占满，面板经窄条上的按钮展开为浮层
	if (window.matchMedia(`(max-width: 720px)`).matches) {
		togglePanel(`organization-panel`, `btn-collapse-left`, `‹`, `›`)
		togglePanel(`sidebar`, `btn-collapse-right`, `›`, `‹`)
	}
	initExportMenu()
	initCollab()
}).catch(err => {
	const loadFailedText = tr(`app.loadFailed`)
	document.getElementById(`canvas-wrap`).insertAdjacentHTML(`beforeend`, `<div class="empty">${loadFailedText}</div>`)
	console.error(err)
})
