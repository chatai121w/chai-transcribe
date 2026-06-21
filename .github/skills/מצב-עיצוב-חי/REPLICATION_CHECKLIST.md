# Live Design Mode - Replication Checklist

## Core wiring
- [ ] App root wrapped with DesignModeProvider
- [ ] DesignModeOverlay rendered once at app root
- [ ] Theme manager has toggle button for live mode

## Overrides engine
- [ ] DesignOverride model implemented
- [ ] computeSelector implemented (id/testid/nth path)
- [ ] computeClassSelector implemented (tag + filtered classes)
- [ ] applyOverridesToDom injects important rules
- [ ] localStorage key design_overrides_v1 works

## Overlay behavior
- [ ] Hover highlight visible on real DOM element
- [ ] Selected element opens draggable editor
- [ ] pointerdown used for selection
- [ ] underlying click handlers are swallowed in design mode
- [ ] Esc closes editor / exits mode
- [ ] Ctrl/Cmd+Z runs undoLast

## Editor features
- [ ] Editable fields: color/background/border/font-size/font-weight/radius/padding
- [ ] Live preview style tag updates in real time
- [ ] EyeDropper support + error fallback
- [ ] Color favorites save/delete/multi-delete
- [ ] Editor layout persisted (size/position/minimized)

## Save scopes
- [ ] Save element scope works
- [ ] Save class scope works
- [ ] Save global scope behaves same as class (exact parity)
- [ ] Save applies override and closes editor

## Theme save menu
- [ ] Save overwrite active custom theme
- [ ] Built-in/community active theme redirects Save to Save As New
- [ ] Save As New creates new custom theme id
- [ ] Publish exists for admin only
- [ ] clearAll after theme save

## Persistence and sync
- [ ] app_custom_themes updated locally
- [ ] app_theme_id updated locally
- [ ] updatePreferences syncs custom_themes to cloud
- [ ] community publish writes element_overrides
- [ ] useTheme merges theme.elementOverrides + design_overrides_v1

## UX parity
- [ ] Floating toolbar top-left
- [ ] Footer helper text appears when not collapsed
- [ ] Change counter is visible
- [ ] Clear-all confirm dialog
- [ ] Minimize/restore editor button works

## Regression tests
- [ ] Opens editor on click for / and /settings with designMode=1
- [ ] Clicking in mode does not navigate underlying app
- [ ] Mode persists after reload when URL has designMode=1
