# 링커

[![버전](https://img.shields.io/badge/version-0.2.1-brightgreen)](https://github.com/JiuJieZhiXin/Linker)
[![라이선스](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json)
[![의존성](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![다국어](https://img.shields.io/badge/i18n-10-orange)](public/l10n/)

**조선글** · [อักษรไทย](README.th-Thai-TH.md) · [简体中文](README.md) · [臺灣繁體中文](README.zh-Hant-TW.md) · [香港繁體中文](README.zh-Hant-HK.md) · [British English](README.en-Latn-GB.md) · [American English](README.en-Latn-US.md) · [日本語](README.ja-Jpan-JP.md) · [Français](README.fr-Latn-FR.md) · [العربية](README.ar-Arab-SA.md)

조직 · 신분 · 인물 · 관계 그래프 도구: 누가 어느 조직에서 어떤 신분을 맡고 있고 서로 어떤 관계인지, 그래프 하나로 정리합니다.

## 기능

### 조직 및 관계 그래프

- **조직 트리 캔버스**: 조직은 트리 형태로 배치되며, 드래그로 계층과 동급 순서를 조정합니다
- **신분과 보유**: 한 사람이 여러 조직의 여러 신분을 맡을 수 있고, 신분은 정렬할 수 있으며 통째로 다른 조직으로 옮길 수 있습니다. 이때 사람과 관계선도 함께 이동합니다
- **관계선**: 인물 색상 블록에서 양방향 관계선을 끌어옵니다(예: 「지휘 ⇌ 복종」)

### 다국어

- **화면 언어**: 화면은 열 가지 언어로 전환할 수 있습니다
- **기준 언어**: 각 데이터베이스의 이름 기준 언어로, 번역이 없는 이름은 기준 언어의 값으로 표시됩니다
- **사용 언어**: 이름을 어떤 언어로 입력할지 설정할 수 있습니다

### 협업

- **다인원 실시간 협업**: 여러 사람이 동시에 편집하면 수정 내용이 모든 클라이언트에 즉시 동기화됩니다
- **메타 정보**: 각 데이터베이스마다 표시 이름과 배경색을 설정할 수 있습니다

### 내보내기

- **PNG / SVG**: 이미지 내보내기로, 전체와 현재를 각각 지원합니다
- **JSON**: 전체 데이터로, 메타 정보와 사용 언어 전체의 이름을 포함합니다
- **DB**: 원본 데이터베이스 파일 스냅숏이라 바로 백업으로 쓸 수 있습니다

## 빠른 시작

```bash
node server.js          # 선택적 --port / --host
```

- 루트 경로 `/`: 새 데이터베이스 생성 홈
- `http://localhost:PORT/<데이터베이스명>/`(예: `/smr/`): 데이터베이스에 진입합니다. 기존 데이터베이스는 경로로 바로 접근할 수 있습니다

## 문서

- [docs/architecture/ko-Kore-KR.md](docs/architecture/ko-Kore-KR.md): 기술 아키텍처, 데이터 다국어 저장, 디렉터리 구조, 오류 규약
- [docs/api/ko-Kore-KR.md](docs/api/ko-Kore-KR.md): REST API와 협업 브로드캐스트(WebSocket) 인터페이스 문서

## 오픈 소스 라이선스

[Apache-2.0](LICENSE)

## 제작자

[丩卩夂忄](https://github.com/JiuJieZhiXin)

## 감사의 글

본 프로젝트는 개발 과정에서 [Kimi](https://kimi.moonshot.cn/)(월지암면 Moonshot AI가 만든 AI 어시스턴트)의 도움을 받아 개발 작업을 수행했습니다.
