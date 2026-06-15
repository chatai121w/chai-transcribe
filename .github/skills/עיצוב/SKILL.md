---
name: עיצוב
description: "העבר או סנכרן את ה-Design Tuning Pack בין פרויקטים. השתמש כשמבקשים להעביר עיצוב, לסנכרן טוקנים, לשמור עקביות ויזואלית בין ריפוים. אל תשתמש ליצירת ערכת נושא חדשה — לכך קיים skill נושא."
---

# Design Tuning Pack Skill

Use this skill when the user wants cross-project visual consistency using the local tuning pack.

## Source Pack

Use files from:

- design-transfer-kit/tokens.css
- design-transfer-kit/tailwind.preset.ts
- design-transfer-kit/design-kit.json
- design-transfer-kit/tuning-controls.json
- design-transfer-kit/install-design-kit.ps1
- design-transfer-kit/COPY-STEPS.md

## When To Use

- User asks to transfer design system to another project
- User asks for quick visual baseline setup
- User asks to keep same colors/radius/density/shadows across repos
- User asks for one-folder copy workflow

## When NOT To Use

- Building a brand new app UI from scratch
- Full design overhaul unrelated to existing tokens
- Component-specific redesign that ignores token system

## Required Workflow

1. Confirm the target project path.
2. Copy the design-transfer-kit folder into target root.
3. Run install-design-kit.ps1 in target root.
4. Ensure target imports src/styles/design-tokens.css in main CSS.
5. Ensure Tailwind config uses design-transfer-kit.tailwind.preset.ts (preset or merged extend).
6. Validate light/dark + primary/accent + radius + density behavior.

## Validation Checklist

- Background/foreground colors are applied
- Primary and accent colors are mapped
- Border radius follows --radius
- Sidebar tokens resolve
- Dark mode class switches tokens correctly
- Density compact/comfortable/spacious changes spacing as expected

## Visual Reference — Light Theme Colors

| Token | HEX | Preview (HSL) |
|---|---|---|
| background | `#f3f1ec` | 40 24% 94% — warm off-white canvas |
| foreground | `#111c36` | 222 52% 14% — deep navy text |
| card | `#faf8f5` | 40 35% 97% — near-white card surface |
| primary | `#0f1e43` | 223 63% 16% — very dark navy, main actions |
| primary-foreground | `#fef9ec` | 43 90% 96% — warm cream on primary |
| secondary | `#f1e9da` | 40 44% 90% — warm sand |
| muted | `#eeeae2` | 40 26% 91% — quiet background zones |
| muted-foreground | `#49546e` | 222 20% 36% — medium slate |
| accent | `#ce9722` | 41 72% 47% — golden amber highlight |
| accent-foreground | `#0f1e43` | 223 63% 16% — navy on gold |
| destructive | `#d92626` | 0 70% 50% — red |
| border | `#d4c19b` | 40 40% 72% — warm tan |
| input | `#e0d6c2` | 40 33% 82% — light sand input |
| ring | `#ce9722` | 41 72% 47% — gold focus ring |
| sidebar-background | `#faf8f5` | same as card |
| sidebar-primary | `#0f1e43` | same as primary |
| sidebar-accent | `#f3ede2` | 40 40% 92% — hover in sidebar |

## Visual Reference — Dark Theme Colors

| Token | HEX | Preview (HSL) |
|---|---|---|
| background | `#080d19` | 220 50% 6% — near-black navy |
| foreground | `#f0ece3` | 40 20% 95% — warm white |
| card | `#0d1524` | 220 45% 9% — dark navy card |
| primary | `#1a45a3` | 220 80% 30% — bright navy |
| accent | `#2255cc` | 220 70% 40% — strong blue |
| muted | `#131c2e` | 220 35% 12% — dark muted |
| muted-foreground | `#8899bb` | 220 20% 65% — slate |
| border | `#1e2d47` | 220 35% 20% — dark border |

## Visual Reference — Typography Scale

| Step | Size | Usage |
|---|---|---|
| xs | 11px | captions, badges |
| sm | 12px | secondary labels |
| md | 14px | body default |
| lg | 16px | emphasized body |
| xl | 18px | subheadings |
| 2xl | 22px | section headings |
| 3xl | 26px | page headings |

Fonts: Assistant (default), Rubik, Heebo, Frank Ruhl Libre (serif)

## Visual Reference — Radius Scale

| Token | Pixels | Usage |
|---|---|---|
| none | 0px | sharp edges |
| xs | 3px | tiny chips |
| sm | 5px | compact elements |
| md | 8px | inputs, badges |
| lg | 12px | cards (default --radius) |
| xl | 15px | modals, popovers |
| full | 999px | pills, avatars |

## Visual Reference — Spacing Scale (comfortable density)

4px grid: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64px

## Visual Reference — Gradients

| Gradient | Description |
|---|---|
| pageAtmosphere | gold radial bottom-left + navy radial top-right over background |
| primaryAction | linear 135° from primary to ring (navy→gold) |
| accentSoft | 135° accent/18% → secondary/8% |
| cardSurface | 180° card → background (subtle depth) |
| sidebarSurface | 180° sidebarBackground → sidebarAccent/68% |
| alertSurface | 135° destructive/18% → card |

## Visual Preview File

Open `design-transfer-kit/preview.html` in any browser to see all tokens rendered visually as live color swatches, typography scale, radius samples, and shadow samples.

## Output Format

When completing this skill, report:

1. Which files were copied/created
2. Which import/config lines were added
3. What was validated
4. Any remaining manual step
