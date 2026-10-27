// i18n.js — 国际化框架：l10n 资源注册、t() 查词与插值、localStorage 持久化、语言变更通知
// 语言资源在 l10n/*.js（纯数据模块，各自 export default 一份扁平词条表）；
// 当前语言缺词条时直接显示 key 本身（不回退其他语言——缺译要一眼可见）。
// 界面语言只进浏览器 localStorage（键不带库路径，各库互通），不进数据库；
// 视图收拢状态等按库分键的持久化见 view.js，两者互不干扰。
import zhCN from './l10n/zh-Hans-CN.js'
import enUK from './l10n/en-Latn-GB.js'
import enUS from './l10n/en-Latn-US.js'
import jaJP from './l10n/ja-Jpan-JP.js'
import arSA from './l10n/ar-Arab-SA.js'
import zhTW from './l10n/zh-Hant-TW.js'
import zhHK from './l10n/zh-Hant-HK.js'
import frFR from './l10n/fr-Latn-FR.js'
import koKR from './l10n/ko-Kore-KR.js'
import thTH from './l10n/th-Thai-TH.js'

const STORAGE_KEY = `linker:locale`
const FALLBACK = `zh-Hans-CN`
const RTL_LANGS = [`ar-Arab-SA`] // 从右向左书写的界面语言

const locales = new Map() // code -> {name, dict}
let current = null

export function registerLocale(code, name, dict) {
	locales.set(code, {name, dict})
}

export function availableLocales() {
	return [...locales.keys()].map(code => ({code, name: locales.get(code).name}))
}

export function getLocale() {
	return current
}

export function isRtl() {
	return RTL_LANGS.includes(current)
}

// 语言 ↔ 书写方向同步到 <html>（布局镜像由 CSS 逻辑属性与画布方向参数接管）
function applyLangDir() {
	document.documentElement.lang = current
	document.documentElement.dir = RTL_LANGS.includes(current) ? `rtl` : `ltr`
}

// t(`menu.organizationHeader`, {name})：词条里的 {name} 占位符按入参插值；缺词条显示 key 本身
export function t(key, params) {
	let s = locales.get(current)?.dict[key] ?? key
	if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m))
	return s
}

const listeners = new Set()

export function onLocaleChange(fn) {
	listeners.add(fn)
}

export function setLocale(code) {
	if (!locales.has(code) || code === current) return
	current = code
	try {
		localStorage.setItem(STORAGE_KEY, code)
	} catch (err) {
		// 隐私模式等场景下 localStorage 不可用：本次会话内语言仍然生效
	}
	applyLangDir()
	listeners.forEach(fn => fn())
}

// 启动恢复上次语言：库页优先读本库的界面语言配置（显式选择过的，存 view.js 按库配置 linker:view:<路径>），
// 无库配置回退全局键 linker:locale（= 最近一次使用过的界面语言，新建库首页的默认值），再缺回退默认。
// 键格式与 view.js 的 VIEW_STATE_KEY 保持一致（本层只读 uiLang 字段，写入仍归 view.js 的 saveViewState）
function dbConfiguredUiLang() {
	try {
		const raw = localStorage.getItem(`linker:view:` + location.pathname)
		if (!raw) return null
		const d = JSON.parse(raw)
		return d && typeof d.uiLang === `string` && locales.has(d.uiLang) ? d.uiLang : null
	} catch (err) {
		return null
	}
}

function loadInitialLocale() {
	let code = dbConfiguredUiLang() || FALLBACK
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (code === FALLBACK && stored && locales.has(stored)) code = stored // 无库配置时才沿用全局「最近使用」
	} catch (err) {
	}
	current = code
	applyLangDir()
}

// 静态文案统一切换：data-i18n（textContent）/ data-i18n-placeholder / data-i18n-title 属性标记
// 同时摘除 i18n-boot 显隐锁：index.html / home.html 的内联脚本在词条就绪前暂隐页面（防刷新闪中文），刷完即显示
export function applyStatic(root = document) {
	document.documentElement.classList.remove(`i18n-boot`)
	root.querySelectorAll(`[data-i18n]`).forEach(elm => {
		elm.textContent = t(elm.dataset.i18n)
	})
	root.querySelectorAll(`[data-i18n-placeholder]`).forEach(elm => {
		elm.placeholder = t(elm.dataset.i18nPlaceholder)
	})
	root.querySelectorAll(`[data-i18n-title]`).forEach(elm => {
		elm.title = t(elm.dataset.i18nTitle)
	})
}

registerLocale(`zh-Hans-CN`, `简体中文`, zhCN)
registerLocale(`zh-Hant-TW`, `臺灣繁體中文`, zhTW)
registerLocale(`zh-Hant-HK`, `香港繁體中文`, zhHK)
registerLocale(`en-Latn-GB`, `British English`, enUK)
registerLocale(`en-Latn-US`, `American English`, enUS)
registerLocale(`ja-Jpan-JP`, `日本語`, jaJP)
registerLocale(`ko-Kore-KR`, `조선글`, koKR)
registerLocale(`th-Thai-TH`, `อักษรไทย`, thTH)
registerLocale(`fr-Latn-FR`, `Français`, frFR)
registerLocale(`ar-Arab-SA`, `العربية`, arSA)
loadInitialLocale()
