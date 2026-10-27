// settings.js — 文本录入模式与名称/关系弹窗形态决策
// 模式为单选三选一（互斥、必选）：ui = 仅展示界面语言 | dual = 展示作准语言和回退语言（选项2）| full = 展示所有语言（启用语言）
// 存 localStorage（全局，跨库互通），只决定前端发什么请求体，后端按请求体 key 分流存储；
// 模式的呈现收在语言弹窗底部（html.js 的 languageModalHtml），切换后由 chooseEntryMode 原地重刷语言弹窗
import {getLocale, onLocaleChange} from './i18n.js'
import {getAuthLang, getEnabledLangs, setLangMetaHook, fallbackChainLangs} from './data.js'
import {refreshLanguageModal, refreshEnabledLayer} from './controls.js'

// 远端作准/启用语言变更且弹窗正开着：语言弹窗原地重刷勾选态；叠层勾选页也按最新状态重排
//（新作准固定首行不可取消、旧作准降为普通启用行可取消、行序随广播顺序；用户未提交的暂存编辑被远端真值覆盖）
setLangMetaHook(() => {
	refreshLanguageModal()
	refreshEnabledLayer()
})

const K_MODE = `linker:entryMode`         // 现版单选：ui | dual | full
const K1_LEGACY = `linker:advL10n1`       // 旧版双开关（互斥、可都不勾）：仅迁移读取，不再写入
const K2_LEGACY = `linker:advL10n2`

function readMode() {
	try {
		const m = localStorage.getItem(K_MODE)
		if (m === `ui` || m === `dual` || m === `full`) return m
		// 旧版双开关迁移：都不勾 = ui（即「仅展示界面语言」）；勾 1 = dual；勾 2 = full
		const a2 = localStorage.getItem(K2_LEGACY) === `1`
		const a1 = localStorage.getItem(K1_LEGACY) === `1`
		return a2 ? `full` : a1 ? `dual` : `ui`
	} catch (err) {
		return `ui`
	}
}

function writeMode(m) {
	try {
		localStorage.setItem(K_MODE, m)
	} catch (err) {
	}
}

export const entryMode = () => readMode()

// 模式选择（语言弹窗 data-act="entry-mode" 分支）：写库后原地重刷勾选态
export function chooseEntryMode(m) {
	if (m === readMode()) return
	writeMode(m)
	refreshLanguageModal()
}

// 名称/关系弹窗形态（settings.js 是唯一入口；行集真源在 data.js modalRowSet）：顺序判定，命中即返回
//   full（选项3）→ full；界面语言∈启用集：选项2（dual：展示作准语言和回退语言）在 作准≠界面 或 当前语言有其他启用链语言 时成立 → dual；
//   填坑（作准槽为空：新建恒真，编辑=切换作准语言后未回填）且 作准≠界面 → fill（仅作准+当前，不带链语言）；其余 → bare
//   界面语言∉启用集：bare/fill 契约不成立（当前语言无槽可录）；选项2 在 A 有启用的回退链语言时仍成立 → dual
//   （行集 = 作准 + A 的回退链语言，A 自身被启用集过滤——非标多语言编辑）；否则 → auth（带标签作准单输入）
//   链语言触发只服务于选项2，不得带进填坑/选项1；作准=界面时 bare 写入即回填作准槽（服务端 value 缺省回退 authoritative）
//   标题弹窗不走本函数（无作准概念）——events.js 直传 entryMode()，由 controls.js openNameModal 换算 bare/full/chain/readonly
export const nameModalMode = (authEmpty = false) => {
	if (readMode() === `full`) return `full`
	if (getEnabledLangs().includes(getLocale())) {
		if (readMode() === `dual` && (getAuthLang() !== getLocale() || fallbackChainLangs(getLocale()).length > 1)) return `dual`
		if (authEmpty && getAuthLang() !== getLocale()) return `fill`
		return `bare`
	}
	if (readMode() === `dual` && fallbackChainLangs(getLocale()).length) return `dual`
	return `auth`
}

// 界面语言切换后：语言弹窗若开着，标签与勾选态跟随新语言
onLocaleChange(() => {
	refreshLanguageModal()
})
