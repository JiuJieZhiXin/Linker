# 架構與實作細節

本文檔講 Linker 是怎麼實作的：設計目標與整體架構、資料模型、多語言機制、即時協作、前端分層與關鍵機制。讀原始碼或做二次開發前先看這裡，能更快建立整體圖景。

配套文件：

- [API 介面文件](../api/zh-TW.md)：對外契約的全部規格——REST 端點、WebSocket 廣播訊息、錯誤碼總表；前後端怎麼通訊以它為準
- [README](../../README.zh-TW.md)：產品介紹、功能清單與快速開始（只想使用回這裡）

## 術語表

一行一個定義，消歧用；機制細節以正文各節為準。

| 術語 | 定義 |
|---|---|
| 組織 | 樹狀結構節點，可含身分與子組織（見[資料模型](#資料模型)） |
| 身分 | 組織內定義的角色（部長、會員這類），**不是職位**；跨語言翻譯禁用職位類詞 |
| 人物 | 全域扁平實體，透過「擔任」掛到身分 |
| 擔任 | 身分-人物的多對多關聯（`identity_person` 列） |
| 關係 | 兩個擔任之間的連線（`person_person`），帶 forward/backward 雙向標籤 |
| 指派 | 建立擔任的動作；「新增並指派」= 建人物的同時建立擔任 |
| 庫 | 一個 `.db` 檔案，即一個獨立資料庫，裝一套完整圖譜 |
| 作準語言 | 庫級設定，名稱的基準語言；作準槽必須非空，是回退鏈終點（見[多語言資料模型](#多語言資料模型)） |
| 啟用語言 | 庫級設定（有序清單），決定名稱表單可錄語種與匯出 JSON 的語言欄 |
| 介面語言 | 純前端偏好，只影響顯示；按庫記憶、預設跟隨作準語言 |
| 語言槽 | `_l10n` 附表裡某語言的一欄；`NULL` = 未翻譯 |
| 回退鏈 | 顯示名查找順序：介面語言槽 → 作準語言槽 |
| 填坑 | 切換作準語言後舊記錄在新作準語言下無值，下次編輯必須當場補回 |
| 樂觀更新 | 介面操作先落本地快取重繪、背景同步、失敗回滾重拉 |
| 臨時鍵 / domKey | 新增未落庫物件的 Symbol 鍵 / `tmp-N` DOM 識別，落庫後 adoptId 回賦真實 id（見[協作機制](#協作機制)） |

## 設計目標

- **零相依**：只用 Node 內建的 `node:sqlite` + `node:http`，前端原生 ES Module 無建置步驟——clone 下來 `node server.js` 就能跑，部署沒有外部面
- **多庫**：`data/` 下每個 `.db` 是一個獨立庫，按名字懶載入並快取連線；庫與庫之間完全隔離，備份/遷移就是一個檔案
- **離線優先（樂觀更新）**：介面操作先落本地快取並重繪，請求在背景同步；失敗自動回滾重拉，使用者不被網路節奏綁架
- **協作**：REST 寫入成功後經 WebSocket 向同庫其他用戶端廣播變更，發起者按用戶端 id 排除回環
- **資料多語言是一等公民**：名稱沒有「主語言欄」概念，一律按語言分槽儲存，作準語言只是回退鏈的終點

## 整體架構與請求生命週期

```
瀏覽器 ──HTTP──▶ server.js ──┬── 靜態檔案（public/，含首頁與庫頁面）
                             ├── REST /:庫名/api/* ──▶ db.js（寫方法被 wrapDbForCollab 包裝）
                             └── WS   /:庫名/ws      ──▶ ws.js 廣播
```

一次寫操作的路徑：前端 data.js 先改本地快取並重繪（樂觀），隨後帶 `X-Lang` / `X-Client-Id` 頭發 REST 請求；伺服端 `wrapDbForCollab` 包裝後的 db 方法執行成功即按 `OP_BUILDERS` 對應廣播變更訊息（發起者除外）；前端收到廣播後把遠端變更鏡像進本地快取。同步失敗則回滾（全量重拉），衝突不做合併——同一資源的併發寫以最後一次為準。

## 資料模型

主鍵一律 UUID 且由後端產生。主表只存結構與外鍵，**所有名稱在 `_l10n` 附表**（作準槽保證非空，見下節）。

### 表清單

| 表 | 欄 | 說明 |
|---|---|---|
| `organization` | `id` PK · `parent_id` 自參照 · `created_at` · `sort_order` | 組織樹節點 |
| `identity` | `id` PK · `organization_id` → organization · `created_at` · `sort_order` | 組織內的身分 |
| `person` | `id` PK · `created_at` | 人物，扁平不成樹 |
| `identity_person` | `person_id`+`identity_id` 聯合主鍵 · `created_at` · `sort_order` | 擔任（多對多），排序只在身分內 |
| `person_person` | `id` PK · `a_person_id`/`a_identity_id`/`b_person_id`/`b_identity_id` · `created_at` | 關係，兩端各是一個「擔任」 |
| `meta` | `id` PK · `value` | 中繼資訊鍵值（`authoritative_lang` / `enabled_langs` / `bg_color` 等） |
| `organization_l10n` / `identity_l10n` / `person_l10n` | `id` PK → 主表 · 各語言欄 | 名稱槽，一行一實體 |
| `person_person_l10n` | `id`+`type`(forward/backward) 聯合主鍵 · 各語言欄 | 關係雙向標籤槽 |
| `meta_l10n` | `id`（= meta 鍵）· 各語言欄 | 顯示名（display_name）的槽 |

語言欄為 `zh_CN` 等欄名（語言碼 `-` 換 `_`），`NULL` = 該語言未翻譯。

### 遷移與排序

- **排序欄位**：`sort_order` 由遷移 `ensureSortColumn` 補到 organization / identity / identity_person（舊庫按 rowid 回填）；同層順序整體由 `reorderSiblings` 重排（改一筆、重寫整列，換取讀取時免排序）
- **語言欄演進**：`ensureL10nColumns` 為五張 l10n 附表補齊 `LANGS` 裡新增的語言欄——加語言不改表結構版本號，屬常態演進

### 級聯規則

- 刪除人物：清全部擔任與以其為端點的關係
- 刪除組織：缺省遞推刪除整棵子樹；`promote=1` 時保留下級、提升到被刪組織原位
- 刪除身分：清擔任，關係端點隨遷重導向（`personPerson:retarget` 廣播帶全量資料）

## 多語言資料模型

三個語言概念各司其職：

| 概念 | 存哪 | 作用 |
|---|---|---|
| 作準語言 | `meta.authoritative_lang`（每庫一個） | 名稱的基準語言；作準槽必須非空，是顯示回退鏈終點 |
| 啟用語言 | `meta.enabled_langs`（逗號串，有序） | 決定名稱表單能錄哪些語言、匯出 JSON 帶哪些欄；必含作準語言且恆在首位 |
| 介面語言 | 前端 localStorage（`linker:locale` 全域 + `linker:view:<路徑>` 按庫覆蓋） | 只影響顯示，不進資料庫 |

**顯示回退鏈**：介面語言槽 → 作準語言槽 →（空字串保底由呼叫方處理）。前端快取持有全部槽，切換介面語言是純記憶體重解析（`reresolveAll`），不打後端。

**寫語義**：寫介面統一收 `{authoritative, value, l10n}` 超集 + `X-Lang` 頭——

- 新增（`createPayload`）：`authoritative` 缺省回退 `value`；作準槽最終必須非空，否則 `authoritative_required`
- 更新（`namePatch`）：`l10n` 逐槽 upsert，**空字串清槽**（作準槽除外，清作準槽被拒）
- 建庫時按建立者的 `X-Lang` 種子作準語言；存量庫遷移時一律定為 zh-CN（一次性，已執行完畢）

**填坑規則**：切換作準語言後，舊記錄在新作準語言下暫無名稱（顯示回退到舊作準值），下次編輯該記錄必須當場補回作準值才允許儲存。

表單展示形態（單輸入 / 作準+當前 / 全部啟用語言）由前端的「文字錄入」開關決定，不影響寫介面——介面契約見 [api 文件](../api/zh-TW.md)。

## 協作機制

- **樂觀更新**：`data.js` 的每個 op 先改本地快取並 `notify` 重繪，再背景 `api()`；失敗時 `loadAll()` 全量重拉回滾
- **臨時鍵（tempKey）**：新增未落庫的物件用 Symbol 作 key，同時登記 `domKey`（`tmp-N` 字串，供 DOM 屬性與色值雜湊用）；伺服端回傳真實 id 後 `adoptId` 回賦，並同步樹內擔任條目的 id/l10n（否則 chip 的取色與語言重解析會停在佔位值）
- **廣播**：`ws.js` 是 RFC 6455 子集（文字廣播 + ping/pong + 心跳）；寫方法 → 訊息由 `OP_BUILDERS` 對應，一次寫入可產生多條（如平移擔任 = assign + unassign + 若干 retarget），全部 op 與欄位見 [api 文件](../api/zh-TW.md)
- **衝突策略**：不做合併，last-write-wins；他人刪除命中你正在編輯的物件時，強制退出編輯模式（清空模態框堆疊）

## 前端架構

分層資料流：`events.js`（全域事件代理）→ `controls.js` / `data.js`（動作與資料）→ `html.js`（純函數產 HTML/SVG 文字）→ `view.js`（掛載 DOM）。渲染層無狀態，狀態分三類：

| 狀態 | 位置 | 說明 |
|---|---|---|
| 資料快取 `store` | `data.js` | 組織樹、人物、關係、meta，全量鏡像伺服端 |
| 視圖狀態 `vs` | `view.js` | 縮放/聚焦/摺疊，按庫持久化到 `linker:view:<路徑>` |
| 偏好設定 | `settings.js` / localStorage | 文字錄入開關等純本地偏好 |

介面詞條經 `i18n.js` 查詞（缺詞條顯示 key 本身），靜態文案走 `data-i18n` 標記由 `applyStatic()` 統一切換；`head` 內嵌腳本在詞條就緒前暫隱頁面防閃爍。

## 表單與匯出細節

- **名稱表單形態**：由「文字錄入」三選一開關決定——bare（單輸入）/ dual（作準 + 當前）/ full（全部啟用語言）；作準列恆排第一、加粗標出、必填不可清空；新增與作準槽為空的編輯強制顯示作準列
- **標題彈窗**（庫顯示名）：不受文字錄入開關影響，無作準概念不加粗；多語言展示時當前語言排第一，任何語言留空回退庫名，輸入框 placeholder 為庫名值；提交不寫 authoritative
- **錄入校驗回饋**：必填項為空 → 對應輸入框紅框 + 自動聚焦，底部浮出輕提示自動消退，不靜默拒絕
- **匯出檔名**（PNG/SVG）：`品牌名_顯示名_時間戳.ext`，品牌名隨介面語言；「當前」視圖匯出追加組織名
- **行動端**：輸入框 ≥16px，防 iOS 聚焦縮放

## 錯誤約定

後端只回錯誤代碼（`{error: code}`，如 `org_not_found`），錯誤文字由前端 l10n 詞條（`error.*`）按介面語言維護；作準槽必填、禁止清空等校驗的錯誤碼為 `authoritative_required`、`authoritative_lang_invalid`。完整錯誤碼表見 [api/zh-TW.md](../api/zh-TW.md)。

## 目錄結構

```
server.js        HTTP 服務：多庫 REST API + 靜態前端 + 協作廣播包裝（首頁零渲染，POST 失敗 302 回 ?error=…）
db.js            SQLite 資料層：建表（主表 + l10n 附表）、CRUD、級聯刪除、VACUUM 快照、多庫快取
ws.js            極簡 WebSocket 伺服端（RFC 6455 子集：文字廣播 + ping/pong + 心跳）
public/
  index.html     庫頁面骨架（頭部/側欄/畫布容器，data-i18n 標記，防閃爍內嵌腳本）
  home.html      新增資料庫首頁（根路徑 /，純靜態頁）
  home.js        首頁腳本：語言切換 + 表單錯誤提示（複用 i18n 框架）
  home.css       首頁樣式
  html.js        純函數層：HTML/SVG 文字與座標登記（佈局、畫布、面板、選單/彈窗內容）
  view.js        視圖層：DOM 掛載、視圖狀態（縮放/聚焦/摺疊）、按庫的視圖記憶
  controls.js    彈出控件統一管理：右鍵選單 / 匯出下拉（含二級子選單）/ 模態框（名稱、關係、背景色、確認）/ 語言彈窗與啟用語言疊層
  events.js      事件層：全域代理（拖曳工作階段、觸控手勢、點擊路由、懸停聚焦、鍵盤）
  data.js        資料層：後端通訊、樂觀更新、臨時 key 機制、資料多語言解析與重解析、遠端變更鏡像
  export.js      匯出實作：PNG/SVG 圖片組裝、JSON/DB 下載、檔名
  settings.js    文字錄入模式（三選一互斥必選）與名稱/關係彈窗形態決策；開關存 localStorage（決定請求體形態）
  i18n.js        國際化框架：l10n 註冊、t() 查詞插值、localStorage 持久化、變更通知、applyStatic
  l10n/          介面語言詞條（缺詞條顯示 key 本身，八種語言對齊同一套鍵）
  collab.js      協作層：WebSocket 連線/重連、遠端變更分發
  style.css      樣式（含行動端適配）
```
