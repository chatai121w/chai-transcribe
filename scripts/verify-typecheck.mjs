/**
 * בודק שבדיקת הטיפוסים באמת בודקת משהו.
 *
 * למה הקובץ הזה קיים: בפרויקט הזה הפקודה שהורצה הייתה
 * `tsc --noEmit` בלי לציין קובץ הגדרות. ברירת המחדל היא
 * `tsconfig.json`, ובקובץ הזה כתוב `"files": []` — כלומר "אין לי
 * קבצים". התוצאה: הבדיקה סיימה בהצלחה בלי להסתכל על שום קובץ,
 * ודיווחה אפס שגיאות גם כשהיו שגיאות אמיתיות בקוד.
 *
 * זאת תקלה שקטה, והיא הגרועה מכולן: היא אינה נראית ככשל אלא
 * כהצלחה. לכן לא מסתפקים בכך שהבדיקה "עוברת" — מוכיחים שהיא
 * מסוגלת להיכשל.
 *
 * איך: שותלים קובץ זמני בתוך `src` שמפנה לשם שאינו קיים. קובץ
 * ב-`src` נבדק גם אם אף אחד אינו מייבא אותו, ולכן אין צורך לגעת
 * בקוד אמיתי. אם הבדיקה עוברת — הבדיקה שבורה.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

// מריצים את בודק הטיפוסים ישירות ולא דרך מעטפת הפקודות: העברת
// פרמטרים דרך מעטפת מצרפת מחרוזות בלי מילוט, ו-Node מתריע על כך.
const require_ = createRequire(import.meta.url);
const TSC = require_.resolve("typescript/bin/tsc");

const PROBE = "src/__typecheck_probe.ts";
const CONFIGS = ["tsconfig.app.json", "tsconfig.node.json"];

function typecheck(config) {
  const r = spawnSync(process.execPath, [TSC, "--noEmit", "-p", config],
    { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return { errors: (out.match(/error TS/g) || []).length, out };
}

function cleanup() {
  if (existsSync(PROBE)) rmSync(PROBE);
}

process.on("exit", cleanup);

let failed = false;

// שלב א: הקוד כמו שהוא חייב להיות נקי.
for (const config of CONFIGS) {
  const { errors, out } = typecheck(config);
  if (errors > 0) {
    console.error(`\nשגיאות טיפוסים ב-${config}:\n${out}`);
    failed = true;
  } else {
    console.log(`  ${config} — נקי`);
  }
}

// שלב ב: הבדיקה חייבת לתפוס שם שאינו קיים.
writeFileSync(PROBE,
  "// קובץ זמני של השומר. אם הוא נשאר כאן, השומר נקטע באמצע.\n" +
  "export const probe: ZeSugShelLoKayam = 1;\n", "utf8");

const probed = typecheck("tsconfig.app.json");
cleanup();

if (probed.errors === 0) {
  console.error(
    "\nהבדיקה לא תפסה סוג שאינו קיים בכלל.\n" +
    "כלומר בדיקת הטיפוסים אינה בודקת את הקוד, והדיווח 'אפס שגיאות'\n" +
    "חסר ערך. לבדוק את `include` ואת `files` בקובץ ההגדרות.\n");
  failed = true;
} else {
  console.log("  השומר — הבדיקה תפסה סוג שאינו קיים, כנדרש");
}

if (failed) process.exit(1);
console.log("\nבדיקת הטיפוסים עובדת ומכסה את הקוד.");
