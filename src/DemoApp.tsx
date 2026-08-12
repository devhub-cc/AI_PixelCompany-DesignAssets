import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { STATUS_LABELS, THEME, WORKSPACES } from "./company.config";
import { LOCALES, LOCALE_LABELS, localized, type Locale, type LocalizedText } from "./i18n";
import { OfficeWorld } from "./OfficeWorld";
import type { WorkflowStatus } from "./game/workflow";

const themeStyle = {
  "--color-app": THEME.app,
  "--color-frame": THEME.frame,
  "--color-panel": THEME.panel,
  "--color-surface": THEME.surface,
  "--color-line": THEME.line,
  "--color-edge": THEME.edge,
  "--color-floor": THEME.floor,
  "--color-cream": THEME.cream,
  "--color-ink": THEME.ink,
  "--color-muted": THEME.muted,
  "--color-skin": THEME.skin,
  "--color-wood": THEME.wood,
  "--color-wood-dark": THEME.woodDark,
  "--color-screen": THEME.screen,
  "--color-green": THEME.green,
  "--color-amber": THEME.amber,
  "--color-red": THEME.red,
  "--color-focus": THEME.focus,
  "--color-shadow": THEME.shadow,
} as CSSProperties;

/** Demo-only copy. Product copy lives in i18n.ts and company.config.ts. */
const UI = {
  title: {
    ko: "픽셀 오피스 디자인 데모",
    en: "Pixel Office Design Demo",
    zh: "像素办公室设计演示",
    vi: "Bản demo thiết kế văn phòng pixel",
    id: "Demo desain kantor piksel",
  },
  preview: {
    ko: "상태 미리보기",
    en: "State preview",
    zh: "状态预览",
    vi: "Xem trước trạng thái",
    id: "Pratinjau status",
  },
  clock: {
    ko: "데모 화면",
    en: "Demo view",
    zh: "演示画面",
    vi: "Màn hình demo",
    id: "Tampilan demo",
  },
  note: {
    ko: "이 저장소는 디자인·움직임 데모입니다. AI 콘텐츠 생성 기능은 포함되어 있지 않습니다.",
    en: "This repository is a design and motion demo. No AI content features are included.",
    zh: "本仓库仅为设计与动作演示，不包含 AI 内容生成功能。",
    vi: "Kho này chỉ là bản demo thiết kế và chuyển động, không kèm tính năng AI.",
    id: "Repositori ini hanya demo desain dan gerakan, tanpa fitur konten AI.",
  },
} satisfies Record<string, LocalizedText>;

export function DemoApp() {
  const [locale, setLocale] = useState<Locale>("ko");
  const [activeId, setActiveId] = useState<string | null>(null);

  const workspaceStatuses = useMemo(() => {
    const map: Record<string, WorkflowStatus> = {};
    for (const workspace of WORKSPACES) {
      map[workspace.id] = workspace.id === activeId ? "running" : "idle";
    }
    return map;
  }, [activeId]);

  return (
    <div className="app-shell demo-shell" data-draftroom-shell="" style={themeStyle}>
      <header className="demo-bar">
        <strong>{localized(UI.title, locale)}</strong>
        <select
          aria-label="language"
          onChange={(event) => setLocale(event.target.value as Locale)}
          value={locale}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </select>
        <span className="demo-preview-label">{localized(UI.preview, locale)}</span>
        <div className="demo-states">
          <button
            className={activeId === null ? "on" : ""}
            onClick={() => setActiveId(null)}
            type="button"
          >
            {localized(STATUS_LABELS.idle, locale)}
          </button>
          {WORKSPACES.map((workspace) => (
            <button
              className={activeId === workspace.id ? "on" : ""}
              key={workspace.id}
              onClick={() => setActiveId(workspace.id)}
              type="button"
            >
              {localized(workspace.name, locale)}
            </button>
          ))}
        </div>
      </header>

      <div className="workspace-layout demo-layout">
        <section className="office-panel" data-pane="office">
          <OfficeWorld
            activeWorkspaceId={activeId}
            clock={{ label: localized(UI.clock, locale), time: "--:--" }}
            locale={locale}
            officeEvents={[]}
            ready={true}
            workflowStatus={activeId ? "running" : "idle"}
            workspaceStatuses={workspaceStatuses}
          />
        </section>
      </div>

      <footer className="demo-foot">{localized(UI.note, locale)}</footer>
    </div>
  );
}
