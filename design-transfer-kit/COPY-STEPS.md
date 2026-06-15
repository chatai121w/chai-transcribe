# Copy Steps (Fast)

This flow is for UI tuning only (tokens, Tailwind mapping, visual knobs).
No AI Skill files are required.

## 1) Copy folder

Copy the full design-transfer-kit folder to the target project root.

## 2) Run helper script

PowerShell:

./design-transfer-kit/install-design-kit.ps1 -TargetRoot .

## 3) Import tokens file

In your app entry CSS or main CSS file, add:

@import "./styles/design-tokens.css";

Adjust the path based on your project structure.

## 4) Merge tailwind preset

Option A (recommended): use presets in tailwind config.

presets: [require("./design-transfer-kit.tailwind.preset").default]

Option B: copy extend section manually into your tailwind config.

## 5) Verify in browser

- Background and foreground
- Primary and accent buttons
- Border radius and card surfaces
- Dark mode switch
- Density behavior (compact, comfortable, spacious)
