// html.js — 纯函数层：接收数据，输出 HTML/SVG 文本与坐标登记表
// 不做任何 DOM 挂载（文本宽度用离屏 canvas 测量），不绑定事件（事件在 events.js 里全局代理）。
import {store, keyOf, domKey, newPerson, ppLabel, getAuthLang, modalRowSet} from './data.js'
import {availableLocales, getLocale, isRtl, t} from './i18n.js'

// ---- 静态配置（不变动的布局常量与配色） ----
export const NODE_W = 150
export const GAP_X = 28, GAP_Y = 72
export const IDENTITY_GAP = 10
export const IDENTITY_TOP_ZONE = 16, IDENTITY_BOT_PAD = 8
export const CHIP_H = 20, CHIP_GAP = 6
export const PAD_T = 20, PAD_B = 12
export const SIDE_PAD = 12
export const LABEL_OFFSET = 12
export const IDENTITY_LABEL_OFFSET = 8
export const GAP_PAD = 5
// 空身份高度 = 有一个人物时的高度；空组织高度 = 有一个空身份时的高度
export const IDENTITY_MIN_H = IDENTITY_TOP_ZONE + CHIP_H + IDENTITY_BOT_PAD // 16+20+8 = 44
export const MIN_H = PAD_T + IDENTITY_MIN_H + PAD_B                 // 20+44+12 = 76
// 人物配色：40 个颜色按黄金角在色环上均匀铺开，饱和度/明度再交错微调——
// 相邻序号色相相距最远，哈希取模后同色碰撞率大幅降低（旧 8 色在十几人时就开始撞色）
export const PALETTE = Array.from({length: 40}, (_, i) => {
	const h = Math.round(i * 137.508) % 360 // 黄金角递进：序号相邻 → 色相最远
	const s = 60 + (i * 7) % 15             // 60%–74%
	const l = 50 + (i * 11) % 10            // 50%–59%
	return `hsl(${h}, ${s}%, ${l}%)`
})

// Segoe UI/Tahoma 覆盖阿拉伯文；CJK 字体覆盖中日文；system-ui 兜底
export const FONT_FAMILY = `"Segoe UI", Tahoma, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
const FONT_ORG = `12.5px ${FONT_FAMILY}`
const FONT_IDENTITY = `11px ${FONT_FAMILY}`
const FONT_CNT = `10px ${FONT_FAMILY}`

// placeholder 语义 = 「假设该语言槽为空」的显示值：解析时强制该槽为空（自己不可能是自己的回退语言）；
// 初始渲染与 events.js 实时联动同一规则

// 每人一个稳定颜色（按 domKey 取色，多处担任一眼可辨）；
// 新建未落库的人物（tmp-N 临时 dom）用近黑占位，真实 id 回赋后恢复哈希取色
export function personColor(k) {
	const s = String(k)
	if (s.startsWith(`tmp-`)) return `#383c44`
	let h = 0
	for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
	return PALETTE[h % PALETTE.length]
}

export const esc = s => String(s).replace(/[&<>"']/g, c => ({
	[`&`]: `&amp;`,
	[`<`]: `&lt;`,
	[`>`]: `&gt;`,
	[`"`]: `&quot;`,
	[`'`]: `&#39;`
}[c]))

// ---- 文本测量（离屏 canvas，与 CSS 字号一致） ----
const mctx = document.createElement(`canvas`).getContext(`2d`)

function measure(text, font) {
	mctx.font = font
	return mctx.measureText(text).width
}

// 超长截断为「…」，返回最终文本与宽度
function fitText(text, maxW, font) {
	let s = text
	let w = measure(s, font)
	while (w > maxW && s.length > 1) {
		s = s.slice(0, -1)
		w = measure(`${s}…`, font)
	}
	return {text: s === text ? text : `${s}…`, width: w}
}

// ---- 导出换行模式：名字完整显示（允许换行），名字从「边上标签」改为「框内顶部多行」 ----
// 统一布局节奏（与画布同一公式，画布只是名字区为固定值且有最低高度）：
//   框内边距 + 名字区 + (外边距 + 内容块) × n + 框内边距
// 内容块 = 身份框（组织内）/ 人物色块（身份内）；n = 0 时中间两项自然消失，无需分支
const WRAP_LH_ORG = 15      // 组织名行高（12.5px 字号）
const WRAP_LH_IDENTITY = 13 // 身份名行高（11px 字号）
const WRAP_LH_CHIP = 12     // 人物名行高
const WRAP_PAD = 10         // 框内边距：名字上沿到框顶 / 内容底边到框底
const WRAP_GAP = 8          // 内容外边距：名字→内容块、内容块→内容块 统一间距
const WRAP_CHIP_PAD = 4     // 人物色块文字上下留白
const WRAP_CNT_RESERVE_ORG = 46      // 组织名让出的右侧计数缺口宽
const WRAP_CNT_RESERVE_IDENTITY = 44 // 身份名让出的右侧计数缺口宽
const IDENTITY_W = NODE_W - SIDE_PAD * 2 // 身份框宽（126）
const CHIP_W = IDENTITY_W - 12           // 人物色块宽（114）
const CHIP_CS = 18                       // 色块左上色区宽（与互动模式一致）

// 贪心按字符断行：中日韩逐字、西文按字符断均可接受（导出图只要求完整显示）
function wrapLines(text, maxW, font) {
	const lines = []
	let cur = ``
	for (const ch of String(text)) {
		if (cur && measure(cur + ch, font) > maxW) {
			lines.push(cur)
			cur = ch
		} else {
			cur += ch
		}
	}
	lines.push(cur)
	return lines
}

// 换行模式的身份名行数（有计数时让出右侧缺口）；布局与绘制共用，保证高度一致
function wrapIdentityNameLines(identity) {
	const reserve = (identity.persons || []).length ? WRAP_CNT_RESERVE_IDENTITY : GAP_PAD * 2
	return wrapLines(identity.name, IDENTITY_W - reserve, FONT_IDENTITY).length
}

// 换行模式的组织名行数（有去重人物计数时让出右侧缺口）
function wrapOrgNameLines(node) {
	const personCnt = new Set((node.identities || []).flatMap(r => (r.persons || []).map(p => keyOf(p)))).size
	const reserve = personCnt ? WRAP_CNT_RESERVE_ORG : GAP_PAD * 2
	return wrapLines(node.name, NODE_W - reserve, FONT_ORG).length
}

// 换行模式的单个人物色块高度（行数决定，保底 CHIP_H）
function wrapChipHeight(person) {
	const n = wrapLines(person.name, CHIP_W - CHIP_CS - 13, FONT_IDENTITY).length
	return Math.max(CHIP_H, WRAP_CHIP_PAD * 2 + n * WRAP_LH_CHIP)
}

// 框内顶部多行名字（换行模式）：cx = 框中心 x，top = 框顶；返回文本与行数
function inBoxNameLines(text, maxW, font, cx, top, lh, cls) {
	const lines = wrapLines(text, maxW, font)
	const html = lines.map((ln, k) => `<text class="${cls}" x="${cx}" y="${top + WRAP_PAD + lh * (k + 0.5)}">${esc(ln)}</text>`).join(``)
	return {html, lines: lines.length}
}

// 顶边带缺口的圆角矩形路径：缺口处放边上标签（名字 / 计数），边线断开、无底色
// gaps = [[g1, g2], ...] 多缺口（自动排序并钳制进圆角内侧），顶边分段保留缺口间的边线
export function gappedBoxPath(x, y, w, h, r, gaps) {
	const right = x + w, bottom = y + h
	const list = (gaps || []).map(gap => {
		const a = Math.max(x + r, Math.min(gap[0], right - r))
		const b = Math.max(x + r, Math.min(gap[1], right - r))
		return a <= b ? [a, b] : [b, a]
	}).sort((p, q) => p[0] - q[0])
	// 顶边分段：缺口之外的边线保留
	const segs = []
	let cx = x + r
	for (const [g1, g2] of list) {
		if (g1 > cx) segs.push([cx, g1])
		cx = Math.max(cx, g2)
	}
	if (right - r > cx) segs.push([cx, right - r])

	const d = [
		`M ${right - r} ${y}`, `Q ${right} ${y} ${right} ${y + r}`,
		`L ${right} ${bottom - r}`, `Q ${right} ${bottom} ${right - r} ${bottom}`,
		`L ${x + r} ${bottom}`, `Q ${x} ${bottom} ${x} ${bottom - r}`,
		`L ${x} ${y + r}`, `Q ${x} ${y} ${x + r} ${y}`,
	]
	let cp = x + r
	for (const [a, b] of segs) {
		if (a > cp) d.push(`M ${a} ${y}`)
		d.push(`L ${b} ${y}`)
		cp = b
	}
	return d.join(` `)
}

// 边上标签：返回 { html, g1, g2 }（文本中心压在顶边上）；rightLimit 让出右侧计数缺口
// 名字被截断时内嵌 <title>，悬浮显示全文（与人物色块同款）
function edgeLabel(text, boxX, boxY, boxW, offset, cls, font, rightLimit = null) {
	const rl = rightLimit == null ? boxX + boxW - offset : rightLimit
	const t = fitText(text, rl - boxX - offset - GAP_PAD * 2, font)
	const g1 = boxX + offset
	const g2 = g1 + t.width + GAP_PAD * 2
	const titleTag = t.text !== text ? `<title>${esc(text)}</title>` : ``
	return {
		html: `<text class="${cls}" x="${(g1 + g2) / 2}" y="${boxY}">${titleTag}${esc(t.text)}</text>`,
		g1, g2,
	}
}

// 圆形加减折叠钮（SVG 绘制，不依赖字体字形）：expanded = −，collapsed = +
function pmCircle(x, y, r, attr, collapsed, cls, titleText = ``) {
	const arm = r * 0.58
	const v = collapsed ? ` M 0 ${-arm} V ${arm}` : ``
	const title = titleText ? `<title>${esc(titleText)}</title>` : ``
	return `<g class="${cls}" ${attr} transform="translate(${x},${y})"><circle r="${r}"/><path d="M ${-arm} 0 H ${arm}${v}"/>${title}</g>`
}

// 边上标签（带内容折叠钮）：圆钮占缺口左端 BTN 宽，文字顺延；collapsed 时显示 +
// 名字被截断时内嵌 <title>，悬浮显示全文（与人物色块同款）
function edgeLabelWithFold(text, boxX, boxY, boxW, offset, cls, font, foldDom, folded, rightLimit = null) {
	const rl = rightLimit == null ? boxX + boxW - offset : rightLimit
	const BTN = 13
	const t = fitText(text, rl - boxX - offset - GAP_PAD * 2 - BTN, font)
	const g1 = boxX + offset
	const g2 = g1 + BTN + t.width + GAP_PAD * 2
	const btn = pmCircle(g1 + BTN / 2, boxY, 5.5, `data-fold="${foldDom}"`, folded, `fold-btn`)
	const titleTag = t.text !== text ? `<title>${esc(text)}</title>` : ``
	const html = btn + `<text class="${cls}" x="${(g1 + BTN + g2) / 2}" y="${boxY}">${titleTag}${esc(t.text)}</text>`
	return {html, g1, g2}
}

// 计数标签（嵌在右边线上，与名字标签同款的缺口式）：num ≤ 0 不画
function countEdgeLabel(boxX, boxY, boxW, offset, num) {
	if (!num) return null
	const t = fitText(String(num), 30, FONT_CNT)
	const g2 = boxX + boxW - offset
	const g1 = g2 - t.width - GAP_PAD * 2
	const html = `<text class="cnt-label" x="${(g1 + g2) / 2}" y="${boxY}">${num}</text>`
	return {g1, g2, html}
}

// ---- 尺寸计算 ----
function visiblePersons(identity, hiddenChipKey) {
	return (identity.persons || []).filter(x => (`${domKey(x)}|${domKey(identity)}`) !== hiddenChipKey)
}

// 身份高度：统一节奏 = 内边距 + 名字区 + (外边距 + 色块)×n + 内边距（n=0 无需分支）
function identityHeight(identity, hiddenChipKey, foldedIds, wrap = false) {
	const folded = foldedIds && foldedIds.has(keyOf(identity))
	const persons = folded ? [] : visiblePersons(identity, hiddenChipKey)
	if (!wrap) {
		if (!persons.length) return IDENTITY_MIN_H
		return IDENTITY_TOP_ZONE + persons.length * CHIP_H + (persons.length - 1) * CHIP_GAP + IDENTITY_BOT_PAD
	}
	const chipsH = persons.reduce((s, p) => s + WRAP_GAP + wrapChipHeight(p), 0)
	return WRAP_PAD + wrapIdentityNameLines(identity) * WRAP_LH_IDENTITY + chipsH + WRAP_PAD
}

function visibleIdentitiesOf(node, hiddenIdentityKey, foldedIds) {
	if (foldedIds && foldedIds.has(keyOf(node))) return [] // 内容收拢的组织：隐藏全部身份
	return (node.identities || []).filter(r => keyOf(r) !== hiddenIdentityKey)
}

// 组织高度：同一节奏，内容块 = 身份框（内容收拢的组织 rs 为空，自然只剩 边距+名字+边距）
function nodeHeight(node, hiddenIdentityKey, hiddenChipKey, foldedIds, wrap = false) {
	const rs = visibleIdentitiesOf(node, hiddenIdentityKey, foldedIds)
	if (wrap) {
		const idsH = rs.reduce((s, r) => s + WRAP_GAP + identityHeight(r, hiddenChipKey, foldedIds, wrap), 0)
		return WRAP_PAD + wrapOrgNameLines(node) * WRAP_LH_ORG + idsH + WRAP_PAD
	}
	if (!rs.length) return MIN_H
	return PAD_T + rs.reduce((s, r) => s + identityHeight(r, hiddenChipKey, foldedIds), 0) + (rs.length - 1) * IDENTITY_GAP + PAD_B
}

// ---- 布局（就地写回 node.x / node.y / node.h） ----
// collapsedCanvasIds：交点收拢的组织（藏下级，整棵子树按叶子计）；
// foldedIds：内容收拢的组织/身份（只藏本格内容：组织藏身份、身份藏人物，下级组织不受影响）
// wrap：导出换行模式（名字完整显示、框内多行排版）
// dir：布局方向（1 = LTR 从左往右；-1 = RTL 从右往左，子树整体镜像；命中拖拽读坐标自动跟随）
export function layoutTree(viewRoots, hiddenOrganizationKey, hiddenIdentityKey, hiddenChipKey, collapsedCanvasIds = new Set(), foldedIds = new Set(), wrap = false, dir = 1) {
	const virtualRoot = {name: ``, children: viewRoots, virtual: true, identities: []}
	// 拖动/收拢隐藏的子树完全不参与：父节点只在「可见子节点」之间居中，否则旧坐标会把上级拉错位
	const kidsOf = node => {
		if (!node.virtual && collapsedCanvasIds.has(keyOf(node))) return []
		return node.children.filter(c => keyOf(c) !== hiddenOrganizationKey)
	}
	const levelH = []
	const measureNode = (node, depth) => {
		if (!node.virtual && keyOf(node) === hiddenOrganizationKey) return
		node.depth = depth
		node.h = node.virtual ? 0 : nodeHeight(node, hiddenIdentityKey, hiddenChipKey, foldedIds, wrap)
		if (!node.virtual) levelH[depth] = Math.max(levelH[depth] || 0, node.h)
		kidsOf(node).forEach(c => measureNode(c, depth + 1))
	}
	measureNode(virtualRoot, -1)

	const levelTop = []
	let acc = 0
	levelH.forEach((h, d) => {
		levelTop[d] = acc
		acc += (h || 0) + GAP_Y
	})
	const treeH = Math.max(0, acc - GAP_Y)

	// 叶子按方向排布：LTR 从左往右，RTL 从右往左（树宽先按叶子数定，RTL 叶子坐标依赖它）
	const countLeaves = node => {
		const kids = kidsOf(node)
		if (!kids.length) return 1
		return kids.reduce((s, c) => s + countLeaves(c), 0)
	}
	const treeW = Math.max(1, countLeaves(virtualRoot)) * (NODE_W + GAP_X) - GAP_X
	const leafX = i => dir > 0 ? i * (NODE_W + GAP_X) + NODE_W / 2 : treeW - i * (NODE_W + GAP_X) - NODE_W / 2

	let leafCursor = 0
	const place = node => {
		if (!node.virtual && keyOf(node) === hiddenOrganizationKey) return
		const kids = kidsOf(node)
		if (!kids.length) {
			node.x = leafX(leafCursor)
			leafCursor++
		} else {
			kids.forEach(place)
			node.x = (kids[0].x + kids[kids.length - 1].x) / 2
		}
		// 同层节点顶部对齐（高度由身份/人物数量决定，可能各不相同）
		if (!node.virtual) node.y = levelTop[node.depth] + node.h / 2
	}
	place(virtualRoot)

	return {virtualRoot, treeW, treeH}
}

// ---- 画布 SVG ----
// 返回 { markup, chipPos, identityPos, treeW, treeH }；事件零绑定，全部靠 data-* 供 events.js 代理
// controls = false（导出）：不画折叠钮/交点钮/交点计数；wrap = true（导出 PNG）：名字完整显示、允许换行
export function buildCanvas(viewRoots, opts) {
	const {
		hiddenOrganizationKey = null, hiddenIdentityKey = null, hiddenChipKey = null,
		collapsedCanvasIds = new Set(), foldedIds = new Set(),
		controls = true, wrap = false, rtl = null,
	} = opts
	// RTL 默认跟随界面语言；导出图与所见一致（可显式传 rtl 覆盖）
	const mirror = rtl != null ? rtl : isRtl()
	const chipPos = new Map()
	const identityPos = new Map()

	const {virtualRoot, treeW, treeH} = layoutTree(viewRoots, hiddenOrganizationKey, hiddenIdentityKey, hiddenChipKey, collapsedCanvasIds, foldedIds, wrap, mirror ? -1 : 1)

	// 交点收拢组织的下级不绘制：坐标未重算，且视觉上应隐藏（内容收拢只藏本格，下级照常画）
	const drawnKids = node => {
		if (!node.virtual && collapsedCanvasIds.has(keyOf(node))) return []
		return node.children.filter(c => keyOf(c) !== hiddenOrganizationKey)
	}

	// 树连线：总线式走线——父节点垂下一条短桩接到水平总线，总线横贯所有子节点正上方，
	// 每个子节点再由总线垂直接入顶边。总线固定在层间隙正中（同层所有总线同高），
	// 不同父节点/不同层的线段区间天然不交叠，消除旧折线方案兄弟横段共线重叠的问题
	let links = ``
	let junctions = ``
	const drawLinks = node => {
		const kids = drawnKids(node)
		const nk = keyOf(node)
		// 交点收拢钮：有下级才显示；展开态要求有可见下级——独生组织被拖起（hiddenOrganizationKey 隐藏）时不画
		const showJ = controls && !node.virtual && node.children.length && (collapsedCanvasIds.has(nk) || kids.length)
		const collapsed = showJ && collapsedCanvasIds.has(nk)
		const y1 = node.virtual ? 0 : node.y + node.h / 2
		// 交点钮固定在没有干扰时的位置：盒底 + GAP_Y/2（标准间隙正中），线长被同层节点撑长时也不跟随
		const jy = showJ ? y1 + GAP_Y / 2 : 0
		// 计数中心：标准线长（盒底到按钮 GAP_Y/2）的中点，被同层节点撑长也不跟随；
		// 数字字形视觉中心比 em 盒中心偏高，上提 2px 光学对齐
		const CNT_HALF = 8 // 计数断口半高：连线路径在计数处真实打断（与盒顶标签缺口同款，不留白晕）
		const cntY = y1 + GAP_Y / 4 - 2
		if (showJ) {
			// 收拢态：短桩把展开钮连回盒底（计数处打断）
			if (collapsed) {
				links += `<path class="link" d="M ${node.x} ${y1} L ${node.x} ${cntY - CNT_HALF} M ${node.x} ${cntY + CNT_HALF} L ${node.x} ${jy}"/>`
			}
			junctions += pmCircle(node.x, jy, 8, `data-junction="${domKey(node)}"`, collapsed, `junction`)
			junctions += `<text class="cnt-label junction-cnt" x="${node.x}" y="${cntY}">${node.children.length}</text>`
		}
		if (!node.virtual && kids.length) {
			const yTop = kids[0].y - kids[0].h / 2  // 子级顶边（同层顶部对齐，任意取一个）
			const yBus = yTop - GAP_Y / 2           // 总线高度：层间隙正中
			// 垂直连线在计数与交点钮处真实打断（断口内嵌计数）
			const stem = showJ
				? `M ${node.x} ${y1} L ${node.x} ${cntY - CNT_HALF} M ${node.x} ${cntY + CNT_HALF} L ${node.x} ${jy - 8}`
				: `M ${node.x} ${y1} L ${node.x} ${yBus}`
			let d
			if (kids.length === 1) {
				// 独子必在父正下方（布局按子级居中），垂直直连（经钮下缘续到子顶）
				d = showJ
					? `${stem} M ${node.x} ${jy + 8} L ${kids[0].x} ${yTop}`
					: `M ${node.x} ${y1} L ${kids[0].x} ${yTop}`
			} else {
				const x1 = kids[0].x, xn = kids[kids.length - 1].x // 子节点按从左到右排布
				const kidStubs = kids.map(c => ` M ${c.x} ${yBus} L ${c.x} ${yTop}`).join(``)
				// 钮下缘续一条垂线到总线（钮固定在标准间隙正中，不再落在总线上）
				const toBus = showJ ? ` M ${node.x} ${jy + 8} L ${node.x} ${yBus}` : ``
				d = `${stem}${toBus} M ${x1} ${yBus} L ${xn} ${yBus}${kidStubs}`
			}
			links += `<path class="link" d="${d}"/>`
		}
		kids.forEach(drawLinks)
	}
	drawLinks(virtualRoot)

	// 组织节点
	let nodes = ``
	let chips = `` // 人物色块一层：压在组织/身份框上，但位于关系线之下（关系线不被遮挡）
	const drawNode = node => {
		if (!node.virtual && keyOf(node) === hiddenOrganizationKey) return
		if (!node.virtual) {
			const nk = keyOf(node)
			const folded = foldedIds.has(nk)
			const canFold = (node.identities || []).length > 0 // 本格内无身份则不显示（与空身份一致），下级组织由交点钮管
			// 组内一律用【局部坐标】（g 已带 translate），角色/人物登记表用绝对坐标
			const left = -NODE_W / 2, top = -node.h / 2
			// 去重人物数：同一人物在本组织多个身份内只计一次
			const personCnt = new Set((node.identities || []).flatMap(r => (r.persons || []).map(p => keyOf(p)))).size
			const cntLb = countEdgeLabel(left, top, NODE_W, LABEL_OFFSET, personCnt)
			const rightLimit = cntLb ? cntLb.g1 - 2 : null
			const foldedCls = folded ? ` folded` : ``
			let lb, boxGaps
			if (wrap) {
				// 名字进框内顶部多行：顶边缺口只剩计数
				lb = inBoxNameLines(node.name, NODE_W - (cntLb ? WRAP_CNT_RESERVE_ORG : GAP_PAD * 2), FONT_ORG, 0, top, WRAP_LH_ORG, `label`)
				boxGaps = cntLb ? [[cntLb.g1, cntLb.g2]] : []
			} else {
				lb = controls && canFold
					? edgeLabelWithFold(node.name, left, top, NODE_W, LABEL_OFFSET, `label`, FONT_ORG, domKey(node), folded, rightLimit)
					: edgeLabel(node.name, left, top, NODE_W, LABEL_OFFSET, `label`, FONT_ORG, rightLimit)
				boxGaps = cntLb ? [[lb.g1, lb.g2], [cntLb.g1, cntLb.g2]] : [[lb.g1, lb.g2]]
			}
			nodes += `<g class="node${foldedCls}" data-organization-id="${domKey(node)}" transform="translate(${node.x},${node.y})">`
			nodes += `<path class="box" d="${gappedBoxPath(left, top, NODE_W, node.h, 8, boxGaps)}"/>`
			nodes += lb.html
			if (cntLb) nodes += cntLb.html

			// 换行模式：身份区 = 组织名区 + 外边距（统一节奏；互动模式组织名在边上，身份区保持固定 PAD_T）
			const rs = visibleIdentitiesOf(node, hiddenIdentityKey, foldedIds)
			const orgNameZone = WRAP_PAD + wrapOrgNameLines(node) * WRAP_LH_ORG
			let ry = top + (wrap ? orgNameZone + (rs.length ? WRAP_GAP : 0) : PAD_T)
			rs.forEach(identity => {
				const rDom = domKey(identity)
				const rFolded = foldedIds.has(keyOf(identity))
				const rh = identityHeight(identity, hiddenChipKey, foldedIds, wrap)
				const rx = left + SIDE_PAD
				const rw = NODE_W - SIDE_PAD * 2
				identityPos.set(rDom, {x: node.x + rx, y: node.y + ry, w: rw, h: rh, organizationKey: keyOf(node)})

				const rCntLb = countEdgeLabel(rx, ry, rw, IDENTITY_LABEL_OFFSET, (identity.persons || []).length)
				const rRightLimit = rCntLb ? rCntLb.g1 - 2 : null
				const identityFoldedCls = rFolded ? ` folded` : ``
				let rl, identityGaps
				if (wrap) {
					// 名字进框内顶部多行：顶边缺口只剩计数
					rl = inBoxNameLines(identity.name, IDENTITY_W - (rCntLb ? WRAP_CNT_RESERVE_IDENTITY : GAP_PAD * 2), FONT_IDENTITY, rx + rw / 2, ry, WRAP_LH_IDENTITY, `identity-label`)
					identityGaps = rCntLb ? [[rCntLb.g1, rCntLb.g2]] : []
				} else {
					rl = controls && (identity.persons || []).length
						? edgeLabelWithFold(identity.name, rx, ry, rw, IDENTITY_LABEL_OFFSET, `identity-label`, FONT_IDENTITY, rDom, rFolded, rRightLimit)
						: edgeLabel(identity.name, rx, ry, rw, IDENTITY_LABEL_OFFSET, `identity-label`, FONT_IDENTITY, rRightLimit)
					identityGaps = rCntLb ? [[rl.g1, rl.g2], [rCntLb.g1, rCntLb.g2]] : [[rl.g1, rl.g2]]
				}
				let identityHtml = `<g class="identity${identityFoldedCls}" data-identity-id="${rDom}">`
				identityHtml += `<path class="identity-box" d="${gappedBoxPath(rx, ry, rw, rh, 6, identityGaps)}"/>`
				identityHtml += rl.html
				if (rCntLb) identityHtml += rCntLb.html

				if (!rFolded) {
					// 色块区 = 身份名区 + 外边距（统一节奏：色块之间也是 WRAP_GAP）
					let cy = ry + (wrap ? WRAP_PAD + rl.lines * WRAP_LH_IDENTITY + WRAP_GAP : IDENTITY_TOP_ZONE)
					visiblePersons(identity, hiddenChipKey).forEach(p => {
						const cw = rw - 12
						const pDom = domKey(p)
						const newCls = pDom === newPerson.dom ? ` new-person` : ``
						const CS = 18 // 上色区域宽（与标签一体、齐边；RTL 时整体镜像到右侧）
						const nameW = cw - CS - 13
						const tx = mirror ? cw - CS - 7 : CS + 7 // 文字基线 x（RTL 时从右排，配合 #svg 的 direction）
						let ch, nameText
						if (wrap) {
							// 完整显示允许换行：行数决定色块高度
							const lines = wrapLines(p.name, nameW, FONT_IDENTITY)
							ch = Math.max(CHIP_H, WRAP_CHIP_PAD * 2 + lines.length * WRAP_LH_CHIP)
							nameText = lines.map((ln, k) => `<text class="chip-name" x="${tx}" y="${WRAP_CHIP_PAD + WRAP_LH_CHIP * (k + 0.5)}">${esc(ln)}</text>`).join(``)
						} else {
							// 名字过长：省略号截断，悬浮展示全文（<title>）
							const nameFit = fitText(p.name, nameW, FONT_IDENTITY)
							const titleTag = nameFit.text !== p.name ? `<title>${esc(p.name)}</title>` : ``
							ch = CHIP_H
							nameText = `<text class="chip-name" x="${tx}" y="${CHIP_H / 2}">${esc(nameFit.text)}</text>${titleTag}`
						}
						const bodyPath = mirror
							? `M 0 0 L ${cw - CS - 5} 0 Q ${cw - CS} 0 ${cw - CS} 5 L ${cw - CS} ${ch - 5} Q ${cw - CS} ${ch} ${cw - CS - 5} ${ch} L 0 ${ch} Z`
							: `M ${CS} 0 L ${cw - 5} 0 Q ${cw} 0 ${cw} 5 L ${cw} ${ch - 5} Q ${cw} ${ch} ${cw - 5} ${ch} L ${CS} ${ch} Z`
						// 上色区与主体之间不设分隔线（历史上的 chip-sep 视觉上是多余竖线，已去除）
						const zoneX = mirror ? cw - CS : 0
						chips += `<g class="person-chip${newCls}" data-person-id="${pDom}" data-identity-id="${rDom}" transform="translate(${node.x + rx + 6},${node.y + cy})"><rect class="chip-fill" x="${zoneX}" width="${CS}" height="${ch}" rx="5" fill="${personColor(pDom)}"/><path class="chip-body" d="${bodyPath}"/><rect class="chip-outline" width="${cw}" height="${ch}" rx="5"/>${nameText}</g>`
						chipPos.set(`${pDom}|${rDom}`, {
							x: node.x + rx + 6 + cw / 2,
							y: node.y + cy + ch / 2,
							bx: node.x + rx + 6 + (mirror ? cw - CS / 2 : CS / 2), // 上色区域中心（拉线起点）
							by: node.y + cy + ch / 2,
							personKey: keyOf(p), identityKey: keyOf(identity),
							pDom, rDom,
							personName: p.name, identityName: identity.name, organizationName: node.name,
						})
						cy += ch + (wrap ? WRAP_GAP : CHIP_GAP)
					})
				}

				identityHtml += `</g>`
				nodes += identityHtml
				ry += rh + (wrap ? WRAP_GAP : IDENTITY_GAP)
			})
			nodes += `</g>`
		}
		drawnKids(node).forEach(drawNode)
	}
	drawNode(virtualRoot)

	// 关系（⇌ 双向往返弧线，标签沿线排列；标签也参与事件判定）
	let personPersons = ``
	store.personPersons.forEach(personPerson => {
		const A = chipPos.get(`${personPerson.a.pDom}|${personPerson.a.rDom}`)
		const B = chipPos.get(`${personPerson.b.pDom}|${personPerson.b.rDom}`)
		if (!A || !B) return // 端点不在当前视图内时不绘制

		const dx = B.x - A.x, dy = B.y - A.y
		const dist = Math.hypot(dx, dy) || 1
		const nx = -dy / dist, ny = dx / dist
		const bend = Math.min(Math.max(dist * 0.18, 24), 70)
		const SEP = 7
		const mx = (A.x + B.x) / 2 + nx * bend
		const my = (A.y + B.y) / 2 + ny * bend

		function edgePoint(p, cx, cy) {
			const vx = cx - p.x, vy = cy - p.y
			const ax = Math.abs(vx), ay = Math.abs(vy)
			if (!ax && !ay) return {x: p.x, y: p.y}
			const t = Math.min(ax ? 57 / ax : Infinity, ay ? 10 / ay : Infinity)
			// 沿方向向外多走 0.5px：框 1px 描边的外缘在 +0.5，线 1px 描边半宽 0.5，正好贴上
			const L = Math.hypot(vx, vy)
			const out = 0.5 / L
			return {x: p.x + vx * (t + out), y: p.y + vy * (t + out)}
		}

		// 二次贝塞尔：任意 t 的点位与切线
		function quadPoint(s, cx, cy, e, t) {
			const u = 1 - t
			return {x: u * u * s.x + 2 * u * t * cx + t * t * e.x, y: u * u * s.y + 2 * u * t * cy + t * t * e.y}
		}

		function quadTangent(s, cx, cy, e, t) {
			return {x: 2 * (1 - t) * (cx - s.x) + 2 * t * (e.x - cx), y: 2 * (1 - t) * (cy - s.y) + 2 * t * (e.y - cy)}
		}

		function arc(from, to, side) {
			const cx = mx + nx * SEP * side, cy = my + ny * SEP * side
			// 起点与终点都紧贴人物框边缘；鱼钩箭头与对向箭尾本就错开 ±SEP，不会重叠
			const s = edgePoint(from, cx, cy)
			const e = edgePoint(to, cx, cy)
			return {
				d: `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`,
				s,
				e,
				cx,
				cy,
				side,
				tip: e,
				tan: {x: e.x - cx, y: e.y - cy}
			}
		}

		// 鱼钩与线身合并为一条 path：尖端拐角由 stroke-linejoin:miter 出尖
		function withHook(a) {
			const L = Math.hypot(a.tan.x, a.tan.y) || 1
			const ux = a.tan.x / L, uy = a.tan.y / L
			const bx = a.tip.x - ux * 9 + nx * 4.5 * a.side
			const by = a.tip.y - uy * 9 + ny * 4.5 * a.side
			return `${a.d} L ${bx} ${by}`
		}

		// 两个标签：都在各自弧线的正中心，沿法向一左一右（±9px）不会重叠
		function labelAt(a, t, text) {
			const p = quadPoint(a.s, a.cx, a.cy, a.e, t)
			const tan = quadTangent(a.s, a.cx, a.cy, a.e, t)
			const ang = normAngle(Math.atan2(tan.y, tan.x) * 180 / Math.PI)
			const px2 = p.x + nx * 9 * a.side
			const py2 = p.y + ny * 9 * a.side
			return `<text x="${px2}" y="${py2}" transform="rotate(${ang} ${px2} ${py2})">${esc(text)}</text>`
		}

		const fwd = arc(A, B, +1)
		const bwd = arc(B, A, -1)
		const fwdText = ppLabel(personPerson, `forward`)
		const bwdText = ppLabel(personPerson, `backward`)
		const fwdTitle = t(`relation.title`, {a: A.personName, b: B.personName, relation: fwdText})
		const bwdTitle = t(`relation.title`, {a: B.personName, b: A.personName, relation: bwdText})
		const personPersonTitle = `${fwdTitle}\n${bwdTitle}`
		personPersons += `<g class="person-person" data-person-person-id="${domKey(personPerson)}" data-a-person="${personPerson.a.pDom}" data-b-person="${personPerson.b.pDom}" data-a-identity="${personPerson.a.rDom}" data-b-identity="${personPerson.b.rDom}"><path d="${withHook(fwd)}"/><path d="${withHook(bwd)}"/>${labelAt(fwd, 0.5, fwdText)}${labelAt(bwd, 0.5, bwdText)}<title>${esc(personPersonTitle)}</title></g>`
	})

	// 关系线最上层：不被组织/身份/人物遮挡（半透明弱化，悬浮时全亮）
	return {markup: links + junctions + nodes + chips + personPersons, chipPos, identityPos, treeW, treeH}
}

// 文字翻转归一：避免倒置阅读
function normAngle(a) {
	if (a > 90) return a - 180
	if (a < -90) return a + 180
	return a
}

// ---- 左侧组织树（真树状嵌套） ----
export function buildOrganizationPanel(roots, focusKey, collapsedOrganizationIds) {
	const walk = (nodes) => nodes.map(n => {
		const nk = keyOf(n)
		const collapsed = collapsedOrganizationIds.has(nk)
		const hasKids = n.children.length > 0
		const active = focusKey != null && focusKey === nk ? ` active` : ``
		const toggleCls = hasKids ? `` : `placeholder`
		const arrow = hasKids ? (collapsed ? (isRtl() ? `◂` : `▸`) : `▾`) : `` // RTL：收拢箭头指向左
		const kidsHtml = hasKids && !collapsed ? `<div class="organization-children">${walk(n.children)}</div>` : ``
		return `<div class="organization-node"><div class="organization-row${active}" data-organization-id="${domKey(n)}"><span class="row-grip"></span><span class="toggle ${toggleCls}">${arrow}</span><span class="oname">${esc(n.name)}</span></div>${kidsHtml}</div>`
	}).join(``)
	return walk(roots)
}

// ---- 右侧人物边栏 ----
// 排序：不在当前视图内的排在下方；徽标数字 = 当前视图（聚焦组织及以下）中的身份数量，与收拢/展开状态无关
// filter：按名字子串筛选（不区分大小写）；viewIdentityDoms：dom → 视图树序序号
// 悬浮提示的担任顺序与定位循环顺序一致（均为视图树序：上级到下级、从前到后），空串显示全部
export function buildSidebar(persons, viewIdentityDoms, filter = ``) {
	const f = filter.trim().toLowerCase()
	const list = f ? persons.filter(p => p.name.toLowerCase().includes(f)) : persons
	if (!list.length) {
		const emptyText = f ? t(`sidebar.emptyFilter`) : t(`sidebar.empty`)
		return `<div class="side-empty">${emptyText}</div>`
	}
	const viewCount = p => p.identities.filter(r => viewIdentityDoms.has(r.dom)).length
	// 排序：按画布可见身份数从多到少；数量相同按名字字典序（中文按拼音）
	const sorted = [...list].sort((a, b) => viewCount(b) - viewCount(a) || a.name.localeCompare(b.name, `zh`))
	return sorted.map(p => {
		const pDom = domKey(p)
		// 担任按视图树序排列（与点击卡片定位的循环顺序一致）
		const inView = p.identities
			.filter(r => viewIdentityDoms.has(r.dom))
			.sort((a, b) => viewIdentityDoms.get(a.dom) - viewIdentityDoms.get(b.dom))
		const title = inView.map(r => `${r.organization} · ${r.name}`).join(`
`)
		const titleAttr = title ? ` title="${esc(title)}"` : ``
		const newCls = pDom === newPerson.dom ? ` new-person` : ``
		return `<div class="person-card${newCls}" data-person-id="${pDom}"><span class="dot" style="background:${personColor(pDom)}"></span><span class="pname" title="${esc(p.name)}">${esc(p.name)}</span><span class="badge"${titleAttr}>${inView.length}</span></div>`
	}).join(``)
}

// ---- 菜单内容（右键菜单 / 导出下拉 / 设置下拉共用一套渲染；children = 二级子菜单） ----
// item: {label, onClick?, danger?, header?, divider?, children?, check?}；menuId 生成 data-mi 供 controls.js 分发
// check = 当前选中标记（设置菜单的当前语言）：标签后追加对勾，行间两端对齐
export function menuHtml(items, menuId) {
	const row = (it, mi) => {
		if (it.divider) return `<div class="menu-divider"></div>`
		if (it.header) return `<div class="menu-header">${esc(it.header)}</div>`
		const dangerCls = it.danger ? ` danger` : ``
		const checkedCls = it.check ? ` checked` : ``
		const check = it.check ? `<span class="menu-check">✓</span>` : ``
		return `<div class="menu-item${dangerCls}${checkedCls}" data-mi="${menuId}:${mi}">${esc(it.label)}${check}</div>`
	}
	return items.map((it, i) => {
		if (it.children) {
			const sub = it.children.map((c, j) => row(c, `${i}-${j}`)).join(``)
			const arrow = isRtl() ? `▸` : `◂` // RTL：子菜单向右飞出
			return `<div class="menu-item has-sub" data-mi="${menuId}:${i}">${esc(it.label)}<span class="sub-arrow">${arrow}</span><div class="sub-pop pop hidden">${sub}</div></div>`
		}
		return row(it, `${i}`)
	}).join(``)
}

// ---- 统一名称模态框（新建 / 重命名 共用；标题弹窗经 isTitle 走独立规则） ----
// 形态（mode）由调用方先行换算：实体 settings.nameModalMode；标题 controls.openNameModal（bare/full/chain/readonly）
// 行集真源 = data.js modalRowSet(isTitle, mode)；本函数只负责画法：
//   readonly = 只读本名（无输入框，标题独有）；bare = 无标签单输入（placeholder 规则见分支注释）；
//   其余形态 = 带标签语言行（作准行加粗、placeholder = 字段名；标题语言行静态 placeholder = 库名值，挂载后由 refreshEntryPlaceholders 统一刷）；
//   唯一行规则：行集只剩一行且即当前界面语言 → 去标签（视觉同 bare，id/placeholder 语义不变）
// value 预填当前语言槽；authValue/values 预填作准槽与各语言槽；标题提交不写 authoritative（走 {value}/{l10n}）
// original：重命名时原标题栏下方展示的现用名（淡化小字），新建不传
export function nameModalHtml({title, placeholder = ``, value = ``, mode = `bare`, authValue = ``, values = {}, fixedAuth = null, original = ``, isTitle = false}) {
	const cancel = esc(t(`modal.cancel`))
	const ok = esc(t(`modal.ok`))
	const lang = getLocale()
	const auth = getAuthLang()
	const locales = availableLocales()
	const libVal = fixedAuth != null ? fixedAuth : ``
	const originalRow = original ? `<div class="nm-original">${esc(original)}</div>` : ``
	const valOf = code => code === auth ? authValue : code === lang ? value : (values[code] || ``)
	// 带标签语言行：作准行加粗 + 字段名 placeholder；其余行 placeholder 由 refreshEntryPlaceholders 统一填（标题行先垫库名值）
	const rowHtml = code => {
		const name = (locales.find(x => x.code === code) || {name: code}).name
		return code === auth
			? `<div class="person-person-io"><span class="io-label"><b>${esc(name)}</b></span><input id="nm-auth" maxlength="30" placeholder="${esc(placeholder)}" value="${esc(authValue)}"></div>`
			: `
    <div class="person-person-io"><span class="io-label">${esc(name)}</span><input id="nm-${code}" maxlength="30"${isTitle ? ` placeholder="${esc(libVal)}"` : ``} value="${esc(valOf(code))}"></div>`
	}
	let rows = ``
	if (isTitle && mode === `readonly`) {
		// 界面∉启用且选项1/无链语言：标题仅按启用语言编辑——只读展示本名（数据库名），无输入框（确定即关窗，见 controls.js submitModal）
		rows = `
    <div class="person-person-io"><input disabled value="${esc(libVal)}"></div>`
	} else if (mode === `bare`) {
		// 无标签单输入 = 当前界面语言槽（作准=界面时它也是作准槽；换算层保证界面语言∈启用集）
		// placeholder：标题 = 库名值；实体 = 作准=界面 ? 字段名（XX名称）: 作准值（现用名）
		const ph = isTitle ? libVal : (auth === lang ? placeholder : authValue)
		rows = `
    <div class="person-person-io"><input id="nm-bare" maxlength="30" placeholder="${esc(ph)}" value="${esc(value)}"></div>`
	} else {
		const rowSet = modalRowSet(isTitle, mode) || []
		// 唯一行规则：只剩一行且即当前界面语言 → 去标签（chain 单行为链语言、非当前语言，保留标签）
		rows = rowSet.length === 1 && rowSet[0] === lang
			? (rowSet[0] === auth
				? `<div class="person-person-io"><input id="nm-auth" maxlength="30" placeholder="${esc(placeholder)}" value="${esc(authValue)}"></div>`
				: `<div class="person-person-io"><input id="nm-${rowSet[0]}" maxlength="30"${isTitle ? ` placeholder="${esc(libVal)}"` : ``} value="${esc(valOf(rowSet[0]))}"></div>`)
			: rowSet.map(rowHtml).join(``)
	}
	return `
    <div class="pop-title">${esc(title)}</div>
    ${originalRow}
    <div class="io-rows">${rows}</div>
    <div class="btns"><button data-act="modal-cancel">${cancel}</button><button data-act="modal-ok" class="primary">${ok}</button></div>
  `
}

// ---- 背景色设置：拾色器 + 透明度滑杆，确定时组合为 rgba ----
export function bgColorModalHtml(hex, alpha) {
	const popTitle = esc(t(`header.bgColor`))
	const reset = esc(t(`modal.resetDefault`))
	const cancel = esc(t(`modal.cancel`))
	const ok = esc(t(`modal.ok`))
	return `
    <div class="pop-title">${popTitle}</div>
    <div class="person-person-io">
      <input type="color" id="bg-color-input" value="${esc(hex)}">
      <input type="range" id="bg-alpha-input" min="0" max="100" value="${alpha}" style="width:150px">
      <span id="bg-alpha-val">${alpha}%</span>
    </div>
    <div class="bg-preview" id="bg-preview"></div>
    <div class="btns"><button data-act="bg-reset">${reset}</button><button data-act="modal-cancel">${cancel}</button><button data-act="modal-ok" class="primary">${ok}</button></div>
  `
}

// ---- 语言模态框（🌐 统一语言设置）：启用语言（二级叠层勾选）+ 界面语言/作准语言两栏 + 底部文本录入开关 ----
// 界面语言列 = 「跟随作准语言」（本库配置为空）+ 全量语言（纯本地偏好，不受启用语言限制）；
// 作准语言列只列启用语言（作准必在启用集内）；启用语言同时决定名称表单可录入的语言
export function languageModalHtml(uiLangCode, authLangCode, enabledLangs, entryMode) {
	const check = on => on ? `<span class="menu-check">✓</span>` : ``
	const en = new Set(enabledLangs)
	// 界面语言列：跟随作准语言（空值）置顶 + 全量语言；作准语言列：启用语言
	const uiRows = [`<div class="set-row" data-act="set-lang" data-lang=""><span>${esc(t(`lang.follow`))}</span>${check(!uiLangCode)}</div>`]
		.concat(availableLocales().map(({code, name}) => `
    <div class="set-row" data-act="set-lang" data-lang="${code}"><span>${esc(name)}</span>${check(code === uiLangCode)}</div>`)).join(``)
	const authRows = availableLocales().filter(({code}) => en.has(code)).map(({code, name}) => `
    <div class="set-row" data-act="set-auth-lang" data-lang="${code}"><span>${esc(name)}</span>${check(code === authLangCode)}</div>`).join(``)
	// 文本录入模式：三选一互斥必选（ui = 仅界面语言；dual = 作准≠界面时加作准行；full = 启用语言全列）
	const modeRow = (m, labelKey) => `
    <div class="set-row" data-act="entry-mode" data-mode="${m}"><span>${esc(t(labelKey))}</span>${check(entryMode === m)}</div>`
	const advRows = `<div class="set-sec">${esc(t(`settings.advanced`))}</div>`
		+ modeRow(`ui`, `settings.advancedUi`) + modeRow(`dual`, `settings.advanced1`) + modeRow(`full`, `settings.advanced2`)
	const arrow = isRtl() ? `◂` : `▸`
	return `
    <div class="pop-title">${esc(t(`lang.title`))}</div>
    <div id="language-modal">
      <div class="set-row has-arrow" data-act="open-enabled-modal"><span>${esc(t(`lang.enabled`))}</span><span class="sub-arrow">${arrow}</span></div>
      <div class="lang-cols">
        <div class="lang-col"><div class="set-sec">${esc(t(`lang.ui`))}</div>${uiRows}</div>
        <div class="lang-col"><div class="set-sec">${esc(t(`lang.authoritative`))}</div>${authRows}</div>
      </div>
      ${advRows}
    </div>
    <div class="btns"><button data-act="modal-cancel">${esc(t(`settings.close`))}</button></div>
  `
}

// ---- 启用语言勾选层（叠在语言弹窗上的二级卡片，不关闭一级弹窗）：勾选本地暂存，「确定」才保存 ----
// 行序 = 保存语序：作准语言固定首行（✓ 不可动）→ 其余启用行（左侧抓板可拖拽排序）→ 未启用行（注册顺序，无抓板）
// 确定时按 DOM 行序收集 ✓ 行整集提交；行内三层结构（抓板占位 + 名 + ✓）保证未启用行对齐
export function enabledLangsModalHtml(authLangCode, enabledLangs) {
	const enabledSet = new Set(enabledLangs)
	const locales = availableLocales()
	const nameOf = code => (locales.find(x => x.code === code) || {code, name: code}).name
	const left = (inner, sortable) => `<span class="row-left"><span class="drag-handle${sortable ? `` : ` placeholder`}">⠿</span><span>${inner}</span></span>`
	const authRow = `<div class="set-row disabled" data-lang="${authLangCode}">${left(`<b>${esc(nameOf(authLangCode))}</b>`)}<span class="menu-check">✓</span></div>`
	const sortableRows = enabledLangs.filter(c => c !== authLangCode).map(code =>
		`<div class="set-row sortable" data-act="enabled-toggle" data-lang="${code}">${left(esc(nameOf(code)), true)}<span class="menu-check">✓</span></div>`).join(``)
	const disabledRows = locales.filter(x => !enabledSet.has(x.code)).map(({code, name}) =>
		`<div class="set-row" data-act="enabled-toggle" data-lang="${code}">${left(esc(name))}<span class="menu-check"></span></div>`).join(``)
	const cancel = esc(t(`modal.cancel`))
	const ok = esc(t(`modal.ok`))
	return `
    <div class="pop-title">${esc(t(`lang.enabled`))}</div>
    <div id="enabled-langs-modal">${authRow}${sortableRows}${disabledRows}</div>
    <div class="btns"><button data-act="enabled-cancel">${cancel}</button><button data-act="enabled-ok" class="primary">${ok}</button></div>
  `
}

// ---- 同名人物确认：fromSidebar（右侧新建）= 取消/确定；fromIdentity（身份处）= 取消/引用/新建 ----
export function personExistsConfirmHtml(withRef) {
	const cancel = esc(t(`modal.cancel`))
	const msg = esc(t(withRef ? `confirm.personExistsRef` : `confirm.personExistsNew`))
	const btns = withRef
		? `<button data-act="modal-cancel">${cancel}</button><button data-act="confirm-reference">${esc(t(`modal.reference`))}</button><button data-act="confirm-create" class="primary">${esc(t(`modal.createNew`))}</button>`
		: `<button data-act="modal-cancel">${cancel}</button><button data-act="confirm-create" class="primary">${esc(t(`modal.ok`))}</button>`
	return `
    <div class="pop-title">${msg}</div>
    <div class="btns">${btns}</div>
  `
}

// ---- 多同名引用选人：行样式与右侧人物卡片同款（色点 + 名字 + 数量徽标）----
// 数量与悬浮清单恒为全量担任（组织 · 身份逐行），不受当前视图收拢/聚焦影响
export function personPickerHtml(persons) {
	const cancel = esc(t(`modal.cancel`))
	const rows = persons.map(p => {
		const pDom = esc(domKey(p))
		const all = p.identities || []
		const title = all.map(r => `${r.organization} · ${r.name}`).join(`
`)
		const titleAttr = title ? ` title="${esc(title)}"` : ``
		return `<div class="person-card pick-row" data-act="pick-person" data-dom="${pDom}"><span class="dot" style="background:${personColor(pDom)}"></span><span class="pname" title="${esc(p.name)}">${esc(p.name)}</span><span class="badge"${titleAttr}>${all.length}</span></div>`
	}).join(``)
	return `
    <div class="pop-title">${esc(t(`modal.pickPerson`))}</div>
    ${rows}
    <div class="btns"><button data-act="modal-cancel">${cancel}</button></div>
  `
}

// ---- 组织删除确认（有下级组织时）：递推删除 / 保留下级提升 / 取消 ----
export function organizationDeleteConfirmHtml(name) {
	const popTitle = esc(t(`modal.deleteOrganizationTitle`, {name}))
	const cancel = esc(t(`modal.cancel`))
	const keep = esc(t(`modal.keepChildren`))
	const cascade = esc(t(`modal.cascadeDelete`))
	return `
    <div class="pop-title">${popTitle}</div>
    <div class="btns"><button data-act="modal-cancel">${cancel}</button><button data-act="confirm-promote">${keep}</button><button data-act="confirm-cascade" class="danger">${cascade}</button></div>
  `
}

// ---- 关系表单模态框（新建 / 编辑 共用，对称布局） ----
// 形态行集真源 = data.js modalRowSet(false, mode)：bare 每方向一个无标签输入（界面语言槽）| auth 每方向带标签作准输入（界面语言∉启用集时 bare 的退化形态）| 其余形态 = 作准组（恒第一，组名加粗）+ 其余行集语言组（fill=仅当前 / dual=+当前语言的回退链 / full=+其余启用语言）
// forward/backward = 各方向作准槽预填值；values = {forward: {locale: 槽值}, backward: {…}} 各方向语言槽
export function personPersonFormHtml(A, B, {title = t(`modal.newRelation`), mode = `bare`, forward = ``, backward = ``, values = {}} = {}) {
	const cancel = esc(t(`modal.cancel`))
	const ok = esc(t(`modal.ok`))
	const lang = getLocale()
	const auth = getAuthLang()
	const fwdSlots = values.forward || {}
	const bwdSlots = values.backward || {}
	// 整句模板渲染：relation.sentence 词条含 {a}/{b}/{input} 占位，{input} 处插入输入框——
	// 语序不同的语言只改词条即可；反向句式（B 是 A 的）由调用方交换 a/b 实参复用同一词条
	const sentence = (aName, bName, inputHtml) => {
		const [head, tail = ``] = t(`relation.sentence`).split(`{input}`)
		const fill = s => esc(s).replace(`{a}`, `<b>${esc(aName)}</b>`).replace(`{b}`, `<b>${esc(bName)}</b>`)
		return fill(head) + inputHtml + fill(tail)
	}
	const input = (id, val, ph) => `<input id="${id}" maxlength="10" value="${esc(val)}"${ph != null ? ` placeholder="${esc(ph)}"` : ``}>`
	let ioRows = ``
	if (mode === `bare`) {
		// bare：不显示任何语言标签，每方向一个输入 = 当前界面语言槽（nameModalMode 保证界面语言∈启用集）
		// placeholder 每方向同名称弹窗（形态表）：作准=界面 → 字段名（关系名称）；作准≠界面 → 本方向作准值
		const basePh = t(`relation.basePlaceholder`)
		const fPh = auth === lang ? basePh : forward
		const bPh = auth === lang ? basePh : backward
		ioRows = `
    <div class="person-person-io">${sentence(A.personName, B.personName, input(`pp-f-bare`, fwdSlots[lang] || ``, fPh))}</div>
    <div class="person-person-io">${sentence(B.personName, A.personName, input(`pp-b-bare`, bwdSlots[lang] || ``, bPh))}</div>`
	} else if (mode === `auth`) {
		// auth：界面语言∉启用集（nameModalMode 保证）——bare 契约不成立，每方向退化为带标签的作准输入（复用 dual 作准组形态）
		const authLoc = availableLocales().find(x => x.code === auth) || {code: auth, name: auth}
		const basePh = t(`relation.basePlaceholder`)
		ioRows = `
    <div class="pp-lang-group">
      <div class="pp-lang-cap"><b>${esc(authLoc.name)}</b></div>
      <div class="person-person-io">${sentence(A.personName, B.personName, input(`pp-f-auth`, forward, basePh))}</div>
      <div class="person-person-io">${sentence(B.personName, A.personName, input(`pp-b-auth`, backward, basePh))}</div>
    </div>`
	} else {
		// 多语言分组：行集真源 = data.js modalRowSet(false, mode)；作准组恒第一（组名加粗），由换算层保证 界面∈启用
		// 每组内是与默认弹窗同款的可读双向句式（A 是 B 的 [输入] / B 是 A 的 [输入]）
		const rowSet = modalRowSet(false, mode) || []
		// placeholder：作准组显示字段名（关系标签）；语言组渲染不带 placeholder，由挂载后的 refreshEntryPlaceholders 统一填
		// 作准组输入 id 固定 pp-f-auth / pp-b-auth（提交与 placeholder 联动的锚点）；语言组按语言码
		const groupHtml = code => {
			const name = (availableLocales().find(x => x.code === code) || {name: code}).name
			const isAuth = code === auth
			const key = isAuth ? `auth` : code
			const cap = isAuth ? `<b>${esc(name)}</b>` : esc(name)
			const fVal = isAuth ? forward : (fwdSlots[code] || ``)
			const bVal = isAuth ? backward : (bwdSlots[code] || ``)
			return `
    <div class="pp-lang-group">
      <div class="pp-lang-cap">${cap}</div>
      <div class="person-person-io">${sentence(A.personName, B.personName, isAuth ? input(`pp-f-${key}`, fVal, t(`relation.basePlaceholder`)) : input(`pp-f-${key}`, fVal))}</div>
      <div class="person-person-io">${sentence(B.personName, A.personName, isAuth ? input(`pp-b-${key}`, bVal, t(`relation.basePlaceholder`)) : input(`pp-b-${key}`, bVal))}</div>
    </div>`
		}
		// 唯一行规则：只剩一组且即当前界面语言（作准=界面且仅启用作准）→ 去组名标签
		if (rowSet.length === 1 && rowSet[0] === lang) {
			const soleCode = rowSet[0]
			const key = soleCode === auth ? `auth` : soleCode
			const fVal = soleCode === auth ? forward : (fwdSlots[soleCode] || ``)
			const bVal = soleCode === auth ? backward : (bwdSlots[soleCode] || ``)
			ioRows = `
    <div class="person-person-io">${sentence(A.personName, B.personName, input(`pp-f-${key}`, fVal, t(`relation.basePlaceholder`)))}</div>
    <div class="person-person-io">${sentence(B.personName, A.personName, input(`pp-b-${key}`, bVal, t(`relation.basePlaceholder`)))}</div>`
		} else {
			ioRows = rowSet.map(groupHtml).join(``)
		}
	}
	return `
    <div class="pop-title">${esc(title)}</div>
    <div class="person-person-cols">
      <div class="person-person-col">
        <div class="person-person-cap">${esc(A.organizationName)} · ${esc(A.identityName)}</div>
        <div class="person-person-name">${esc(A.personName)}</div>
      </div>
      <div class="person-person-sep">⇌</div>
      <div class="person-person-col">
        <div class="person-person-cap">${esc(B.organizationName)} · ${esc(B.identityName)}</div>
        <div class="person-person-name">${esc(B.personName)}</div>
      </div>
    </div>
    ${ioRows}
    <div class="btns"><button data-act="modal-cancel">${cancel}</button><button data-act="person-person-ok" class="primary">${ok}</button></div>
  `
}
