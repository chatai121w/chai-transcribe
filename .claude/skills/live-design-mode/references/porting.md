# Building this in another project

The version in chai-transcribe is 1,300 lines, but most of that is polish. The
mechanism — pick an element, write CSS, persist it — is about 150 lines and has no
dependencies beyond the DOM. This is the guide to rebuilding it elsewhere, and to
knowing which parts you can skip.

## What is essential and what is not

| Part | Essential? | Why |
|---|---|---|
| Selector computation | **Yes** | Without a stable selector nothing can be saved |
| `<style>` injection | **Yes** | The whole delivery mechanism |
| Capture-phase picking | **Yes** | Otherwise clicking a button to style it also presses it |
| localStorage persistence | **Yes** | Or the work vanishes on reload |
| Separate preview stylesheet | Strongly recommended | Makes cancel trivial instead of a diff |
| Scope choice (one/kind/all) | Recommended | Users almost always want more than one element |
| Match counts on the buttons | Recommended | Cheap, and prevents "it changed more than I meant" |
| Eyedropper | Optional | Chromium-only; nice, not load-bearing |
| Colour favourites | Optional | Pure convenience |
| Draggable floating panels | Optional | `react-rnd` here; a fixed corner panel works fine |
| Cloud sync | Optional | Only if styling should follow the user across devices |
| Theme integration | Optional | Only if the app already has themes |

Build the first four and you have a working system in an afternoon. Everything below
that line is a separate decision.

## Build order

Each stage is independently useful — stop wherever the value runs out.

**1. Inject CSS from a list.** A module that holds an array of
`{ selector, css }` and rewrites one `<style>` tag from it. Test by pushing entries
in from the console; if the page restyles, the delivery half is done.

**2. Compute a selector for an element.** Start with the precise one — id, then
`data-testid`, then an `nth-child` path. Test by hovering elements and logging what
you get, then pasting each result into `document.querySelectorAll` and checking it
returns exactly one node.

**3. Pick elements.** `mousemove` and `pointerdown` on the **capture phase**, draw a
box over the hovered element's `getBoundingClientRect()`, select on pointerdown.
This is the step where most implementations go wrong — see the pitfalls below.

**4. Edit with preview.** A panel with a few inputs writing into local state, and a
*second* `<style>` tag rebuilt from that state. Commit copies it into the list from
step 1 and clears the preview.

**5. Add breadth.** A second selector function based on the element's classes, and
buttons letting the user choose. Add match counts at the same time — they are two
lines and they make the choice legible.

## Minimal core

This is the whole mechanism, framework-agnostic apart from the panel:

```ts
// ---- injection ----
const STYLE_ID = 'design-overrides';

export function applyOverrides(list: { selector: string; css: Record<string,string> }[]) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = list.map(o => {
    const decls = Object.entries(o.css)
      .map(([k, v]) => `  ${k}: ${v} !important;`)
      .join('\n');
    return `${o.selector} {\n${decls}\n}`;
  }).join('\n\n');
}

// ---- selector ----
export function computeSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tid = el.getAttribute('data-testid');
  if (tid) return `[data-testid="${tid}"]`;

  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.body && depth < 6; depth++) {
    if (cur.id) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
    const parent: HTMLElement | null = cur.parentElement;   // annotate: cur is reassigned from it
    if (!parent) break;
    const idx = Array.from(parent.children).indexOf(cur) + 1;
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
    cur = parent;
  }
  return parts.join(' > ');
}

// ---- picking ----
export function startPicking(onPick: (el: Element) => void, isOwnUi: (t: Element) => boolean) {
  const resolve = (t: EventTarget | null): Element | null =>
    t instanceof Element ? t : t instanceof Node ? t.parentElement : null;

  const block = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
  };

  const onDown = (e: PointerEvent) => {
    const el = resolve(e.target);
    if (!el || isOwnUi(el)) return;
    if (e.ctrlKey || e.metaKey) return;   // escape hatch: let the app work
    block(e);
    onPick(el);
  };
  const swallow = (e: Event) => {
    const el = resolve(e.target);
    if (!el || isOwnUi(el)) return;
    if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) return;
    block(e);
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('mousedown', swallow, true);
  document.addEventListener('click', swallow, true);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('mousedown', swallow, true);
    document.removeEventListener('click', swallow, true);
  };
}
```

Persistence is `JSON.stringify` into localStorage plus a call to `applyOverrides`
from the same function, so saving and applying can never diverge.

## Pitfalls when porting

**Select on `pointerdown`, not `click`.** `pointerdown` fires before the browser
synthesises a click and before React's synthetic event system runs. If you select on
`click`, styling a "Delete" button deletes something. This single choice is the
difference between a tool and a hazard.

**`stopImmediatePropagation`, not just `stopPropagation`.** The latter stops the event
travelling to other elements; it does not stop other listeners on the *same* element.
Frameworks and UI libraries attach listeners to the element itself all the time.

**Recognise your own UI, including portals.** Any element the picker can see, it will
try to style — including your own panel. Tag your UI (`data-design-mode-ui`) and check
`closest()` on it. If you use Radix, Headless UI, MUI or anything else that renders
menus into a portal at the document root, those are *outside* your panel's tree and
need their own selectors. This is the most common regression: it works, then someone
adds a dropdown to the toolbar and the toolbar starts styling itself.

**`!important` depends on your CSS strategy.** With Tailwind or any utility-first CSS
it is required — utilities have real specificity and will win otherwise. With CSS
modules or styled-components you may get away without it, and the output is cleaner
if you do. Decide deliberately rather than copying.

**Two stylesheets, not one.** Preview in its own `<style>` element. Merging preview
into the committed sheet means cancelling an edit requires removing exactly the right
declarations back out — solvable, and needless.

**Text nodes are not elements.** Hovering text inside a button gives you a text node.
Climb to `parentElement` before doing anything, or hovering over any text silently
does nothing.

**Server-side rendering.** All of this touches `document` at module scope or on mount.
Under Next.js or Remix, guard the injection behind a client-only check, and apply
saved overrides in an effect rather than during render.

**Leave an escape hatch.** Ctrl/Cmd bypassing the picker lets the user operate the app
without turning the mode off. Without it, testing a change means toggling design mode
constantly.

## Adapting to a different stack

**Non-React.** Only the panel is React here. The selector, injection and picking
functions are plain DOM and drop into Vue, Svelte or vanilla unchanged. The state
that needs a home is: `enabled`, `selectedElement`, `liveChanges`, `overrides`.

**No Tailwind.** The class-based "everything of this kind" selector assumes many
short utility classes. With CSS modules you get hashed names like `Button_root__x7f2`
— still usable, and actually more stable, but the filtering heuristics (drop
`hover:`, drop long arbitrary values) become irrelevant. Simplify rather than port
them.

**Different storage.** localStorage is one function each way. Swapping in IndexedDB,
a backend, or a file matters only for `loadOverrides`/`saveOverrides`. Keep
`saveOverrides` calling `applyOverrides` so the two cannot drift.

**Multi-user or multi-device.** The last-write-wins used here compares the newest
timestamp between two lists and replaces wholesale. That is fine for one person and
wrong for a team. If several people edit, merge per override on a stable `id` and
resolve conflicts per selector — and expect to need a real conflict UI, not a silent
rule.

**LTR instead of RTL.** This implementation is RTL throughout — panel placement,
`dir="rtl"`, Hebrew labels. Flip the placement logic (it prefers right of the click
point, flipping left on overflow) and the `dir`.

## What to design differently if starting fresh

Three things here would be worth doing better in a new implementation:

**Give styleable elements stable hooks.** The `nth-child` fallback is the weak point —
overrides silently stop matching when the DOM shifts. If you can add `data-testid` (or
any stable attribute) to the components users are likely to style, the selector
problem largely disappears. Do it early; retrofitting means migrating saved overrides.

**Decide the scope model before building the UI.** "This element / this kind /
everything" is a reasonable set, but only if each is genuinely distinct — this project
shipped two buttons producing identical CSS precisely because the model was decided
after the buttons existed.

**Consider updating overrides in place.** Append-only makes undo a one-liner and is
the right call for a first version, but the list grows without bound and the
stylesheet fills with dead rules. If you expect long sessions, dedupe on commit by
selector plus property — while keeping an undo stack separate from the override list,
so undo stays meaningful.
