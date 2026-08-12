# Pixel Office Design Assets

A **design asset pack and motion demo** of a top-down pixel office — the office scene from the AI
content app "Pixel Company (Draftroom)". A 72×30 tile world, character movement, seating and
stroll rules, and a furniture editor, all running in the browser.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

- Use the top bar to switch **language** (Korean, English, Chinese, Vietnamese, Indonesian) and
  **state preview** (idle ↔ each room running).
- Click **Customize my office** to try the furniture editor: three style presets, a headcount
  slider (5–35), and a catalog of placeable furniture.

## What's inside

| Path | Contents |
|---|---|
| `src/game/office-world.ts` | The 72×30 world: rooms, walls, doors, seats, furniture, protected walkways |
| `src/OfficeWorld.tsx` | The renderer: character movement, strolling, and the furniture editor |
| `src/company.config.ts` | 19 theme color tokens, the five rooms, and the staff roster in five languages |
| `public/characters`, `public/office-assets` | Pixel sprites and furniture art (third-party — see [THIRD-PARTY.md](THIRD-PARTY.md)) |
| `design/` | Design docs: palette, floor-plan philosophy, screen principles |
| `guide/` | How this was built with Claude Code |

## Not included

The AI content features (topic analysis, idea generation, script writing) are **not** in this
repository — they live in the finished app only. This pack is the visual world and its motion.

## Rights

- The pixel art and parts of the adapted layout/movement logic come from third-party projects and
  follow their original licenses — see [THIRD-PARTY.md](THIRD-PARTY.md) and
  [`public/third-party-notices.txt`](public/third-party-notices.txt) (authoritative).
- Everything else in this repository is published for viewing and learning. Redistribution or
  commercial use requires permission.
