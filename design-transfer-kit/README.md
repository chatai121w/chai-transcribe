# Design Tuning Pack

Copy this folder as-is into any target project.

This pack is for runtime UI tuning only.
It is not an AI Skill and does not require any agent customization files.

## Included files

- tokens.css: semantic HSL variables for light and dark mode
- tailwind.preset.ts: Tailwind mapping to token variables
- design-kit.json: token snapshot for portability
- tuning-controls.json: quick knobs to tune core visual behavior
- COPY-STEPS.md: fast integration steps
- install-design-kit.ps1: helper script to place files in common target paths

## Goal

Provide one portable tuning folder so you can copy it to any project and keep a consistent visual baseline.

## Recommended workflow

1. Copy the entire folder into the target project root.
2. Run install-design-kit.ps1 in the target project root.
3. Import src/styles/design-tokens.css in your app entry file.
4. Merge or extend your tailwind config with tailwind.preset.ts.
5. Tune values in tuning-controls.json and sync to tokens.css as needed.
