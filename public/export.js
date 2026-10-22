// export.js — 导出：JSON（全量数据）与 PNG/SVG 图片
// PNG/SVG 分「全局」（整棵树、忽略聚焦、收拢状态全部展开）与「当前」（当前聚焦范围、收拢状态原样）
// PNG：去掉控件，名字完整显示、允许换行；SVG：去掉控件，保留省略号 + <title> 悬浮全文，并内嵌悬浮高亮（浏览器直接打开时生效）
// 菜单结构（二级子菜单）与开合分发在 controls.js 统一管理，这里只提供菜单数据与导出实现
import {store, currentRoots, findNode} from './data.js'
import {buildCanvas, FONT_FAMILY} from './html.js'
import {vs} from './view.js'
import {bindExportMenu, renderExportMenu} from './controls.js'
import {isRtl, onLocaleChange, t} from './i18n.js'

const SVGNS = `http://www.w3.org/2000/svg`

// ---- 导出菜单（controls.js 渲染与分发）：PNG · 全局 · 当前 / SVG · 全局 · 当前 / JSON / DB ----
// 词条在构建时经 t() 取当前语言；语言切换后整菜单重建（下方自注册监听）
function exportItems() {
	return [
		{label: `PNG`, children: [
			{label: t(`export.global`), onClick: () => runExport(`png-global`)},
			{label: t(`export.current`), onClick: () => runExport(`png-current`)},
		]},
		{label: `SVG`, children: [
			{label: t(`export.global`), onClick: () => runExport(`svg-global`)},
			{label: t(`export.current`), onClick: () => runExport(`svg-current`)},
		]},
		{label: `JSON`, onClick: () => runExport(`json`)},
		{label: `DB`, onClick: () => runExport(`db`)},
	]
}

export function initExportMenu() {
	bindExportMenu(exportItems())
}

export function refreshExportMenu() {
	renderExportMenu(exportItems())
}

onLocaleChange(refreshExportMenu)

// 文件名安全化：Windows 非法文件名字符替换为下划线
const sanitizeFile = s => String(s).replace(/[\\/:*?"<>|]/g, `_`)

// 当前聚焦组织名（图片「当前」视图文件名后缀）；无聚焦返回空串
function currentOrgSuffix() {
	const key = store.focusOrganizationId
	if (key == null) return ``
	const n = findNode(key)
	if (!n) return ``
	return `_${sanitizeFile(n.name)}`
}

// 导出文件名：品牌名_显示名_YYYYMMDDhhmmss.ext；图片且「当前」视图再跟 _组织名
// 品牌名随界面语言（连客 / Linker / 連客）
function exportFileName(ext, scope = null) {
	const d = new Date()
	const pad = n => String(n).padStart(2, `0`)
	const stamp14 = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	const seg = location.pathname.split(`/`).filter(Boolean)
	const display = sanitizeFile(store.meta.displayName || seg[0] || ``)
	const brand = sanitizeFile(t(`app.brand`))
	let name = `${brand}_${display}_${stamp14}`
	if ((ext === `png` || ext === `svg`) && scope === `current`) name += currentOrgSuffix()
	return `${name}.${ext}`
}

function downloadBlob(blob, filename) {
	const a = document.createElement(`a`)
	a.href = URL.createObjectURL(blob)
	a.download = filename
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---- JSON：全量数据（服务端 api/export/json，含元数据） ----
async function exportJson() {
	const res = await fetch(`api/export/json`)
	const data = await res.json()
	downloadBlob(new Blob([JSON.stringify(data, null, 2)], {type: `application/json`}), exportFileName(`json`))
}

// ---- DB：原始库文件（服务端 VACUUM INTO 一致性快照） ----
async function exportDb() {
	const res = await fetch(`api/export/db`)
	if (!res.ok) throw new Error(`数据库导出失败：${res.status}`)
	downloadBlob(await res.blob(), exportFileName(`db`))
}

// ---- 导出范围 ----
// global：整棵树（忽略左侧聚焦），收拢状态全部展开——导出完整图景
// current：当前聚焦范围，收拢/展开状态原样——所见即所得
function scopeParams(scope) {
	if (scope === `global`) return {roots: store.roots, collapsedCanvasIds: new Set(), foldedIds: new Set()}
	return {roots: currentRoots(), collapsedCanvasIds: vs.collapsedCanvasIds, foldedIds: vs.foldedIds}
}

// ---- 悬浮高亮（仅 SVG 导出内嵌；浏览器直接打开文件时生效，其余环境自动降级为静态矢量图） ----
// 作用域 #lk-export 覆盖 style.css 里 body.focus-person / svg.focus-person-person 那两组规则
const EXPORT_FOCUS_CSS = `#lk-export{width:auto;height:auto;cursor:default}
#lk-export *{cursor:default}
#lk-export .node,#lk-export .identity,#lk-export .person-chip,#lk-export .person-person path,#lk-export .person-person text{transition:opacity .15s}
#lk-export.focus-person .node,#lk-export.focus-person .identity{opacity:.35}
#lk-export.focus-person .node.pf-host,#lk-export.focus-person .identity.pf-host{opacity:1}
#lk-export.focus-person .person-chip{opacity:.35}
#lk-export.focus-person .person-chip.hl,#lk-export.focus-person .person-chip.pf-keep{opacity:1}
#lk-export.focus-person .person-person path,#lk-export.focus-person .person-person text{opacity:.08}
#lk-export.focus-person .person-person.pf-person-person path,#lk-export.focus-person .person-person.pf-person-person text{opacity:1}
#lk-export.focus-person-person .person-person path,#lk-export.focus-person-person .person-person text{opacity:.08}
#lk-export.focus-person-person .person-person.pf-person-person path,#lk-export.focus-person-person .person-person.pf-person-person text{opacity:1}`

const EXPORT_FOCUS_SCRIPT = `<script><![CDATA[(function () {
	const svg = document.getElementById('lk-export')
	if (!svg || !svg.addEventListener) return
	let hoverKey = null
	function clear() {
		svg.classList.remove('focus-person')
		svg.classList.remove('focus-person-person')
		svg.querySelectorAll('.hl,.pf-host,.pf-person-person,.pf-keep').forEach(function (el) {
			el.classList.remove('hl')
			el.classList.remove('pf-host')
			el.classList.remove('pf-person-person')
			el.classList.remove('pf-keep')
		})
	}
	function personFocus(chip) {
		const id = chip.getAttribute('data-person-id')
		const rid = chip.getAttribute('data-identity-id') // 端点按 人物+身份 精确匹配
		svg.classList.add('focus-person')
		svg.querySelectorAll('.person-chip[data-person-id="' + id + '"]').forEach(function (c) {
			c.classList.add('hl')
			const identity = c.closest ? c.closest('.identity') : null
			if (identity) identity.classList.add('pf-host')
			const node = c.closest ? c.closest('.node') : null
			if (node) node.classList.add('pf-host')
		})
		svg.querySelectorAll('.person-person').forEach(function (pp) {
			const a = pp.getAttribute('data-a-person')
			const b = pp.getAttribute('data-b-person')
			// 只点亮以该担任为端点的关系（悬停 X@C 时 X@A—Y@B 不亮）
			const aHit = a === id && pp.getAttribute('data-a-identity') === rid
			const bHit = b === id && pp.getAttribute('data-b-identity') === rid
			if (!aHit && !bHit) return
			pp.classList.add('pf-person-person')
			// 只点亮对端「那一条担任」（人物+身份），同人物的其他担任不高亮
			const otherP = aHit ? b : a
			const otherR = aHit ? pp.getAttribute('data-b-identity') : pp.getAttribute('data-a-identity')
			const chipEl = svg.querySelector('.person-chip[data-person-id="' + otherP + '"][data-identity-id="' + otherR + '"]')
			if (chipEl) chipEl.classList.add('pf-keep')
		})
	}
	function personPersonFocus(pp) {
		svg.classList.add('focus-person-person')
		pp.classList.add('pf-person-person')
		const a = pp.getAttribute('data-a-person')
		const b = pp.getAttribute('data-b-person')
		svg.querySelectorAll('.person-chip[data-person-id="' + a + '"],.person-chip[data-person-id="' + b + '"]')
			.forEach(function (c) { c.classList.add('hl') })
	}
	svg.addEventListener('mouseover', function (e) {
		const t = e.target
		const chip = t && t.closest ? t.closest('.person-chip') : null
		const pp = t && t.closest ? t.closest('.person-person') : null
		// key 含身份：同人物不同担任间移动也要重新评估端点
		const key = chip ? 'p:' + chip.getAttribute('data-person-id') + ':' + chip.getAttribute('data-identity-id') : pp ? 'r:' + pp.getAttribute('data-person-person-id') : null
		if (key === hoverKey) return
		hoverKey = key
		clear()
		if (chip) personFocus(chip)
		else if (pp) personPersonFocus(pp)
	})
	svg.addEventListener('mouseleave', function () { hoverKey = null; clear() })
})()]]></script>`

// ---- 组装独立 SVG 文档：内嵌 style.css 保证视觉一致；interactive 附加悬浮高亮（样式 + 脚本） ----
async function standaloneSvg(scope, wrap, interactive) {
	const {roots, collapsedCanvasIds, foldedIds} = scopeParams(scope)
	const c = buildCanvas(roots, {
		hiddenOrganizationKey: null, hiddenIdentityKey: null, hiddenChipKey: null,
		collapsedCanvasIds, foldedIds, controls: false, wrap,
	})
	const css = await fetch(`style.css`).then(r => r.text())
	const M = 24 // 外圈留白：阴影/加粗描边不贴边
	const W = Math.ceil(c.treeW + M * 2)
	const H = Math.ceil(c.treeH + M * 2)
	const extraCss = interactive ? EXPORT_FOCUS_CSS : ``
	const script = interactive ? EXPORT_FOCUS_SCRIPT : ``
	// CSS 注释含「<16px」这类字符，<style> 必须包 CDATA，否则整个 SVG 解析失败、图片加载报错
	// 独立 SVG 没有 <body>，style.css 的 body 字体规则不生效：根节点必须显式置字体栈，
	// 否则回到 UA 默认 sans-serif——「·」等字符宽度与测量（FONT_FAMILY）不一致，名字溢出边框
	const rootCss = `svg{font-family:${FONT_FAMILY}}`
	// 背景色与画布/PNG 一致：配置值或默认全透明（透明矩形无害，单一路径）
	const bg = store.meta.bgColor || `rgba(255, 255, 255, 0)`
	// RTL 导出的独立 SVG 脱离 <html dir> 上下文：显式带 direction，与所见一致
	const dirAttr = isRtl() ? ` direction="rtl"` : ``
	return `<svg id="lk-export" xmlns="${SVGNS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${dirAttr}><style><![CDATA[${rootCss}${css}${extraCss}]]></style>${script}<rect width="${W}" height="${H}" fill="${bg}"/><g transform="translate(${M},${M})">${c.markup}</g></svg>`
}

// ---- PNG：wrap 模式完整显示（允许换行），2 倍像素渲染保清晰 ----
async function exportPng(scope) {
	const svgText = await standaloneSvg(scope, true, false)
	await document.fonts.ready // 等字体就位，避免回退字体 rasterize
	const blob = new Blob([svgText], {type: `image/svg+xml;charset=utf-8`})
	const url = URL.createObjectURL(blob)
	try {
		const img = new Image()
		await new Promise((resolve, reject) => {
			img.onload = resolve
			img.onerror = () => reject(new Error(`导出图片加载失败`))
			img.src = url
		})
		// 画布单边上限约 16384px：大图自动降倍
		const scale = Math.min(2, 16000 / img.width, 16000 / img.height)
		const canvas = document.createElement(`canvas`)
		canvas.width = Math.max(1, Math.round(img.width * scale))
		canvas.height = Math.max(1, Math.round(img.height * scale))
		const ctx = canvas.getContext(`2d`)
		ctx.fillStyle = store.meta.bgColor || `rgba(255, 255, 255, 0)` // 背景色取库元信息配置（默认全透明）
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
		const png = await new Promise(resolve => canvas.toBlob(resolve, `image/png`))
		if (png) downloadBlob(png, exportFileName(`png`, scope))
	} finally {
		URL.revokeObjectURL(url)
	}
}

// ---- SVG：保留省略号 + <title> 悬浮全文，内嵌悬浮高亮；不做收拢展开（布局引擎无法随文件带走） ----
async function exportSvg(scope) {
	const svgText = await standaloneSvg(scope, false, true)
	downloadBlob(new Blob([svgText], {type: `image/svg+xml;charset=utf-8`}), exportFileName(`svg`, scope))
}

// kind：json / db / png-global / png-current / svg-global / svg-current（菜单开合由 controls.js 负责）
export async function runExport(kind) {
	try {
		if (kind === `json`) return await exportJson()
		if (kind === `db`) return await exportDb()
		if (kind.startsWith(`png-`)) return await exportPng(kind.slice(4))
		if (kind.startsWith(`svg-`)) return await exportSvg(kind.slice(4))
	} catch (err) {
		console.error(`导出失败`, err)
	}
}
