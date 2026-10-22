// home.js — 新建数据库首页：🌐 界面语言弹窗 + 表单错误提示（根页面经 /~/ 加载，复用 i18n 框架与 l10n 词条）
// 服务端只负责页面与重定向（POST 失败回 /?error=…），全部文案在前端出
// 创建请求经 fetch 发出以携带 X-Lang 头：作准语言种子 = 创建者界面语言；网络失败回退原生表单提交
import {applyStatic, availableLocales, getLocale, onLocaleChange, setLocale, t} from './i18n.js'

const notice = document.getElementById(`notice`)
const createForm = document.querySelector(`form`)

createForm.addEventListener(`submit`, e => {
	e.preventDefault()
	const name = String(new FormData(createForm).get(`name`) || ``).trim()
	fetch(`/api/create`, {
		method: `POST`,
		headers: {[`Content-Type`]: `application/x-www-form-urlencoded`, [`X-Lang`]: getLocale()},
		body: new URLSearchParams({name}),
	}).then(res => {
		location.href = res.url // 302 已被 fetch 跟随：成功进 /name/，失败回 /?error=…&name=… 由本页出提示
	}).catch(() => createForm.submit()) // 网络失败回退原生提交（无 X-Lang，作准语言走服务端缺省）
})

// 🌐 界面语言弹窗：首页无库上下文，只提供界面语言单选（与库内语言弹窗同款 set-row + ✓，点行即切、原地重绘勾选）
let langMask = null

function langModalHtml() {
	const check = on => on ? `<span class="menu-check">✓</span>` : ``
	const rows = availableLocales().map(({code, name}) => `
    <div class="set-row" data-lang="${code}"><span>${esc(name)}</span>${check(code === getLocale())}</div>`).join(``)
	return `
    <div class="pop-title">${esc(t(`lang.title`))}</div>
    <div id="home-lang-modal">${rows}</div>
    <div class="btns"><button data-close="1">${esc(t(`settings.close`))}</button></div>
  `
}

function openLangModal() {
	closeLangModal()
	langMask = document.createElement(`div`)
	langMask.className = `modal-mask`
	langMask.innerHTML = `<div class="modal">${langModalHtml()}</div>`
	document.body.appendChild(langMask)
}

function closeLangModal() {
	if (langMask) {
		langMask.remove()
		langMask = null
	}
}

// 弹窗交互（事件委托）：🌐 打开；点语言行切换（勾选随 onLocaleChange→renderAll 原地重绘）；点遮罩空白/关闭收起
document.addEventListener(`click`, e => {
	if (e.target.closest && e.target.closest(`#btn-lang`)) return openLangModal()
	if (!langMask) return
	if (!langMask.contains(e.target)) return closeLangModal()
	const rowEl = e.target.closest && e.target.closest(`#home-lang-modal .set-row`)
	if (rowEl) return setLocale(rowEl.dataset.lang)
	if (e.target.closest && e.target.closest(`[data-close]`)) closeLangModal()
})

// POST 失败重定向回本页时的错误提示：?error=illegal / ?error=exists&name=<名>
// 状态从 URL 解析一次即驻留（随后清掉参数防刷新重现），语言切换后按驻留状态重渲染
const esc = s => String(s).replace(/[&<>"']/g, c => ({[`&`]: `&amp;`, [`<`]: `&lt;`, [`>`]: `&gt;`, [`"`]: `&quot;`, [`'`]: `&#39;`}[c]))

function parseNoticeState() {
	const params = new URLSearchParams(location.search)
	const kind = params.get(`error`)
	const name = (params.get(`name`) || ``).trim()
	if (kind === `exists` && name) return {kind, name}
	if (kind === `illegal`) return {kind, name: ``}
	return null
}

const noticeState = parseNoticeState()

function renderNotice() {
	if (!noticeState) return
	if (noticeState.kind === `exists`) {
		const name = esc(noticeState.name)
		notice.innerHTML = `<p class="notice">${esc(t(`home.errExists`))}：<a href="/${name}/">/${name}/</a></p>`
	} else {
		notice.innerHTML = `<p class="notice">${esc(t(`home.errIllegal`))}</p>`
	}
}

function renderAll() {
	applyStatic()
	renderNotice()
	if (langMask) langMask.querySelector(`.modal`).innerHTML = langModalHtml() // 弹窗开着时标题/关闭按钮/勾选随语言切换
}

renderAll()
onLocaleChange(renderAll)
if (noticeState) history.replaceState(null, ``, `/`) // 错误状态已驻留进 noticeState，清参数防刷新/分享重现
