# Architecture

## The five parts

```
                    ThemeManager.tsx
                  (on/off button, badge)
                            │
                            ▼
   App.tsx ──▶ DesignModeProvider ──▶ DesignModeOverlay ──▶ DesignModeSaveMenu
                     │                       │                      │
                     │  state, cloud pull    │  picking, editing    │  save targets
                     ▼                       ▼                      ▼
              designOverrides.ts  ◀──────────┴──────────────────────┘
              (selectors, storage, CSS injection)
                     │
                     ▼
              useTheme.ts  (merges theme overrides + user overrides on theme change)
```

## Two `<style>` elements, two lifetimes

The system injects CSS through exactly two style tags, and keeping them distinct is
what makes preview-then-commit possible.

**`#design-mode-overrides`** — created by `applyOverridesToDom`, lives for the life of
the page, holds every committed override. Created on app boot via
`initDesignOverrides()` so saved styling is present before design mode is ever opened.
Rewritten wholesale on every change; there is no incremental patching.

**`#design-mode-live-preview`** — created when the overlay mounts, removed when it
unmounts, holds only the currently-edited element's uncommitted changes. Cleared on
every new selection, on cancel, and immediately after a scope is applied, at which
point the committed rule in the other tag takes over. If preview were written into
the committed tag, cancelling an edit would require diffing it back out.

The preview tag always targets `computeClassSelector(selectedEl)` regardless of which
scope the user will eventually choose. This is a deliberate simplification — the
preview shows the broadest likely effect, so a user who picks "element only" sees the
effect narrow rather than widen when they commit. Widening after commit would be the
unpleasant surprise.

## Ownership of a change over time

A single edit passes through three owners:

1. **`liveChanges`** (React state, overlay) — uncommitted, preview only, dies with the
   selection.
2. **`overrides`** (React state + `design_overrides_v1`) — committed, applies
   everywhere, survives reload, floats above all themes.
3. **`theme.elementOverrides`** (inside a theme object) — owned by one theme, applies
   only while that theme is active.

The save menu is the only thing that moves a change from 2 to 3, and when it does it
calls `clearAll()` — the override list is emptied because the styling now lives in the
theme. If you skip the clear, the same rules exist in both places and survive a theme
switch, which reads to the user as "I changed the theme and my old styling followed
me".

## Theme interaction

`applyThemeOverrides(theme)` in `useTheme.ts` runs on every theme change:

```js
applyOverridesToDom([...themeOverrides, ...userOverrides]);
```

Order is the precedence rule. Both sets carry `!important`, so with equal specificity
the later rule wins — user overrides beat the theme's own. That is the intended
relationship: a theme is a starting point, and the user's direct edits sit on top of
it.

Note that this function reads `design_overrides_v1` directly from localStorage rather
than through the provider. It runs during theme application, which can happen before
the provider has hydrated, so it cannot depend on provider state.

## Entry points

Design mode can be turned on two ways, and both matter:

- **The button** in `ThemeManager.tsx`, which also shows a badge with the current
  override count.
- **`?designMode=1`** in the URL, read once on provider mount. The provider also
  *writes* this parameter back into the URL when enabled, via `history.replaceState`.
  That makes the mode survive a refresh and makes a design session shareable as a
  link.

## Why the overlay renders through a portal

`createPortal(..., document.body)` puts the whole overlay outside the app's DOM tree.
Two reasons: the highlight box and floating panels need to escape any ancestor with
`overflow: hidden` or a stacking context, and the overlay must not be caught by its
own `isOwnUi` ancestor checks in a way that depends on where the app happens to mount
it.

The z-index band is deliberate: highlight box at `99998`, toolbar and editor at
`99999`. The app's own floating elements top out at `9999`, so design mode always
sits above everything it might need to style.
