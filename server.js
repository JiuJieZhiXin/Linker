// server.js — Node 内置 http 服务：多库 REST API + 静态前端 + WebSocket 协作广播
// 访问形式：http://host:port/<库名>/（如 /smr/），API 在 /<库名>/api/... 下
const http = require(`node:http`)
const fs = require(`node:fs`)
const os = require(`node:os`)
const path = require(`node:path`)
const {openDb, createDb, listDbNames, LANGS, DEFAULT_LANG, langCol} = require(`./db`)
const {attachCollab} = require(`./ws`)

const PUBLIC_DIR = path.join(__dirname, `public`)

// ---- 解析命令行 / 环境变量中的 host 与 port（供预览体系转发） ----
function parseArgs(argv) {
	const opts = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === `--port` || a === `-p`) opts.port = Number(argv[++i])
		else if (a.startsWith(`--port=`)) opts.port = Number(a.slice(7))
		else if (a === `--host` || a === `-h`) opts.host = argv[++i]
		else if (a.startsWith(`--host=`)) opts.host = a.slice(7)
	}
	return opts
}

const cli = parseArgs(process.argv.slice(2))
const PORT = cli.port || Number(process.env.PORT) || 37107
const HOST = cli.host || process.env.HOST || `0.0.0.0`

const MIME = {
	[`.html`]: `text/html; charset=utf-8`,
	[`.js`]: `text/javascript; charset=utf-8`,
	[`.css`]: `text/css; charset=utf-8`,
	[`.json`]: `application/json; charset=utf-8`,
	[`.svg`]: `image/svg+xml`,
	[`.png`]: `image/png`,
	[`.ico`]: `image/x-icon`,
}

function sendJson(res, status, data) {
	res.writeHead(status, {[`Content-Type`]: `application/json; charset=utf-8`})
	res.end(JSON.stringify(data))
}

function readRawBody(req) {
	return new Promise((resolve, reject) => {
		let d = ``
		req.on(`data`, c => (d += c))
		req.on(`end`, () => resolve(d))
		req.on(`error`, reject)
	})
}

async function readBody(req) {
	const d = await readRawBody(req)
	return d ? JSON.parse(d) : {}
}

// ---- 静态文件发送（库页面静态资源与根级 /~/ 公共模块共用） ----
function sendFile(res, filePath) {
	if (!filePath.startsWith(PUBLIC_DIR)) {
		res.writeHead(403)
		return res.end(`Forbidden`)
	}
	fs.readFile(filePath, (err, buf) => {
		if (err) {
			res.writeHead(404, {[`Content-Type`]: `text/plain; charset=utf-8`})
			return res.end(`404 Not Found`)
		}
		res.writeHead(200, {[`Content-Type`]: MIME[path.extname(filePath)] || `application/octet-stream`})
		res.end(buf)
	})
}

// ---- 首页（新建数据库）：public/home.html 静态页，语言切换与错误提示全在前端（home.js + i18n 框架） ----
// 服务端这里零渲染：GET / 吐静态页；POST 只按结果 302 重定向（失败回 /?error=…&name=…，文案由前端出）
function sendHome(res) {
	sendFile(res, path.join(PUBLIC_DIR, `home.html`))
}

// ---- 数据多语言：X-Lang 头解析（缺省/非法回退默认语言）与名称 patch 归一化 ----
// 约定（与 db.js/data.js 对齐）：patch = {authoritative?, value?, l10n?}
//   authoritative → 写作准语言槽（必须非空）；value → 写当前语言槽（X-Lang）；l10n → 逐语言槽 upsert（空串清空，作准槽除外）
function requestLang(req) {
	const lang = String(req.headers[`x-lang`] || ``)
	return LANGS.includes(lang) ? lang : DEFAULT_LANG
}

function namePatch(body) {
	const patch = {}
	if (body.authoritative !== undefined) patch.authoritative = String(body.authoritative).trim()
	if (body.value !== undefined) patch.value = String(body.value).trim()
	if (body.l10n && typeof body.l10n === `object`) {
		patch.l10n = {}
		for (const [k, v] of Object.entries(body.l10n)) {
			if (LANGS.includes(k)) patch.l10n[k] = String(v).trim()
		}
	}
	return patch
}

// patch 校验：authoritative 出现必须非空；三个键都没有不可；简单改名（仅 value）不允许空串
function invalidNamePatch(patch) {
	if (patch.authoritative !== undefined) return !patch.authoritative
	if (patch.value === undefined) return !patch.l10n
	return !patch.value
}

// 新建入参：authoritative = 作准语言值（缺省回退 value——单输入且界面语言即作准语言的常规场景）；
// value 写当前语言槽（X-Lang）；显式 l10n 合并非空槽；作准槽最终必须非空，否则 authoritative_required
function createPayload(body, lang, authLang) {
	const value = body.value !== undefined ? String(body.value).trim() : ``
	const authoritative = body.authoritative !== undefined ? String(body.authoritative).trim() : value
	if (!authoritative) return {error: value ? `authoritative_required` : `name_required`}
	const l10n = {}
	if (body.l10n && typeof body.l10n === `object`) {
		for (const [k, v] of Object.entries(body.l10n)) {
			const sv = String(v).trim()
			if (LANGS.includes(k) && sv) l10n[k] = sv
		}
	}
	if (value) l10n[lang] = value
	l10n[authLang] = authoritative
	return {l10n}
}

const server = http.createServer(async (req, res) => {
	const host = req.headers.host || `localhost`
	const url = new URL(req.url, `http://${host}`)
	const pathname = decodeURIComponent(url.pathname)

	try {
		// ---- 根级公共模块：首页语言切换复用 public/ 的 i18n 框架与 l10n 词条 ----
		// 用 /~ 前缀：库名只允许 \w-，~ 不会与库路由冲突
		if (pathname.startsWith(`/~/`)) {
			return sendFile(res, path.join(PUBLIC_DIR, pathname.slice(2)))
		}

		// ---- 根路径：新建数据库静态页 ----
		if (pathname === `/`) {
			return sendHome(res)
		}

		// ---- 新建数据库：成功进库；失败 302 回首页并由前端出错误提示（/?error=…&name=…） ----
		// 作准语言种子 = 创建者的界面语言（X-Lang 头）
		if (pathname === `/api/create` && req.method === `POST`) {
			const raw = await readRawBody(req)
			const ct = req.headers[`content-type`] || ``
			const body = ct.includes(`application/json`) ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))
			const name = String(body.name || ``).trim()
			if (!/^[\w-]+$/.test(name)) {
				res.writeHead(302, {Location: `/?error=illegal`})
				return res.end()
			}
			const r = createDb(name, requestLang(req))
			if (r === `exists`) {
				res.writeHead(302, {Location: `/?error=exists&name=${encodeURIComponent(name)}`})
				return res.end()
			}
			res.writeHead(302, {Location: `/${name}/`})
			return res.end()
		}

		// ---- 解析 /:name/... ----
		const seg = pathname.split(`/`).filter(Boolean)
		const dbName = seg[0]
		if (!/^[\w-]+$/.test(dbName)) {
			res.writeHead(404, {[`Content-Type`]: `text/plain; charset=utf-8`})
			return res.end(`404 Not Found`)
		}
		const subPath = seg.slice(1).join(`/`)
		const rest = seg.length > 1 ? `/${subPath}` : `/`
		const dbRaw = openDb(dbName)
		if (!dbRaw) {
			if (rest.startsWith(`/api/`)) return sendJson(res, 404, {error: `db_not_found`})
			res.writeHead(404, {[`Content-Type`]: `text/plain; charset=utf-8`})
			return res.end(`404 db_not_found`)
		}
		// 写方法包装：写入成功后向同库其他客户端广播变更（发起者按 X-Client-Id 排除，防回环）
		const clientId = String(req.headers[`x-client-id`] || ``)
		const db = wrapDbForCollab(dbRaw, payload => {
			payload.clientId = clientId
			collab.broadcast(dbName, JSON.stringify(payload), clientId)
		})
		// /name 无尾斜杠：重定向到 /name/，前端相对路径才能正确解析
		if (seg.length === 1 && !pathname.endsWith(`/`) && !rest.startsWith(`/api/`)) {
			res.writeHead(302, {Location: `/${dbName}/`})
			return res.end()
		}

		// ---- API ----
		if (rest === `/api/export/json` && req.method === `GET`) {
			const l10n = db.getL10n()
			// 导出不带未启用语言的槽：列名按启用集白名单过滤（id/type 结构列保留）
			const enabledCols = new Set(dbRaw.getEnabledLangs().map(langCol))
			for (const rows of Object.values(l10n)) {
				for (const row of rows) {
					for (const k of Object.keys(row)) {
						if (k !== `id` && k !== `type` && !enabledCols.has(k)) delete row[k]
					}
				}
			}
			return sendJson(res, 200, {
				app: `Linker 连客`,
				version: 2,
				exportedAt: new Date().toISOString(),
				meta: {
					displayName: dbRaw.getMeta(`display_name`),
					bgColor: dbRaw.getMeta(`bg_color`),
					authoritativeLang: dbRaw.getAuthoritativeLang(),
					enabledLangs: dbRaw.getEnabledLangs(),
				},
				organizations: db.getOrganizationTree(),
				persons: db.listPersons(),
				personPersons: db.listPersonPersons(),
				l10n,
			})
		}
		// 全量 l10n 槽（loadAll 一次拉取，前端按 locale↔列名映射合并后解析显示名）
		if (rest === `/api/l10n` && req.method === `GET`) {
			return sendJson(res, 200, {data: db.getL10n()})
		}
		// 导出原始库文件：VACUUM INTO 一致性快照（拷贝活动中的库文件可能截断半写页）
		if (rest === `/api/export/db` && req.method === `GET`) {
			const tmp = path.join(os.tmpdir(), `linker-db-export-${dbName}-${process.pid}-${Date.now()}.db`)
			try {
				dbRaw.exportTo(tmp)
				res.writeHead(200, {[`Content-Type`]: `application/octet-stream`})
				return res.end(fs.readFileSync(tmp))
			} finally {
				fs.rmSync(tmp, {force: true})
			}
		}
		if (rest === `/api/organizations` && req.method === `GET`) {
			return sendJson(res, 200, {data: db.getOrganizationTree()})
		}
		if (rest === `/api/organizations` && req.method === `POST`) {
			const body = await readBody(req)
			const payload = createPayload(body, requestLang(req), dbRaw.getAuthoritativeLang())
			if (payload.error) return sendJson(res, 400, {error: payload.error})
			const idx = body.index != null ? Number(body.index) : null
			const r = db.createOrganization(body.parentId ? String(body.parentId) : null, idx, payload.l10n)
			if (!r) return sendJson(res, 404, {error: `parent_not_found`})
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 201, {data: r})
		}
		if (rest === `/api/organizations/move` && req.method === `POST`) {
			const body = await readBody(req)
			const idx = body.index != null ? Number(body.index) : null
			const r = db.moveOrganization(String(body.id || ``), body.parentId ? String(body.parentId) : null, idx)
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 200, {data: r})
		}
		if (rest === `/api/organizations` && req.method === `DELETE`) {
			const ok = url.searchParams.get(`promote`) === `1`
				? db.deleteOrganizationPromote(url.searchParams.get(`id`) || ``)
				: db.deleteOrganizationCascade(url.searchParams.get(`id`) || ``)
			if (!ok) return sendJson(res, 404, {error: `org_not_found`})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/organizations/rename` && req.method === `POST`) {
			const body = await readBody(req)
			const patch = namePatch(body)
			if (patch.authoritative !== undefined && !patch.authoritative) return sendJson(res, 400, {error: `authoritative_required`})
			if (invalidNamePatch(patch)) return sendJson(res, 400, {error: `name_required`})
			const r = db.renameOrganization(String(body.id || ``), patch, requestLang(req))
			if (r.error) return sendJson(res, r.error === `org_not_found` ? 404 : 400, {error: r.error})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/identities` && req.method === `POST`) {
			const body = await readBody(req)
			const payload = createPayload(body, requestLang(req), dbRaw.getAuthoritativeLang())
			if (payload.error) return sendJson(res, 400, {error: payload.error})
			const idx = body.index != null ? Number(body.index) : null
			const r = db.createIdentity(String(body.organizationId || ``), idx, payload.l10n)
			if (!r) return sendJson(res, 404, {error: `org_not_found`})
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 201, {data: r})
		}
		if (rest === `/api/identities/move` && req.method === `POST`) {
			const body = await readBody(req)
			const r = db.moveIdentity(String(body.id || ``), Number(body.index))
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 200, {data: r})
		}
		// 身份移动到另一组织（跨组织拖拽）：只改 identity 表
		if (rest === `/api/identities/move-organization` && req.method === `POST`) {
			const body = await readBody(req)
			const idx = body.index != null ? Number(body.index) : null
			const r = db.moveIdentityToOrganization(String(body.identityId || ``), String(body.organizationId || ``), idx)
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 200, {data: r})
		}
		if (rest === `/api/identities` && req.method === `DELETE`) {
			const ok = db.deleteIdentityCascade(url.searchParams.get(`id`) || ``)
			if (!ok) return sendJson(res, 404, {error: `identity_not_found`})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/identities/rename` && req.method === `POST`) {
			const body = await readBody(req)
			const patch = namePatch(body)
			if (patch.authoritative !== undefined && !patch.authoritative) return sendJson(res, 400, {error: `authoritative_required`})
			if (invalidNamePatch(patch)) return sendJson(res, 400, {error: `name_required`})
			const r = db.renameIdentity(String(body.id || ``), patch, requestLang(req))
			if (r.error) return sendJson(res, r.error === `identity_not_found` ? 404 : 400, {error: r.error})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/persons` && req.method === `GET`) {
			return sendJson(res, 200, {data: db.listPersons()})
		}
		if (rest === `/api/persons` && req.method === `POST`) {
			const body = await readBody(req)
			const payload = createPayload(body, requestLang(req), dbRaw.getAuthoritativeLang())
			if (payload.error) return sendJson(res, 400, {error: payload.error})
			// 可选 identityId：一步「新建人物并指派」（单接口单处理，广播 person:create + assign 两条）
			if (body.identityId) {
				const idx = body.index != null ? Number(body.index) : null
				const r = db.createPersonAssign(payload.l10n, String(body.identityId), idx)
				if (r.error) return sendJson(res, r.error === `identity_not_found` ? 404 : 400, {error: r.error})
				return sendJson(res, 201, {data: r})
			}
			const r = db.createPerson(payload.l10n)
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 201, {data: r})
		}
		if (rest === `/api/persons` && req.method === `DELETE`) {
			const ok = db.deletePersonCascade(url.searchParams.get(`id`) || ``)
			if (!ok) return sendJson(res, 404, {error: `person_not_found`})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/persons/rename` && req.method === `POST`) {
			const body = await readBody(req)
			const patch = namePatch(body)
			if (patch.authoritative !== undefined && !patch.authoritative) return sendJson(res, 400, {error: `authoritative_required`})
			if (invalidNamePatch(patch)) return sendJson(res, 400, {error: `name_required`})
			const r = db.renamePerson(String(body.id || ``), patch, requestLang(req))
			if (r.error) return sendJson(res, r.error === `person_not_found` ? 404 : 400, {error: r.error})
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/assignments` && req.method === `POST`) {
			const body = await readBody(req)
			const idx = body.index != null ? Number(body.index) : null
			const r = db.assignIdentity(String(body.personId || ``), String(body.identityId || ``), idx)
			if (!r) return sendJson(res, 404, {error: `person_or_identity_not_found`})
			return sendJson(res, 200, {data: r})
		}
		if (rest === `/api/assignments` && req.method === `DELETE`) {
			db.removeAssignment(url.searchParams.get(`personId`) || ``, url.searchParams.get(`identityId`) || ``)
			return sendJson(res, 200, {ok: true})
		}
		if (rest === `/api/assignments/move` && req.method === `POST`) {
			const body = await readBody(req)
			const r = db.moveAssignment(String(body.personId || ``), String(body.identityId || ``), Number(body.index))
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 200, {data: r})
		}
		// 平移担任到同组织另一身份（拖拽人物）：关系端点随迁
		if (rest === `/api/assignments/move-identity` && req.method === `POST`) {
			const body = await readBody(req)
			const idx = body.index != null ? Number(body.index) : null
			const r = db.moveAssignmentToIdentity(String(body.personId || ``), String(body.fromIdentityId || ``), String(body.toIdentityId || ``), idx)
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 200, {data: r})
		}
		if (rest === `/api/person-persons` && req.method === `GET`) {
			return sendJson(res, 200, {data: db.listPersonPersons()})
		}
		// 关系创建：双向标签为 {authoritative?, value?, l10n?}（作准槽必填；value = 当前语言槽）
		if (rest === `/api/person-persons` && req.method === `POST`) {
			const body = await readBody(req)
			const lang = requestLang(req)
			const authLang = dbRaw.getAuthoritativeLang()
			const dirs = {}
			for (const dir of [`forward`, `backward`]) {
				const dp = body[dir]
				const slot = {}
				if (dp && typeof dp === `object`) {
					if (dp.value !== undefined) {
						const val = String(dp.value).trim()
						if (val) slot[lang] = val
					}
					// 作准值：显式 authoritative 优先，缺省回退 value（界面语言即作准语言的单输入场景）
					const auth = dp.authoritative !== undefined ? String(dp.authoritative).trim() : (slot[lang] || ``)
					if (auth) slot[authLang] = auth
					if (dp.l10n && typeof dp.l10n === `object`) {
						for (const [k, v] of Object.entries(dp.l10n)) {
							const sv = String(v).trim()
							if (LANGS.includes(k) && sv) slot[k] = sv
						}
					}
				}
				dirs[dir] = slot
			}
			if (!dirs.forward[authLang] || !dirs.backward[authLang]) {
				return sendJson(res, 400, {error: `authoritative_required`})
			}
			const r = db.createPersonPerson(
				String(body.aPersonId || ``), String(body.aIdentityId || ``),
				String(body.bPersonId || ``), String(body.bIdentityId || ``),
				dirs
			)
			if (r.error) return sendJson(res, 400, {error: r.error})
			return sendJson(res, 201, {data: r})
		}
		if (rest === `/api/person-persons` && req.method === `DELETE`) {
			db.deletePersonPerson(url.searchParams.get(`id`) || ``)
			return sendJson(res, 200, {ok: true})
		}
		// 关系标签更新：patch = {forward?: {authoritative?, value?, l10n?}, backward?: {...}}
		if (rest === `/api/person-persons/update` && req.method === `POST`) {
			const body = await readBody(req)
			const patch = {}
			for (const dir of [`forward`, `backward`]) {
				const dp = body[dir]
				if (!dp || typeof dp !== `object`) continue
				const d = {}
				if (dp.authoritative !== undefined) d.authoritative = String(dp.authoritative).trim()
				if (dp.value !== undefined) d.value = String(dp.value).trim()
				if (dp.l10n && typeof dp.l10n === `object`) {
					d.l10n = {}
					for (const [k, v] of Object.entries(dp.l10n)) {
						if (LANGS.includes(k)) d.l10n[k] = String(v).trim()
					}
				}
				patch[dir] = d
			}
			if (!patch.forward && !patch.backward) return sendJson(res, 400, {error: `name_required`})
			const r = db.updatePersonPerson(String(body.id || ``), patch, requestLang(req))
			if (r.error) return sendJson(res, r.error === `relation_not_found` ? 404 : 400, {error: r.error})
			return sendJson(res, 200, {ok: true})
		}
		// 元信息：显示名（未配置返回 null，界面回退物理库名）/ 背景色（rgba）/ 作准语言 / 启用语言
		// patch 语义：bg_color 只收 value/description（写 meta.value，空 = 删行）；
		// 文本键（display_name）：description → value；value → 当前语言槽；l10n → 逐槽；空 value 且无其他键 = 清除配置
		if (rest === `/api/meta` && req.method === `GET`) {
			return sendJson(res, 200, {data: {
				displayName: db.getMeta(`display_name`),
				bgColor: db.getMeta(`bg_color`),
				authoritativeLang: dbRaw.getAuthoritativeLang(),
				enabledLangs: dbRaw.getEnabledLangs(),
			}})
		}
		if (rest === `/api/meta` && req.method === `PUT`) {
			const body = await readBody(req)
			const key = String(body.key || ``)
			// 作准语言：库级配置（meta 表），只收 value；切换后空槽由填坑规则兜底；
			// 服务端把新作准语言自动纳入启用集并随本次切换一并广播
			if (key === `authoritative_lang`) {
				const lang = String(body.value !== undefined ? body.value : (body.description || ``)).trim()
				const r = dbRaw.setAuthoritativeLang(lang)
				if (r.error) return sendJson(res, 400, {error: r.error})
				collab.broadcast(dbName, JSON.stringify({op: `meta`, key, value: lang, clientId}), clientId)
				collab.broadcast(dbName, JSON.stringify({op: `meta`, key: `enabled_langs`, value: dbRaw.getEnabledLangs().join(`,`), clientId}), clientId)
				return sendJson(res, 200, {data: {id: key, value: lang}})
			}
			// 启用语言：库级配置（meta 表），value 收数组或逗号串；集内必含作准语言（服务端自动补）
			if (key === `enabled_langs`) {
				const r = dbRaw.setEnabledLangs(body.value !== undefined ? body.value : body.description)
				if (r.error) return sendJson(res, 400, {error: r.error})
				collab.broadcast(dbName, JSON.stringify({op: `meta`, key, value: r.langs.join(`,`), clientId}), clientId)
				return sendJson(res, 200, {data: {id: key, value: r.langs.join(`,`)}})
			}
			if (![`display_name`, `bg_color`].includes(key)) {
				return sendJson(res, 400, {error: `bad_key`})
			}
			const lang = requestLang(req)
			const patch = namePatch(body)
			const r = db.setMeta(key, patch, lang)
			if (r.error) return sendJson(res, 400, {error: r.error})
			// display_name 是纯本地化键：广播携带槽表（空串 = 清该槽）；bg_color 广播值本身
			const l10n = key === `display_name` ? (patch.l10n || {[lang]: patch.value}) : (body.l10n || null)
			collab.broadcast(dbName, JSON.stringify({op: `meta`, key, value: r.value, l10n, lang, clientId}), clientId)
			return sendJson(res, 200, {data: r})
		}
		if (rest.startsWith(`/api/`)) {
			return sendJson(res, 404, {error: `not_found`})
		}

		// ---- 静态文件 ----
		return sendFile(res, path.join(PUBLIC_DIR, rest === `/` ? `index.html` : rest))
	} catch (e) {
		console.error(e) // 诊断信息留服务端日志，响应里只回错误代码
		return sendJson(res, 500, {error: `internal_error`})
	}
})

// ---- WebSocket 协作广播：客户端连 /<库名>/ws?cid=<客户端id>，同库客户端互播变更 ----
const collab = attachCollab(server, pathname => {
	const m = /^\/([\w-]+)\/ws$/.exec(pathname)
	return m && openDb(m[1]) ? m[1] : null
})

// ---- db 写方法 → 变更消息：包装后写方法成功即广播（返回 null 表示无变更可播） ----
// 名称类变更带语言维度：authoritative（作准槽）、value（当前语言槽）、l10n（locale 键槽表）、lang（写入语言）
const OP_BUILDERS = {
	createOrganization: (a, r) => r && !r.error ? {op: `organization:create`, id: r.id, parentId: a[0], index: a[1] ?? null, l10n: a[2] || null} : null,
	moveOrganization: (a, r) => r.error ? null : {op: `organization:move`, id: a[0], parentId: a[1], index: a[2]},
	deleteOrganizationCascade: (a, r) => r && {op: `organization:delete`, id: a[0]},
	deleteOrganizationPromote: (a, r) => r && {op: `organization:delete`, id: a[0], mode: `promote`},
	renameOrganization: (a, r) => r && r.ok ? {op: `organization:rename`, id: a[0], authoritative: a[1].authoritative, value: a[1].value, l10n: a[1].l10n, lang: a[2]} : null,
	createIdentity: (a, r) => r && !r.error ? {op: `identity:create`, id: r.id, organizationId: a[0], index: a[1] ?? null, l10n: a[2] || null} : null,
	moveIdentity: (a, r) => r.error ? null : {op: `identity:move`, id: a[0], index: a[1]},
	moveIdentityToOrganization: (a, r) => r.error ? null : {op: `identity:move-organization`, id: a[0], organizationId: a[1], index: a[2]},
	deleteIdentityCascade: (a, r) => r && {op: `identity:delete`, id: a[0]},
	renameIdentity: (a, r) => r && r.ok ? {op: `identity:rename`, id: a[0], authoritative: a[1].authoritative, value: a[1].value, l10n: a[1].l10n, lang: a[2]} : null,
	createPerson: (a, r) => r && !r.error ? {op: `person:create`, id: r.id, l10n: a[0] || null} : null,
	// 一步「新建人物并指派」：对端按序收到 person:create + assign（与分两次请求的广播等价）
	createPersonAssign: (a, r) => r && !r.error ? [
		{op: `person:create`, id: r.id, l10n: a[0] || null},
		{op: `assign`, personId: r.personId, identityId: r.identityId, index: a[2] ?? null},
	] : null,
	deletePersonCascade: (a, r) => r && {op: `person:delete`, id: a[0]},
	renamePerson: (a, r) => r && r.ok ? {op: `person:rename`, id: a[0], authoritative: a[1].authoritative, value: a[1].value, l10n: a[1].l10n, lang: a[2]} : null,
	assignIdentity: (a, r) => r && {op: `assign`, personId: r.personId, identityId: r.identityId, index: a[2] ?? null},
	removeAssignment: a => ({op: `unassign`, personId: a[0], identityId: a[1]}),
	moveAssignment: (a, r) => r.error ? null : {op: `assign:move`, personId: a[0], identityId: a[1], index: a[2]},
	// 平移担任：assign + unassign + 每条随迁关系的 retarget（带全量数据，接收端整替换）
	moveAssignmentToIdentity: (a, r, db) => {
		if (r.error) return null
		const msgs = [
			{op: `assign`, personId: a[0], identityId: a[2], index: a[3] ?? null},
			{op: `unassign`, personId: a[0], identityId: a[1]},
		]
		const retargets = (r.ids || []).map(id => ({op: `personPerson:retarget`, id, data: db.getPersonPerson(id)}))
		return msgs.concat(retargets)
	},
	createPersonPerson: (a, r, db) => r.error ? null : {op: `personPerson:create`, id: r.id, data: db.getPersonPerson(r.id)},
	deletePersonPerson: a => ({op: `personPerson:delete`, id: a[0]}),
	updatePersonPerson: (a, r) => r && r.ok ? {op: `personPerson:update`, id: a[0], forward: a[1].forward, backward: a[1].backward, lang: a[2]} : null,
}

/** 包装 db 写方法：调用成功就推变更给同库其他客户端（发起者按 REST 头的 X-Client-Id 排除） */
function wrapDbForCollab(db, push) {
	const wrapped = Object.create(db)
	for (const name of Object.keys(OP_BUILDERS)) {
		const build = OP_BUILDERS[name]
		wrapped[name] = (...args) => {
			const r = db[name](...args)
			const payload = build(args, r, db)
			// 一次写入可广播多条（如平移担任 = assign + unassign + 关系端点随迁）
			const list = Array.isArray(payload) ? payload : (payload ? [payload] : [])
			list.forEach(p => push(p))
			return r
		}
	}
	return wrapped
}

server.listen(PORT, HOST, () => {
	const dbs = listDbNames().join(`, `) || `无`
	console.log(`Linker 服务已启动: http://${HOST}:${PORT}/<库名>/（现有库：${dbs}）`)
})
