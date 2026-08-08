# Function reference

Every exported function and every meaningful internal handler, grouped by file.

- [designOverrides.ts](#designoverridests) — selectors, storage, CSS injection
- [DesignModeProvider.tsx](#designmodeprovidertsx) — state and cloud
- [DesignModeOverlay.tsx](#designmodeoverlaytsx) — layout, picking, editing, colours
- [DesignModeSaveMenu.tsx](#designmodesavemenutsx) — save targets
- [useTheme.ts](#usethemets) — the merge

---

## designOverrides.ts

The only file with no React in it. Everything here is pure except the DOM writes.

### `DesignOverride` (type)

```ts
{ id: string; scope: 'element'|'class'|'global'; selector: string;
  label?: string; css: Record<string,string>; createdAt: number }
```

`createdAt` is not decoration — it is the conflict resolution key for cloud sync.
`scope` is stored but never read when generating CSS; it exists for display and for
future logic.

### `computeSelector(el): string`

Builds a **precise** selector for one element.

1. If the element has an `id`, return `#id` and stop. Ids are unique and stable.
2. Otherwise if it has `data-testid`, return the attribute selector and stop. Test
   ids are chosen by developers and survive refactors.
3. Otherwise walk up to six levels toward `body`, prepending
   `tagname:nth-child(N)` at each step, stopping early if any ancestor has an `id`
   or `data-testid` — anchoring to a stable ancestor shortens the path and makes it
   more robust.

The six-level cap is a tradeoff: deep enough to disambiguate, shallow enough that the
selector does not encode the entire page structure. The weakness is inherent —
`nth-child` breaks when siblings are added, removed or reordered, which happens
constantly in a React app with conditional rendering. An override that "stopped
working" after a UI change almost always has an `nth-child` path in it.

### `computeClassSelector(el): string`

Builds a **broad** selector: the tag plus up to six of its classes.

Filters applied, and why:
- drops `hover:` and `focus:` prefixed classes — Tailwind variants describe states,
  not identity, and including them produces selectors that never match at rest;
- drops classes longer than 40 characters — those are arbitrary-value Tailwind
  classes like `w-[calc(100%-2rem)]`, unstable and full of characters that fight the
  selector syntax;
- caps at six classes — more would make the selector so specific it stops being a
  "same kind of thing" selector, which is the whole point.

Returns just the tag when nothing survives filtering. That is very broad — styling
`div` this way hits every div on the page — and is worth guarding against if you
extend this.

### `describeElement(el): string`

Human label, e.g. `button#save.btn.primary`. Tag, id if present, first two classes.
Display only; never used for matching.

### `loadOverrides() / saveOverrides(list)`

Read and write `design_overrides_v1`. `saveOverrides` also calls
`applyOverridesToDom`, so persisting and applying can never drift apart — there is no
code path that saves without applying.

Both swallow errors. localStorage throws in private browsing and when quota is full;
design mode failing loudly there would block the whole app.

### `applyOverridesToDom(list)`

Finds or creates `<style id="design-mode-overrides">` and replaces its entire
contents:

```css
<selector> {
  <prop>: <value> !important;
}
```

Full rewrite rather than incremental patching — with a list this small it is simpler
and immune to drift between the list and the DOM.

`!important` on every declaration is required, not stylistic: overrides compete with
Tailwind utilities that often have equal or higher specificity. Without it, an
override on a `.text-sm` element silently loses.

### `initDesignOverrides()`

Applies stored overrides at boot. Called from the provider's mount effect so saved
styling is on screen before design mode has ever been opened.

---

## DesignModeProvider.tsx

### `DesignModeProvider`

Holds `enabled` and `overrides`, and runs four effects:

**Mount** — `initDesignOverrides()`, hydrate `overrides` from localStorage, and
enable design mode if `?designMode=1` is present.

**Cloud pull** (on `user.id`) — read `user_preferences.design_overrides`. Adopt the
cloud copy only if its newest `createdAt` is greater than the local newest. This is
last-write-wins at list granularity, not per-override merging: two devices editing
different elements will not merge, the newer list wins outright. Acceptable for
single-user styling, and worth knowing before assuming a merge exists.

**Body class** — toggles `design-mode-active` on `document.body`. Note that no CSS
in the project currently targets this class; it exists as a styling hook for cursor
changes and interaction blocking. Removing it would be safe today but would remove
the hook.

**URL sync** — writes `?designMode=1` via `replaceState` when enabled, so the mode
survives refresh and the session is shareable.

### `addOverride(o)`

Appends with a generated `id` and `createdAt: Date.now()`, then persists. Append-only
— there is no edit-in-place. Restyling the same element twice produces two entries,
and the later one wins by source order in the stylesheet. This makes undo trivial
(drop the last entry) at the cost of list growth.

### `undoLast()` / `clearAll()`

`undoLast` drops the last entry and persists. `clearAll` persists an empty list *and*
calls `applyOverridesToDom([])` explicitly — belt and braces, since `saveOverrides`
already applies.

### `useDesignMode()`

Throws outside the provider rather than returning null. A silent null here would turn
into a confusing crash deeper in the overlay.

---

## DesignModeOverlay.tsx

The largest file. Grouped by concern.

### Layout persistence

`loadToolbarPos` / `loadEditorLayout` / `saveEditorLayout` / `fitLayoutToViewport` /
`getDefaultEditorLayout` / `clamp`

Every load path passes through `fitLayoutToViewport`, which clamps size and position
into the current window with an 8px margin and enforces minimums (360×320). This is
the defence against a panel restored off-screen after the user moves to a smaller
display — without it a saved layout from a large monitor becomes unreachable.

A `resize` listener re-runs the fit, so the panel follows the window rather than
disappearing off its edge.

### Colour favourites

`loadColorFavorites` / `pushColorFavorite` / `deleteFavorite` /
`deleteSelectedFavorites` / `toggleFavSelection` / `saveCurrentColorsToFavorites`

A most-recently-used list capped at 12. `pushColorFavorite` lowercases and dedupes
before unshifting, so re-picking an existing colour promotes it rather than
duplicating.

Favourites are captured automatically whenever a scope is applied, on the theory that
a colour good enough to commit is worth keeping. `saveCurrentColorsToFavorites` is
the manual path, and falls back to the selected element's *computed* colours when
there are no pending changes — letting the user harvest an existing colour from the
page without editing anything.

### `rgbToHex(rgb)`

`getComputedStyle` returns `rgb()` / `rgba()`; `<input type="color">` requires hex.
Regex-parses the first three channels, drops alpha. Returns `null` on no match, which
callers treat as "unknown colour".

### Element picking (the capture-phase effect)

The core interaction. Disabled entirely when `clickThrough` is on.

`resolveElementTarget(target)` — normalises an `EventTarget` to an `Element`,
climbing from a text node to its parent. Without this, hovering text inside a button
yields a text node and the highlight fails.

`isOwnUi(target)` — true for the overlay's own UI, matched via:

```
[data-design-mode-ui], [data-radix-popper-content-wrapper],
[role="menu"], [role="dialog"], [data-radix-portal]
```

The first covers the overlay tree. The rest exist because Radix renders dropdowns,
popovers and dialogs into portals at the document root, outside the overlay — without
them, opening the save menu inside design mode makes design mode try to style its own
menu. **Any new Radix surface added to the toolbar needs coverage here.**

Returns `true` for non-Element targets — failing safe, since an unidentifiable target
is more likely part of the chrome than a page element worth styling.

`onMove` — draws the highlight rect, sets the label, and reads computed background
and text colour for the two swatches shown in the label.

`blockEvent(e)` — `preventDefault` + `stopPropagation` + `stopImmediatePropagation`.
The third is the important one: it stops other listeners on the *same* element, which
plain `stopPropagation` does not.

`onPointerDown` — selection. Runs on `pointerdown` rather than `click` so React's
synthetic click never fires; selecting a button must not also press it. Holding
Ctrl/Cmd bypasses design mode entirely, leaving an escape hatch for interacting with
the app without leaving the mode. On selection it un-minimises the panel, clears the
previous preview and `liveChanges`, bumps `selectionKey`, and records the click point.

`selectionKey` is passed as a React `key` to the input fields, forcing a remount so
they show the newly selected element's values instead of retaining the previous
element's input state.

`swallow` — mounted on `mousedown` and `click` to absorb anything `onPointerDown`
did not, so no app handler fires from a design-mode click.

`onKey` — Escape deselects, or exits if nothing is selected. Ctrl/Cmd+Z calls
`undoLast`.

### Live preview effect

Rebuilds `#design-mode-live-preview` from `liveChanges` on every keystroke, always
using `computeClassSelector`. Empty changes or no selection clears it.

### Panel positioning effect

Places the editor beside the click point (right, flipping left if it would overflow),
falling back to the element's bounding rect. Deliberately excludes `editorSize` from
its dependencies — including it would make the panel jump every time the user
resizes it.

### `applyScope(scope)`

Commits. Chooses the selector:

```js
scope === 'element' ? computeSelector(el) : computeClassSelector(el)
```

then calls `addOverride`, harvests colours into favourites, clears the preview and
`liveChanges`, and deselects.

Note that `'class'` and `'global'` produce an identical selector — see
`known-issues.md`.

### `handleEyeDropper(property)`

Uses the native `EyeDropper` API to sample any pixel on screen, including outside the
browser. Feature-detected, with a three-second Hebrew error for unsupported browsers
(Firefox and Safari). A rejected promise means the user pressed Escape and is
swallowed silently. Bumps `selectionKey` afterwards so the colour input remounts and
displays the picked value.

### `closeEditor()`

Clears preview, `liveChanges`, and selection — the cancel path.

### `EDITABLE_FIELDS`

Seven properties: `color`, `background-color`, `border-color` (colour pickers), plus
`font-size`, `font-weight`, `border-radius`, `padding` (free text with placeholders).
Extending this list is the natural way to add capability; nothing else needs to
change, since the whole pipeline is property-agnostic.

---

## DesignModeSaveMenu.tsx

Three destinations for the current overrides.

### `syncGlobalOverridesToCloud(userId, overrides, attempt)`

Upserts into `user_preferences.design_overrides`. Retries up to four times with
linear backoff (1.5s, 3s, 4.5s). Returns a boolean rather than throwing, so the
caller can show an accurate toast instead of a generic failure.

### `handleSave()`

Branches on what kind of theme is active:

- **Built-in or community theme active** → the user cannot own that theme, so the
  overrides stay global: already saved locally, now synced to the cloud in the
  background with an honest toast for each outcome (synced / local-only / not signed
  in).
- **Custom theme active** → bake the overrides into that theme's `elementOverrides`,
  persist locally and to the cloud, then `clearAll()`. The styling now belongs to the
  theme, so leaving copies in the global list would make it follow the user to other
  themes.

### `handleSaveAsNew()`

Prompts for a name, clones the active theme with a fresh id, attaches the current
overrides, saves, activates it, and clears. This is the path that turns a styling
session into a reusable theme.

### `handlePublish()`

Admin only, double-checked in the handler rather than relying on the hidden menu item.
Publishes the active theme — with pending overrides folded in — to `community_themes`
for all users.

---

## useTheme.ts

### `applyThemeOverrides(theme)`

```js
applyOverridesToDom([...themeOverrides, ...userOverrides]);
```

Runs on every theme change. Reads `design_overrides_v1` straight from localStorage
because it may run before the provider hydrates. Array order is the precedence rule:
user overrides come last and therefore win.
