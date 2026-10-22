# 连客

[![版本](https://img.shields.io/badge/version-0.1.0-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![协议](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![依赖](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![多语言](https://img.shields.io/badge/i18n-zh--CN%20%C2%B7%20zh--TW%20%C2%B7%20zh--HK%20%C2%B7%20en--US%20%C2%B7%20ja--JP%20%C2%B7%20ko--KR%20%C2%B7%20fr--FR%20%C2%B7%20ar--SA-orange)](public/l10n/)

**简体中文** · [臺灣繁體中文](README.zh-TW.md) · [香港繁體中文](README.zh-HK.md) · [American English](README.en-US.md) · [日本語](README.ja-JP.md) · [조선글](README.ko-KR.md) · [Français](README.fr-FR.md) · [العربية](README.ar-SA.md)

组织 · 身份 · 人物 · 关系图谱工具：谁在什么组织担任什么身份、彼此是什么关系，一图理清。

## 功能

### 组织与关系图谱

- **组织树画布**：组织按树状排布，拖拽调整层级和同级顺序
- **身份与担任**：一人可担任多个组织的多个身份；身份可排序、可整体平移到其他组织，人与关系线随迁
- **关系连线**：从人物色块拉出双向关系线（如「指挥 ⇌ 服从」）

### 多语言

- **界面语言**：界面支持八种语言切换
- **作准语言**：每个库的名称基准语言，没翻译的名称回退显示作准值
- **启用语言**：名称能录哪几种语言可配置

### 协作

- **多人实时协作**：多人同时编辑，修改即时同步到所有客户端
- **元信息**：每个库可设显示名与背景色

### 导出

- **PNG / SVG**：图片导出，各分全局与当前
- **JSON**：全量数据，包含元信息和所有启用语言下的名称
- **DB**：原始数据库文件快照，可直接做备份

## 快速开始

```bash
node server.js          # 可选 --port / --host
```

- 根路径 `/`：新建数据库首页
- `http://localhost:PORT/<库名>/`（如 `/smr/`）：进入库；已有的库直接按路径访问

## 文档

- [docs/architecture/zh-CN.md](docs/architecture/zh-CN.md)：技术架构、数据多语言存储、目录结构、错误约定
- [docs/api/zh-CN.md](docs/api/zh-CN.md)：REST API 与协作广播（WebSocket）接口文档

## 开源协议

[Apache-2.0](LICENSE)

## 作者

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## 致谢

本项目开发过程中使用了 [Kimi](https://kimi.moonshot.cn/)（月之暗面 Moonshot AI 出品的 AI 助手）辅助完成开发工作。
