# Known issues and intentional oddities

Read this before "fixing" something that looks wrong. Most of the surprising
behaviour here is deliberate. The two entries marked *Fixed* describe defects that
were real and are now closed — kept because both are easy to reintroduce.

## Fixed: "global" and "class" scopes were identical

`applyScope` used to pick the selector like this:

```js
const selector = scope === 'element'
  ? computeSelector(selectedEl)
  : computeClassSelector(selectedEl);
```

Both `'class'` and `'global'` fell into the same branch, so the two buttons produced
byte-identical CSS while the UI promised a distinction. The stored `scope` field
differed, but nothing read it when generating the stylesheet.

Now each scope has its own meaning, resolved in one place by `selectorForScope`:

| Scope | Selector | Reaches |
|---|---|---|
| element | `computeSelector` | exactly this element |
| class | `computeClassSelector` | everything with the same full class signature |
| global | `computeGlobalSelector` | everything of this kind, including variants |

The distinction that makes `global` worth having is **variants**. Class scope pins
the whole signature, so it only matches elements styled exactly the same way; global
scope drops to the element's kind, so styling one primary button reaches every
button. Measured on a real page: element 1, class 1, global 58.

`computeGlobalSelector` emits the bare tag only for tags that already say what the
element is — `button`, `a`, `input`, headings, and so on. For a generic container it
attaches one identifying class, and if the element has nothing but layout utilities
it falls back to the class signature rather than emitting a bare `div`, which would
match most of the page.

The buttons now also show how many elements each scope currently matches. That
matters because the live preview uses the class selector, so a global commit can
widen the effect past what was previewed — the count makes that visible before the
click rather than after.

## Intentional: preview is always broader than element scope

The live preview always uses `computeClassSelector`, even when the user is about to
choose "element only". Editing one card therefore previews on every similar card.

This is deliberate. Committing then narrows the effect, which is a benign surprise;
the alternative — preview narrow, commit wide — would style elements the user never
saw change. If you make preview scope-aware, make sure the scope is chosen *before*
editing, otherwise the preview has to re-render on every scope hover.

## Intentional: overrides accumulate, never update in place

Restyling the same element five times leaves five entries. The last wins by source
order. Nothing dedupes.

This is what makes undo a one-liner (`slice(0, -1)`) and keeps the model easy to
reason about. The cost is list growth over a long session and a stylesheet with dead
rules in it. Only worth changing if the list gets big enough to matter — and if it
does, dedupe on commit by `selector` + property, not by rewriting history, or undo
stops being meaningful.

## Intentional: `!important` everywhere

Removing it looks tidy and breaks the feature. Overrides compete with Tailwind
utilities of equal or higher specificity; without `!important` an override on an
element carrying `text-sm` silently loses to it.

## Fragile by nature: `nth-child` selectors

`computeSelector` falls back to an `nth-child` path when there is no `id` or
`data-testid` within six ancestors. Any conditional render, list reorder or wrapper
element added above the target invalidates it, and the override stops matching with
no error anywhere.

The mitigation is upstream, in the app rather than in design mode: elements that
users are likely to style deserve a `data-testid`. That short-circuits the walk on
step 2 and produces a selector that survives refactoring.

When a user reports "my styling disappeared after an update", check whether the saved
selector contains `:nth-child` before looking anywhere else.

## Fixed, but worth understanding: Radix portals treated as page elements

`isOwnUi` originally matched only `[data-design-mode-ui]`. Radix renders dropdowns,
popovers and dialogs into portals at the document root — outside the overlay's tree —
so the save menu's own dropdown was seen as a page element: hovering highlighted it,
clicking selected it, and the menu could not be used.

Fixed by matching the portal markers as well, and by tagging `DropdownMenuContent`
with `data-design-mode-ui`. Both halves matter: the attribute covers this specific
menu, the portal selectors cover Radix surfaces generally.

**Any new Radix surface inside the toolbar needs the same treatment.** This is the
single easiest way to reintroduce the bug.

## Browser limit: eyedropper is Chromium-only

The `EyeDropper` API exists in Chrome and Edge, not Firefox or Safari. The code
feature-detects and shows a Hebrew message for three seconds rather than failing
silently. There is no polyfill worth adding — sampling pixels outside the page is
precisely what a web page cannot otherwise do.

## Dead hook: `design-mode-active` body class

The provider toggles `design-mode-active` on `<body>`, but no CSS in the project
targets it. It is a styling hook — intended for cursor changes and pointer blocking —
that nothing currently uses.

Safe to remove, but it is the natural place to hang a crosshair cursor or a
`user-select: none` rule if that is ever wanted, so removing it costs a future
convenience for no real gain.

## Diagnosing "my styling went somewhere unexpected"

Work down this list:

1. **Which stylesheet holds the rule?** Look for the selector in
   `#design-mode-overrides` (committed) versus `#design-mode-live-preview`
   (uncommitted). An uncommitted rule vanishes on the next selection.
2. **Global or theme-owned?** Check `design_overrides_v1` and the active theme's
   `elementOverrides`. If it is in the theme, it disappears on theme switch — by
   design.
3. **Did the cloud overwrite it?** The provider adopts the cloud list when its newest
   `createdAt` is greater. Styling that "came back after deletion" is almost always
   this.
4. **Is the selector still matching?** Paste it into
   `document.querySelectorAll(...)`. Zero matches with an `nth-child` path in the
   selector means the DOM moved underneath it.
5. **Too broad?** A class selector that filtered down to just a tag name matches
   everything of that tag. Check what `computeClassSelector` actually produced.
