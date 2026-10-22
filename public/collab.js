// collab.js — 协作同步：WebSocket 连接 + 远端变更分发（服务器在任意 REST 写入成功后广播）
// 远端变更只触发轻量重绘：不动缩放/聚焦/折叠/筛选等视图状态；
// 仅当删除类破坏性变更命中正在编辑的对象时，强制退出编辑模式（编辑目标见 controls.js 的 editTargetKeys）。
import {myClientId, applyRemote, affectedKeys, resync} from './data.js'
import {editTargetKeys, closeAllModals} from './controls.js'
import {t} from './i18n.js'

let ws = null
let retries = 0
let started = false

export function initCollab() {
	if (started) return
	started = true
	connect()
}

function wsUrl() {
	const proto = location.protocol === `https:` ? `wss:` : `ws:`
	const dir = location.pathname.endsWith(`/`) ? location.pathname : location.pathname + `/`
	return `${proto}//${location.host}${dir}ws?cid=${encodeURIComponent(myClientId)}`
}

function connect() {
	let sock
	try {
		sock = new WebSocket(wsUrl())
	} catch (err) {
		scheduleReconnect()
		return
	}
	ws = sock
	sock.onopen = () => {
		const wasRetry = retries > 0
		retries = 0
		// 断线期间可能漏掉广播：重连后全量重拉对齐
		if (wasRetry) resync()
	}
	sock.onmessage = ev => {
		let msg = null
		try {
			msg = JSON.parse(ev.data)
		} catch (err) {
			return
		}
		if (!msg || typeof msg.op !== `string`) return
		if (msg.clientId === myClientId) return // 自己发起的变更：乐观更新已应用，跳过回环
		// 破坏性变更（删除）：正在编辑的对象被波及时强制退出编辑模式
		const keys = affectedKeys(msg)
		if (keys && keys.size) {
			const targets = editTargetKeys()
			if (targets.some(k => keys.has(k))) {
				console.info(t(`log.editTargetDeleted`))
				closeAllModals() // 强制退出编辑：清空整个模态框栈（含叠层）
			}
		}
		// 应用到本地缓存（轻量重绘）；本地缺前置数据则全量重拉兜底
		if (!applyRemote(msg)) resync()
	}
	sock.onclose = () => {
		if (ws === sock) ws = null
		scheduleReconnect()
	}
	sock.onerror = () => {
		// 错误统一交给 onclose 走重连
	}
}

// 指数退避重连：500ms → 1s → 2s → … → 5s 封顶
function scheduleReconnect() {
	if (ws) return
	retries++
	const delay = Math.min(5000, 500 * 2 ** (retries - 1))
	setTimeout(connect, delay)
}
