# 連客

[![バージョン](https://img.shields.io/badge/version-0.2.0-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![ライセンス](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![依存関係](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![多言語](https://img.shields.io/badge/i18n-10-orange)](public/l10n/)

**日本語** · [简体中文](README.md) · [臺灣繁體中文](README.zh-Hant-TW.md) · [香港繁體中文](README.zh-Hant-HK.md) · [British English](README.en-Latn-GB.md) · [American English](README.en-Latn-US.md) · [조선글](README.ko-Kore-KR.md) · [อักษรไทย](README.th-Thai-TH.md) · [Français](README.fr-Latn-FR.md) · [العربية](README.ar-Arab-SA.md)

組織・身分・人物・関係グラフツール。誰がどの組織でどの身分を担い、互いにどんな関係にあるのかを、一枚の図で整理できます。

## 機能

### 組織と関係グラフ

- **組織ツリーキャンバス**：組織はツリー状に配置され、ドラッグで階層と兄弟間の順序を調整できます
- **身分と配属**：一人が複数の組織で複数の身分を担えます。身分は並べ替えられ、人物と関係線ごと別の組織へまるごと移動できます
- **関係線**：人物の色ブロックから双方向の関係線を引けます（例：「指揮 ⇌ 服従」）

### 多言語

- **表示言語**：UI は10言語に切り替えられます
- **作準言語**：各データベースの名前の基準言語です。未翻訳の名前は作準言語の値にフォールバックして表示されます
- **有効な言語**：名前をどの言語で入力できるかを設定できます

### コラボレーション

- **マルチユーザー実時間コラボレーション**：複数人が同時に編集でき、変更はすべてのクライアントに即時に同期されます
- **メタ情報**：各データベースに表示名と背景色を設定できます

### エクスポート

- **PNG / SVG**：画像をエクスポートし、全体と現在のビューがそれぞれ選べます
- **JSON**：メタ情報と、有効な言語すべての名前を含む全量データ
- **DB**：元のデータベースファイルのスナップショットで、そのままバックアップとして使えます

## クイックスタート

```bash
node server.js          # --port / --host は任意
```

- ルートパス `/`：新規データベース作成のホームページ
- `http://localhost:PORT/<データベース名>/`（例： `/smr/`）：データベースに入ります。既存のデータベースはパスで直接開けます

## ドキュメント

- [docs/architecture/ja-Jpan-JP.md](docs/architecture/ja-Jpan-JP.md)：技術アーキテクチャ、データの多言語ストレージ、ディレクトリ構成、エラーの取り決め
- [docs/api/ja-Jpan-JP.md](docs/api/ja-Jpan-JP.md)：REST API と共同編集ブロードキャスト（WebSocket）のインターフェースドキュメント

## ライセンス

[Apache-2.0](LICENSE)

## 作者

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## 謝辞

本プロジェクトの開発では、[Kimi](https://kimi.moonshot.cn/)（Moonshot AI（月之暗面）の AI アシスタント）を使用して開発作業を補助しました。
