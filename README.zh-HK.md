# 連客

[![版本](https://img.shields.io/badge/version-0.1.0-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![授權條款](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![相依性](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![多語言](https://img.shields.io/badge/i18n-zh--CN%20%C2%B7%20zh--TW%20%C2%B7%20zh--HK%20%C2%B7%20en--US%20%C2%B7%20ja--JP%20%C2%B7%20ko--KR%20%C2%B7%20fr--FR%20%C2%B7%20ar--SA-orange)](public/l10n/)

**香港繁體中文** · [简体中文](README.md) · [臺灣繁體中文](README.zh-TW.md) · [American English](README.en-US.md) · [日本語](README.ja-JP.md) · [조선글](README.ko-KR.md) · [Français](README.fr-FR.md) · [العربية](README.ar-SA.md)

組織 · 身份 · 人物 · 關係圖譜工具：誰在什麼組織擔任什麼身份、彼此是什麼關係，一圖理清。

## 功能

### 組織與關係圖譜

- **組織樹畫布**：組織按樹狀排佈，拖曳調整層級與同層排序
- **身份與擔任**：一人可擔任多個組織的多個身份；身份可排序、可整體平移到其他組織，人與關係線隨遷
- **關係連線**：從人物色塊拉出雙向關係線（如「指揮 ⇌ 服從」）

### 多語言

- **介面語言**：介面支援八種語言切換
- **作準語言**：每個庫的名稱基準語言，沒翻譯的名稱回退顯示作準值
- **啟用語言**：名稱能錄哪幾種語言可配置

### 協作

- **多人即時協作**：多人同時編輯，修改即時同步到所有客戶端
- **元資訊**：每個庫可設顯示名與背景色

### 匯出

- **PNG / SVG**：圖片匯出，各分全域與當前
- **JSON**：全量資料，包含元資訊與所有啟用語言下的名稱
- **DB**：原始資料庫檔案快照，可直接做備份

## 快速開始

```bash
node server.js          # 可選 --port / --host
```

- 根路徑 `/`：新建資料庫首頁
- `http://localhost:PORT/<庫名>/`（如 `/smr/`）：進入庫；已有的庫直接按路徑存取

## 文件

- [docs/architecture/zh-HK.md](docs/architecture/zh-HK.md)：技術架構、資料多語言儲存、目錄結構、錯誤約定
- [docs/api/zh-HK.md](docs/api/zh-HK.md)：REST API 與協作廣播（WebSocket）介面文件

## 開源授權條款

[Apache-2.0](LICENSE)

## 作者

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## 致謝

本專案開發過程中使用了 [Kimi](https://kimi.moonshot.cn/)（月之暗面 Moonshot AI 出品的 AI 助理）輔助完成開發工作。
