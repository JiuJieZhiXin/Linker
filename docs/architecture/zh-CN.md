# 架构与实现细节

本文档讲 Linker 是怎么实现的：设计目标与整体架构、数据模型、多语言机制、实时协作、前端分层与关键机制。读代码或做二次开发前先看这里，能更快建立整体图景。

配套文档：

- [API 接口文档](../api/zh-CN.md)：对外契约的全部规格——REST 端点、WebSocket 广播消息、错误码总表；前后端怎么通信以它为准
- [README](../../README.md)：产品介绍、功能清单与快速开始（只想使用回这里）

## 术语表

一行一个定义，消歧用；机制细节以正文各节为准。

| 术语 | 定义 |
|---|---|
| 组织 | 树状结构节点，可含身份与子组织（见[数据模型](#数据模型)） |
| 身份 | 组织内定义的角色（部长、会员这类），**不是职位**；跨语言翻译禁用职位类词 |
| 人物 | 全局扁平实体，通过「担任」挂到身份 |
| 担任 | 身份-人物的多对多关联（`identity_person` 行） |
| 关系 | 两个担任之间的连线（`person_person`），带 forward/backward 双向标签 |
| 指派 | 建立担任的动作；「新建并指派」= 建人物的同时建立担任 |
| 库 | 一个 `.db` 文件，即一个独立数据库，装一套完整图谱 |
| 作准语言 | 库级配置，名称的基准语言；作准槽必须非空，是回退链终点（见[多语言数据模型](#多语言数据模型)） |
| 启用语言 | 库级配置（有序列表），决定名称表单可录语种与导出 JSON 的语言列 |
| 界面语言 | 纯前端偏好，只影响显示；按库记忆、默认跟随作准语言 |
| 语言槽 | `_l10n` 附表里某语言的一列；`NULL` = 未翻译 |
| 回退链 | 显示名查找顺序：界面语言槽 → 作准语言槽 |
| 填坑 | 切换作准语言后旧记录在新作准语言下无值，下次编辑必须当场补回 |
| 乐观更新 | 界面操作先落本地缓存重绘、后台同步、失败回滚重拉 |
| 临时键 / domKey | 新建未落库对象的 Symbol 键 / `tmp-N` DOM 标识，落库后 adoptId 回赋真实 id（见[协作机制](#协作机制)） |

## 设计目标

- **零依赖**：只用 Node 内置的 `node:sqlite` + `node:http`，前端原生 ES Module 无构建步骤——clone 下来 `node server.js` 就能跑，部署没有外部面
- **多库**：`data/` 下每个 `.db` 是一个独立库，按名字懒加载并缓存连接；库与库之间完全隔离，备份/迁移就是一个文件
- **离线优先（乐观更新）**：界面操作先落本地缓存并重绘，请求在后台同步；失败自动回滚重拉，用户不被网络节奏绑架
- **协作**：REST 写入成功后经 WebSocket 向同库其他客户端广播变更，发起者按客户端 id 排除回环
- **数据多语言是一等公民**：名称没有「主语言列」概念，一律按语言分槽存储，作准语言只是回退链的终点

## 整体架构与请求生命周期

```
浏览器 ──HTTP──▶ server.js ──┬── 静态文件（public/，含首页与库页面）
                             ├── REST /:库名/api/* ──▶ db.js（写方法被 wrapDbForCollab 包装）
                             └── WS   /:库名/ws      ──▶ ws.js 广播
```

一次写操作的路径：前端 data.js 先改本地缓存并重绘（乐观），随后带 `X-Lang` / `X-Client-Id` 头发 REST 请求；服务端 `wrapDbForCollab` 包装后的 db 方法执行成功即按 `OP_BUILDERS` 映射广播变更消息（发起者除外）；前端收到广播后把远端变更镜像进本地缓存。同步失败则回滚（全量重拉），冲突不做合并——同一资源的并发写以最后一次为准。

## 数据模型

主键一律 UUID 且由后端生成。主表只存结构与外键，**所有名称在 `_l10n` 附表**（作准槽保证非空，见下节）。

### 表清单

| 表 | 列 | 说明 |
|---|---|---|
| `organization` | `id` PK · `parent_id` 自引用 · `created_at` · `sort_order` | 组织树节点 |
| `identity` | `id` PK · `organization_id` → organization · `created_at` · `sort_order` | 组织内的身份 |
| `person` | `id` PK · `created_at` | 人物，扁平不成树 |
| `identity_person` | `person_id`+`identity_id` 联合主键 · `created_at` · `sort_order` | 担任（多对多），排序只在身份内 |
| `person_person` | `id` PK · `a_person_id`/`a_identity_id`/`b_person_id`/`b_identity_id` · `created_at` | 关系，两端各是一个「担任」 |
| `meta` | `id` PK · `value` | 元信息键值（`authoritative_lang` / `enabled_langs` / `bg_color` 等） |
| `organization_l10n` / `identity_l10n` / `person_l10n` | `id` PK → 主表 · 各语言列 | 名称槽，一行一实体 |
| `person_person_l10n` | `id`+`type`(forward/backward) 联合主键 · 各语言列 | 关系双向标签槽 |
| `meta_l10n` | `id`（= meta 键）· 各语言列 | 显示名（display_name）的槽 |

语言列为 `zh_CN` 等列名（语言码 `-` 换 `_`），`NULL` = 该语言未翻译。

### 迁移与排序

- **排序字段**：`sort_order` 由迁移 `ensureSortColumn` 补到 organization / identity / identity_person（旧库按 rowid 回填）；同级顺序整体由 `reorderSiblings` 重排（改一条、重写整列，换取读取时免排序）
- **语言列演进**：`ensureL10nColumns` 为五张 l10n 附表补齐 `LANGS` 里新增的语言列——加语言不改表结构版本号，属常态演进

### 级联规则

- 删除人物：清全部担任与以其为端点的关系
- 删除组织：缺省递推删除整棵子树；`promote=1` 时保留下级、提升到被删组织原位
- 删除身份：清担任，关系端点随迁重定向（`personPerson:retarget` 广播带全量数据）

## 多语言数据模型

三个语言概念各司其职：

| 概念 | 存哪 | 作用 |
|---|---|---|
| 作准语言 | `meta.authoritative_lang`（每库一个） | 名称的基准语言；作准槽必须非空，是显示回退链终点 |
| 启用语言 | `meta.enabled_langs`（逗号串，有序） | 决定名称表单能录哪些语言、导出 JSON 带哪些列；必含作准语言且恒在首位 |
| 界面语言 | 前端 localStorage（`linker:locale` 全局 + `linker:view:<路径>` 按库覆盖） | 只影响显示，不进数据库 |

**显示回退链**：界面语言槽 → 作准语言槽 →（空串兜底由调用方处理）。前端缓存持有全部槽，切换界面语言是纯内存重解析（`reresolveAll`），不打后端。

**写语义**：写接口统一收 `{authoritative, value, l10n}` 超集 + `X-Lang` 头——

- 新建（`createPayload`）：`authoritative` 缺省回退 `value`；作准槽最终必须非空，否则 `authoritative_required`
- 更新（`namePatch`）：`l10n` 逐槽 upsert，**空串清槽**（作准槽除外，清作准槽被拒）
- 建库时按创建者的 `X-Lang` 种子作准语言；存量库迁移时一律定为 zh-CN（一次性，已执行完毕）

**填坑规则**：切换作准语言后，旧记录在新作准语言下暂无名称（显示回退到旧作准值），下次编辑该记录必须当场补回作准值才允许保存。

表单展示形态（单输入 / 作准+当前 / 全部启用语言）由前端的「文本录入」开关决定，不影响写接口——接口契约见 [api 文档](../api/zh-CN.md)。

## 协作机制

- **乐观更新**：`data.js` 的每个 op 先改本地缓存并 `notify` 重绘，再后台 `api()`；失败时 `loadAll()` 全量重拉回滚
- **临时键（tempKey）**：新建未落库的对象用 Symbol 作 key，同时登记 `domKey`（`tmp-N` 字符串，供 DOM 属性与色值哈希用）；服务端返回真实 id 后 `adoptId` 回赋，并同步树内担任条目的 id/l10n（否则 chip 的取色与语言重解析会停在占位值）
- **广播**：`ws.js` 是 RFC 6455 子集（文本广播 + ping/pong + 心跳）；写方法 → 消息由 `OP_BUILDERS` 映射，一次写入可产生多条（如平移担任 = assign + unassign + 若干 retarget），全部 op 与字段见 [api 文档](../api/zh-CN.md)
- **冲突策略**：不做合并，last-write-wins；他人删除命中你正在编辑的对象时，强制退出编辑模式（清空模态框栈）

## 前端架构

分层数据流：`events.js`（全局事件代理）→ `controls.js` / `data.js`（动作与数据）→ `html.js`（纯函数产 HTML/SVG 文本）→ `view.js`（挂载 DOM）。渲染层无状态，状态分三类：

| 状态 | 位置 | 说明 |
|---|---|---|
| 数据缓存 `store` | `data.js` | 组织树、人物、关系、meta，全量镜像服务端 |
| 视图状态 `vs` | `view.js` | 缩放/聚焦/折叠，按库持久化到 `linker:view:<路径>` |
| 偏好设置 | `settings.js` / localStorage | 文本录入开关等纯本地偏好 |

界面词条经 `i18n.js` 查词（缺词条显示 key 本身），静态文案走 `data-i18n` 标记由 `applyStatic()` 统一切换；`head` 内联脚本在词条就绪前暂隐页面防闪烁。

## 表单与导出细节

- **名称表单形态**：由「文本录入」三选一开关决定——bare（单输入）/ dual（作准 + 当前）/ full（全部启用语言）；作准行恒排第一、加粗标出、必填不可清空；新建与作准槽为空的编辑强制显示作准行
- **标题弹窗**（库显示名）：不受文本录入开关影响，无作准概念不加粗；多语言展示时当前语言排第一，任何语言留空回退库名，输入框 placeholder 为库名值；提交不写 authoritative
- **录入校验反馈**：必填项为空 → 对应输入框红框 + 自动聚焦，底部浮出轻提示自动消退，不静默拒绝
- **导出文件名**（PNG/SVG）：`品牌名_显示名_时间戳.ext`，品牌名随界面语言；「当前」视图导出追加组织名
- **移动端**：输入框 ≥16px，防 iOS 聚焦缩放

## 错误约定

后端只回错误代码（`{error: code}`，如 `org_not_found`），错误文本由前端 l10n 词条（`error.*`）按界面语言维护；作准槽必填、禁止清空等校验的错误码为 `authoritative_required`、`authoritative_lang_invalid`。完整错误码表见 [api/zh-CN.md](../api/zh-CN.md#错误码总表)。

## 目录结构

```
server.js        HTTP 服务：多库 REST API + 静态前端 + 协作广播包装（首页零渲染，POST 失败 302 回 ?error=…）
db.js            SQLite 数据层：建表（主表 + l10n 附表）、CRUD、级联删除、VACUUM 快照、多库缓存
ws.js            极简 WebSocket 服务端（RFC 6455 子集：文本广播 + ping/pong + 心跳）
public/
  index.html     库页面骨架（头部/侧栏/画布容器，data-i18n 标记，防闪烁内联脚本）
  home.html      新建数据库首页（根路径 /，纯静态页）
  home.js        首页脚本：语言切换 + 表单错误提示（复用 i18n 框架）
  home.css       首页样式
  html.js        纯函数层：HTML/SVG 文本与坐标登记（布局、画布、面板、菜单/弹窗内容）
  view.js        视图层：DOM 挂载、视图状态（缩放/聚焦/折叠）、按库的视图记忆
  controls.js    弹出控件统一管理：右键菜单 / 导出下拉（含二级子菜单）/ 模态框（名称、关系、背景色、确认）/ 语言弹窗与启用语言叠层
  events.js      事件层：全局代理（拖拽会话、触控手势、点击路由、悬停聚焦、键盘）
  data.js        数据层：后端通信、乐观更新、临时 key 机制、数据多语言解析与重解析、远端变更镜像
  export.js      导出实现：PNG/SVG 图片组装、JSON/DB 下载、文件名
  settings.js    文本录入模式（三选一互斥必选）与名称/关系弹窗形态决策；开关存 localStorage（决定请求体形态）
  i18n.js        国际化框架：l10n 注册、t() 查词插值、localStorage 持久化、变更通知、applyStatic
  l10n/          界面语言词条（缺词条显示 key 本身，八种语言对齐同一套键）
  collab.js      协作层：WebSocket 连接/重连、远端变更分发
  style.css      样式（含移动端适配）
```
