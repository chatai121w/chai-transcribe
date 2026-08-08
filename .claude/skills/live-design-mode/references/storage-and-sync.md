# Storage and sync

## Every key the feature owns

| Key | Holds | Written by |
|---|---|---|
| `design_overrides_v1` | The committed override list — the real payload | `saveOverrides` |
| `design_mode_editor_layout_v1` | Editor panel size, position, minimised | `saveEditorLayout` |
| `design_mode_color_favorites_v1` | Up to 12 recent colours | `pushColorFavorite`, delete handlers |
| `design_mode_toolbar_pos_v1` | Floating toolbar position | toolbar effect |
| `design_mode_click_through_v1` | `'1'` when free-navigation is on | click-through effect |
| `app_theme_id` | Active theme id | `useTheme` |
| `app_custom_themes` | Custom themes, each possibly carrying `elementOverrides` | `useTheme` |

Only the first and the last two affect appearance. The middle four are UI ergonomics
and are safe to clear when debugging.

Cloud side, both columns on `user_preferences`:

| Column | Holds |
|---|---|
| `design_overrides` | The global override list (JSONB) |
| `custom_themes` | Custom themes as a JSON string, including their baked overrides |

## Precedence, end to end

For a given element, the winning declaration is decided in this order — later beats
earlier, since every rule carries `!important` and equal specificity:

1. The component's own classes (Tailwind, CSS modules)
2. Theme CSS variables applied to `:root`
3. `theme.elementOverrides` — injected first into `#design-mode-overrides`
4. `design_overrides_v1` — injected second, so it beats the theme
5. `#design-mode-live-preview` — a later stylesheet in `<head>`, so it beats
   everything while an edit is in progress

The practical reading: **user overrides always beat the theme, and preview always
beats both.** That ordering is what makes a theme feel like a starting point rather
than a cage.

## Last-write-wins, and its limits

Cloud reconciliation happens once, when the user id becomes known:

```js
const cloudMax = Math.max(0, ...cloud.map(o => o.createdAt || 0));
const localMax = Math.max(0, ...local.map(o => o.createdAt || 0));
if (cloudMax > localMax) { saveOverrides(cloud); setOverrides(cloud); }
```

The comparison is between the newest timestamp in each **list**, and adoption replaces
the whole local list. There is no per-override merge.

Consequences worth stating plainly:

- Two devices editing different elements do not combine. The device whose newest edit
  is later wins entirely; the other device's work is replaced on its next load.
- Local edits made while signed out are preserved as long as they are newer than
  whatever is in the cloud.
- Ties favour local, since the test is strictly greater-than.

This is a reasonable choice for personal styling and a poor one for collaboration.
If multi-device editing ever matters, the fix is per-override merging keyed on `id`,
not a change to this comparison.

## Two different meanings of "save"

This is the most common source of confusion, and worth being precise about.

**Applying a scope** (the three buttons in the editor) already saves. The change is in
localStorage, injected into the page, and visible on every page immediately. Nothing
further is required for it to persist across reloads on that device.

**The Save menu** decides *ownership*:

- *"שמור שינויים (גלובלי + ענן)"* — appears when a built-in or community theme is
  active. Pushes the overrides to the cloud so they follow the user across devices.
  They remain global: they apply on top of whatever theme is active, now and later.
- *"שמור (דרוס את הערכה הפעילה)"* — appears when a custom theme is active. Moves the
  overrides into that theme and empties the global list. They now apply only while
  that theme is selected.
- *"שמור כערכה חדשה"* — same, into a newly created theme, which is then activated.

So the question the menu answers is not "should this persist" but "should this belong
to a theme or float above all of them".

## Clearing state safely

Ordered from least to most destructive:

```js
// panel/toolbar ergonomics only — appearance untouched
localStorage.removeItem('design_mode_editor_layout_v1');
localStorage.removeItem('design_mode_toolbar_pos_v1');
localStorage.removeItem('design_mode_click_through_v1');

// drop saved colours
localStorage.removeItem('design_mode_color_favorites_v1');

// drop all global overrides — prefer the in-app "נקה הכל", which also
// clears the injected stylesheet in the same step
localStorage.removeItem('design_overrides_v1');
```

Removing `design_overrides_v1` by hand leaves the already-injected `<style>` in place
until reload; the in-app clear path calls `applyOverridesToDom([])` as well. And note
that clearing locally does not clear the cloud copy — the next sign-in may pull it
straight back, which reads as "the styling I deleted came back".

Overrides baked into a custom theme are not touched by any of the above. Those live
in `app_custom_themes` and in the cloud `custom_themes` column, and are removed by
editing or deleting the theme.
