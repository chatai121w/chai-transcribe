# Global Design Kit Export

Use this guide to export one reusable design kit from the active theme and apply it in any project.

## What You Can Export

From Theme Manager > Export:

- Active theme JSON (`*.theme.json`)
- Detailed scales JSON (`*.design-scales.json`)
- VS Code theme (`*.vscode-color-theme.json`)
- Global Design Kit bundle (`*.global-design-kit.json` + `*.global-design-kit.md`)
- Automatic folder export (saves a full bundle directly to a selected target folder)

## Global Bundle Contents

The global bundle is the most complete export and includes:

- Semantic colors (HSL + HEX)
- Tonal palettes (50..950)
- Gradients (page atmosphere, cards, action, sidebar, alerts)
- Typography (families, sizes, weights, line-heights)
- Spacing and density scale
- Radius scale
- Grid system (columns, gutter, margins, breakpoints)
- Shadow scale
- Motion tokens (durations + easing)
- Component mapping hints
- Portability contract for cross-project usage

## Recommended Cross-Project Workflow

1. Export `*.global-design-kit.json` and `*.global-design-kit.md` from this app.
2. In the target project, define CSS variables from `semantic` tokens first.
3. Map components using `componentHints`.
4. Apply typography, spacing, radius and shadow scales.
5. Use `gradients` as prebuilt visual presets.
6. Keep token keys stable and only override values per brand.

## Automatic Folder Export (One Click)

Use `Export Global Kit to target folder (automatic)` to save all bundle files in one action:

- `*.global-design-kit.json`
- `*.global-design-kit.md`
- `*.design-scales.json`
- `*.vscode-color-theme.json`
- `*.theme.json`

Behavior:

- On supported browsers (localhost/secure context), you choose a folder and files are written directly.
- If direct folder writing is not supported, the app falls back to normal downloads.

## VS Code Connection

Use `*.vscode-color-theme.json` for editor/workbench colors.

Optional:

- Save it inside `.vscode/themes/`
- Use your extension/theme loader flow to activate it

## Notes

- Export always uses the currently active theme.
- Run export again after any theme edits to keep the kit updated.
- JSON is source-of-truth for implementation, MD is source-of-truth for handoff/documentation.
