# Design Scales System Guide

This document defines the design-scale model for the current UI and how to connect it to VS Code themes.

## 1) Current Core Semantic Colors (Default Theme)

| Token | HSL | HEX | Usage |
| --- | --- | --- | --- |
| background | 40 24% 94% | #f3f1ec | Main app canvas |
| foreground | 222 52% 14% | #111c36 | Main text |
| card | 40 35% 97% | #faf8f5 | Cards and surfaces |
| cardForeground | 222 52% 14% | #111c36 | Text on cards |
| popover | 40 35% 97% | #faf8f5 | Popovers and dropdowns |
| popoverForeground | 222 52% 14% | #111c36 | Text on popovers |
| primary | 223 63% 16% | #0f1e43 | Primary actions |
| primaryForeground | 43 90% 96% | #fef9ec | Text on primary |
| secondary | 40 44% 90% | #f1e9da | Secondary actions |
| secondaryForeground | 222 52% 14% | #111c36 | Text on secondary |
| muted | 40 26% 91% | #eeeae2 | Quiet zones |
| mutedForeground | 222 20% 36% | #49546e | Secondary text |
| accent | 41 72% 47% | #ce9722 | Highlights and active accents |
| accentForeground | 223 63% 16% | #0f1e43 | Text on accent |
| destructive | 0 70% 50% | #d92626 | Error and dangerous actions |
| destructiveForeground | 43 90% 96% | #fef9ec | Text on destructive |
| border | 40 40% 72% | #d4c19b | Borders and separators |
| input | 40 33% 82% | #e0d6c2 | Inputs |
| ring | 41 72% 47% | #ce9722 | Focus ring |
| sidebarBackground | 40 35% 97% | #faf8f5 | Sidebar background |
| sidebarForeground | 222 52% 14% | #111c36 | Sidebar text |
| sidebarPrimary | 223 63% 16% | #0f1e43 | Active sidebar item |
| sidebarPrimaryForeground | 43 90% 96% | #fef9ec | Text on active sidebar item |
| sidebarAccent | 40 40% 92% | #f3ede2 | Sidebar hover/accent |
| sidebarAccentForeground | 222 52% 14% | #111c36 | Text on sidebar accent |
| sidebarBorder | 40 40% 72% | #d4c19b | Sidebar borders |
| sidebarRing | 41 72% 47% | #ce9722 | Sidebar focus ring |

## 2) Scales That Are Now Exportable

The system now exports a full scales package from the active theme, including:

- Semantic tokens: full token map (HSL + HEX)
- Tonal scales: 50..950 for primary, accent, neutral, danger, border, sidebar, success, warning, info
- Gradients: atmosphere, card surface, primary action, sidebar surface, alert surface
- Typography scale: family, size ladder, line-height, weight
- Spacing scale: density-aware 4px grid
- Layout grid scale: columns, gutters, margins, container max widths
- Radius scale: normalized curve from base radius
- Shadow scale: none/soft/medium/strong
- Motion scale: durations + easing
- Component hints: semantic mapping for implementation

## 3) VS Code Integration

The export flow now supports VS Code theme generation from the active app theme.

Generated VS Code package includes:

- workbench colors (editor, sidebar, activity bar, status bar, panel, input, buttons)
- terminal ANSI palette
- token colors (comments, strings, keywords, types, functions)

## 4) How To Use In App

1. Open Theme Manager.
2. Click Export.
3. Choose one of:
   - Export detailed design scales (JSON)
   - Export VS Code theme
   - Export Global Design Kit (JSON + MD)
4. Import the generated VS Code file into your editor setup.

## 5) Recommended Next Steps

- Lock one production base palette (for consistency across modules).
- Add per-feature semantic aliases (for example: uploadStateOk, diarizationBadge, liveMicState).
- Add automatic contrast guardrails in theme save flow.
- Add a small script to sync exported VS Code theme directly into .vscode folder when needed.
