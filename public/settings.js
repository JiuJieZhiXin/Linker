// settings.js — 文本录入模式与名称/关系弹窗形态决策
// 模式为单选三选一（互斥、必选）：ui = 仅展示界面语言 | dual = 作准≠界面时展示作准语言 | full = 展示所有语言（启用语言）
// 存 localStorage（全局，跨库互通），只决定前端发什么请求体，后端按请求体 key 分流存储；
// 模式的呈现收在语言弹窗底部（html.js 的 languageModalHtml），切换后由 chooseEntryMode 原地重刷语言弹窗
import {getLocale, onLocaleChange} from './i18n.js'
import {getAuthLang, getEnabledLangs, setLangMetaHook} from './data.js'
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

// 名称/关系弹窗形态（逻辑表：界面语言∈启用集决定单输入/双输入的当前行是否存在）：full → full；作准≠界面 且（dual / 作准槽空）→ dual；其余 → bare 或 auth
//   bare 契约 = 单输入即界面语言槽；dual 的当前行 = 界面语言槽——两者都要求界面语言在启用集内，
//   不在则退化为带标签的作准单输入（auth）：唯一可录且必填的槽就是作准槽
//   authEmpty = 记录作准槽为空：新建必空（作准值必须当场显式录入）；编辑仅出现于切换作准语言后未回填的填坑场景——
//   三者同一规则：作准槽空 + 作准≠界面 → 强制 dual 显示作准行（与所选模式无关），作准值当场补回后才允许保存
//   dual 形态由此保证 作准≠界面；标题弹窗不受模式 1 影响，多语言形态只由 full 决定（见 html.js isTitle）
export const nameModalMode = (authEmpty = false) => readMode() === `full`
	? `full`
	: (getEnabledLangs().includes(getLocale())
		? ((readMode() === `dual` || authEmpty) && getAuthLang() !== getLocale() ? `dual` : `bare`)
		: `auth`)

// 界面语言切换后：语言弹窗若开着，标签与勾选态跟随新语言
onLocaleChange(() => {
	refreshLanguageModal()
})
