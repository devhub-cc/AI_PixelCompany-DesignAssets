# Pixel Office Design Assets

한국어 · English · 简体中文

탑다운 픽셀 오피스의 **디자인 자산과 움직임 데모**입니다. AI 콘텐츠 제작 앱 "픽셀 컴퍼니(Draftroom)"의
사무실 화면 — 72×30 타일 월드, 캐릭터 이동, 좌석·산책 규칙, 가구 편집 — 을 브라우저에서 그대로
움직여 볼 수 있습니다.

A **design asset pack and motion demo** of a top-down pixel office — the office scene of the AI
content app "Pixel Company (Draftroom)": a 72×30 tile world, character movement, seating and
stroll rules, and a furniture editor, all running in the browser.

自上而下像素办公室的**设计资源与动作演示**。这是 AI 内容制作应用「像素公司(Draftroom)」的办公室
画面：72×30 瓦片世界、角色移动、座位与漫步规则、家具编辑器，都可以直接在浏览器中运行。

## 실행 / Run / 运行

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173 를 엽니다. / Open http://localhost:5173. / 在浏览器打开 http://localhost:5173。

- 상단에서 **언어(5개)** 와 **상태 미리보기**(대기 ↔ 각 방 실행 중)를 바꿀 수 있습니다.
- Use the top bar to switch **language (5)** and **state preview** (idle ↔ each room running).
- 顶部可切换**语言（5 种）**和**状态预览**（待机 ↔ 各房间运行中）。

## 들어 있는 것 / What's inside / 包含内容

| 경로 / Path | 내용 / Contents / 内容 |
|---|---|
| `src/game/office-world.ts` | 72×30 월드: 방·벽·문·좌석·가구·보호 통로 / world, rooms, seats, furniture / 世界与房间座位家具 |
| `src/OfficeWorld.tsx` | 캐릭터 이동·산책·가구 편집기 렌더러 / movement + furniture editor renderer / 移动与家具编辑渲染器 |
| `src/company.config.ts` | 테마 19색 토큰·5개 공간·직원 명단 / 19 theme tokens, 5 rooms, staff roster / 主题色与空间名册 |
| `public/characters`, `public/office-assets` | 픽셀 스프라이트·가구 이미지 (제3자, [THIRD-PARTY.md](THIRD-PARTY.md)) |
| `design/` | 팔레트·평면·화면 원칙 문서 / design docs / 设计文档 |
| `guide/` | Claude Code로 만든 과정 / how it was built with Claude Code / 用 Claude Code 构建的过程 |

## 없는 것 / Not included / 不包含

AI 콘텐츠 생성 기능(주제 분석·아이디어·대본)은 이 저장소에 없습니다. 그 기능은 완성 앱에만 있습니다.
The AI content features (topic analysis, ideas, scripts) are not in this repository — they live in the
finished app only. / AI 内容生成功能（主题分析、创意、脚本）不在本仓库中，仅存在于成品应用。

## 권리 / Rights / 权利

- 픽셀 아트와 일부 레이아웃·이동 로직은 제3자 자산의 원본·개작입니다 — 출처와 라이선스는
  [THIRD-PARTY.md](THIRD-PARTY.md)와 `public/third-party-notices.txt`(원문)를 따릅니다.
- 그 외 이 저장소의 코드·문서·구성은 열람과 학습 목적으로 공개합니다. 별도 허가 없는 재배포·상업적
  이용은 허용하지 않습니다.
- Third-party pixel art and adapted layout/movement logic follow their original licenses — see
  [THIRD-PARTY.md](THIRD-PARTY.md). Everything else is published for viewing and learning;
  redistribution or commercial use requires permission.
- 第三方像素素材及改编的布局/移动逻辑遵循其原始许可证（见 [THIRD-PARTY.md](THIRD-PARTY.md)）。
  其余代码与文档仅供浏览学习，未经许可请勿再分发或商用。
