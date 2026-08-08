---
name: live-design-mode
description: >
  Complete map of chai-transcribe's Live Design Mode (מצב עיצוב חי) — the in-app
  visual editor that lets a user click any element on any page and restyle it, with
  changes persisted as CSS overrides across localStorage, the cloud, and themes.
  Use this skill whenever work touches DesignModeOverlay, DesignModeProvider,
  DesignModeSaveMenu, designOverrides.ts, design overrides, element picking, the
  eyedropper, colour favourites, the save/save-as-new/publish menu, override scopes
  (element/class/global), or the interaction between themes and per-element styling —
  and also when a user reports that clicks are being swallowed, that a dropdown inside
  the design toolbar is treated as a page element, that saved styling disappeared or
  reappeared, or that styling leaked onto elements they did not intend. Consult it
  before editing any of those files: the system has several non-obvious invariants
  (event capture ordering, portal detection, selector stability, override merge order)
  that are easy to break silently.
---

# Live Design Mode

An in-app visual style editor. The user turns it on, hovers to highlight any element
on the page, clicks to select it, edits a small set of CSS properties with immediate
preview, then chooses how widely the change should apply. Changes become CSS rules
injected into a `<style>` tag, persisted locally, synced to the cloud, and optionally
baked into a theme.

Nothing here compiles into the app's source. Every change is a runtime CSS override
layered on top of whatever the components already render — which is what makes it
safe, and also what makes selector stability the central design problem.

## Reading order

`references/architecture.md` — the five moving parts and how a change flows through
them. Read this first; the rest assumes it.

`references/functions.md` — every exported function and every meaningful internal
handler, what it does, why it exists, and what breaks if you change it. This is the
detailed per-function reference.

`references/storage-and-sync.md` — the seven storage keys, the cloud column, the
merge and precedence rules, and the last-write-wins logic. Read before touching
anything that persists.

`references/known-issues.md` — behaviours that look like bugs, one that is a bug,
and the reasoning behind the ones that are intentional. Read before "fixing"
something that seems wrong.

## The shape of the system

Five files carry the whole feature:

| File | Role |
|---|---|
| `src/lib/designOverrides.ts` | Pure logic: selector computation, storage, CSS injection |
| `src/components/design-mode/DesignModeProvider.tsx` | State, cloud pull, URL flag, body class |
| `src/components/design-mode/DesignModeOverlay.tsx` | All UI and interaction (806 lines) |
| `src/components/design-mode/DesignModeSaveMenu.tsx` | Save / save-as-new / publish |
| `src/hooks/useTheme.ts` | Merges theme-owned overrides with user overrides |

The provider and overlay mount together in `src/App.tsx`; the on/off button lives in
`ThemeManager.tsx` (Settings → ערכות נושא).

## How a change flows

1. **Pick** — `mousemove` on capture draws a highlight box; `pointerdown` on capture
   selects the element and blocks the app's own handlers.
2. **Edit** — each field writes into `liveChanges`, which an effect renders into a
   dedicated `<style id="design-mode-live-preview">`. Nothing is saved yet.
3. **Scope** — the user picks element / class / global. That decides which selector
   is computed, and the change moves into the persisted override list.
4. **Persist** — `saveOverrides` writes localStorage and re-renders
   `<style id="design-mode-overrides">` with every override.
5. **Save** — the save menu either syncs the overrides to the cloud (built-in or
   community theme active) or bakes them into a custom theme and clears the list.

Understanding step 3 versus step 5 matters: step 3 already persists locally and is
already visible everywhere. Step 5 is about *where the change belongs* — floating
above all themes, or owned by one theme.

## Invariants worth protecting

**Event capture must stay on the capture phase.** The overlay listens with
`capture: true` on `mousemove`, `pointerdown`, `mousedown` and `click`, and calls
`stopImmediatePropagation`. Selection happens on `pointerdown` specifically so React's
synthetic `onClick` never runs — otherwise clicking a button to style it would also
trigger the button. Moving any of this to the bubble phase silently re-enables the
app underneath.

**Own UI must be recognised, including portals.** `isOwnUi` checks
`[data-design-mode-ui]` plus the Radix portal markers. Radix renders dropdowns,
popovers and dialogs at the document root, outside the overlay's own tree, so
without the portal selectors the design mode treats its own save menu as a page
element to be styled. Any new Radix surface inside the toolbar needs either a
`data-design-mode-ui` attribute or a matching portal selector.

**Escape is two-stage.** With an element selected, Escape deselects. With nothing
selected, Escape exits design mode. Keep both — collapsing them into one makes the
mode hard to leave without losing the selection first.

**`!important` on every declaration is deliberate.** Overrides must beat Tailwind
utility classes, which are themselves specific. Removing it makes overrides silently
lose to the component's own classes.

## When changing selector logic

`computeSelector` and `computeClassSelector` decide what a saved override actually
targets, and their output is written into storage. Changing them does not migrate
existing overrides — old rules keep their old selectors and may stop matching. If a
change is unavoidable, treat it as a storage migration, not a refactor.

The two functions embody different intentions: `computeSelector` walks up to six
ancestors building an `nth-child` path, stopping early at any `id` or `data-testid`
— it is precise but brittle against DOM reordering. `computeClassSelector` takes the
tag plus up to six of its classes — it is stable but deliberately broad, and will
match every element that shares those classes.
