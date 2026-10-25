/**
 * PronunciationStack
 * Wraps the Hebrew-pronunciation related controls (Loshon Kodesh toggle,
 * Personal pronunciation model toggle, and the profile selector) and gives
 * the user a runtime layout-switcher to pick how the column is presented.
 *
 * The three slots are passed as ReactNodes so this component stays purely
 * presentational and does not duplicate the toggle logic from Index.tsx.
 */

import { type ReactNode, useEffect, useState } from "react";
import { LayoutGrid, LayoutPanelLeft, Rows3, Square, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LayoutSwitch } from "@/components/ui/LayoutSwitch";

export type PronunciationLayoutMode = "rich" | "compact" | "tabs" | "grid" | "row";

const STORAGE_KEY = "pronunciation_layout_mode";

const MODES: Array<{
  id: PronunciationLayoutMode;
  label: string;
  /** מה משתנה בפועל — מוצג בריחוף וליד הבורר, כמו בבורר השני. */
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "rich",    label: "מורחב",   hint: "שני מתגים זה לצד זה",        icon: Rows3 },
  { id: "compact", label: "קומפקטי", hint: "שורות צרות, טקסט קטן",       icon: Square },
  { id: "grid",    label: "רשת",     hint: "שתי עמודות שוות",            icon: LayoutGrid },
  { id: "row",     label: "אופקי",   hint: "שלושתם בשורה, בלי הסברים",   icon: Columns3 },
  { id: "tabs",    label: "טאבים",   hint: "אחד בכל פעם, לשוניות בצד",   icon: LayoutPanelLeft },
];

const TAB_DEFS: Array<{ id: "lk" | "personal" | "profile"; label: string }> = [
  { id: "lk",       label: "לשון הקודש" },
  { id: "personal", label: "מודל אישי" },
  { id: "profile",  label: "פרופיל הגייה" },
];

interface Props {
  loshonKodeshSlot: ReactNode;
  personalModelSlot: ReactNode;
  profileSelectorSlot: ReactNode;
  /** Controlled mode (when provided, persistence is the parent's job — e.g. cloud prefs). */
  mode?: PronunciationLayoutMode;
  onModeChange?: (mode: PronunciationLayoutMode) => void;
}

export function PronunciationStack({
  loshonKodeshSlot,
  personalModelSlot,
  profileSelectorSlot,
  mode: controlledMode,
  onModeChange,
}: Props) {
  const [uncontrolledMode, setUncontrolledMode] = useState<PronunciationLayoutMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "rich" || v === "compact" || v === "tabs" || v === "grid" || v === "row") return v;
    } catch { /* ignore */ }
    return "rich";
  });

  const mode = controlledMode ?? uncontrolledMode;
  const setMode = (next: PronunciationLayoutMode) => {
    if (onModeChange) onModeChange(next);
    if (controlledMode === undefined) setUncontrolledMode(next);
  };

  const [activeTab, setActiveTab] = useState<"lk" | "personal" | "profile">("lk");

  useEffect(() => {
    // Mirror to localStorage as a fallback so it survives offline reloads.
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const slotFor = (id: "lk" | "personal" | "profile") =>
    id === "lk" ? loshonKodeshSlot : id === "personal" ? personalModelSlot : profileSelectorSlot;


  return (
    <section
      dir="rtl"
      aria-label="הגדרות הגייה עברית"
      className="rounded-xl border border-yellow-500/30 bg-yellow-500/[0.03] p-2.5 space-y-2"
    >
      {/*
        הכותרת ובורר הפריסה.

        הבורר הוא אותו רכיב ששאר הבוררים בעמוד משתמשים בו. קודם
        לכן הוא היה עותק נפרד בצבע אחר, וכל אחד מהם היה סביר בפני
        עצמו — אבל יחד הם נראו כמו שתי מערכות שונות.
      */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <span aria-hidden>🕮</span>
          הגייה ולשון
        </h3>
        <LayoutSwitch
          label="פריסת ההגייה והלשון"
          value={mode}
          onChange={setMode}
          options={MODES}
        />
      </header>

      {/* Body */}
      {/*
        המצב המורחב סידר את שלושת החלקים זה מתחת לזה ברוחב מלא.
        הטקסט בכל שורה תופס פחות מחצי מהרוחב, ולכן נוצר שטח ריק
        גדול, והפאנל יצא גבוה בלי שום צורך.

        עכשיו שני המתגים יושבים זה לצד זה במסך רחב, ובורר הפרופיל
        — שהוא רשימה ולא מתג — תופס שורה משלו מתחת. במסך צר הכל
        חוזר לעמודה אחת מאליו.
      */}
      {mode === "rich" && (
        <div className="grid gap-2 md:grid-cols-2 [&>*]:min-w-0">
          <div className="min-w-0">{loshonKodeshSlot}</div>
          <div className="min-w-0">{personalModelSlot}</div>
          <div className="min-w-0 md:col-span-2">{profileSelectorSlot}</div>
        </div>
      )}

      {mode === "compact" && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-1 gap-1.5 [&>div]:py-1.5 [&>div]:px-2 [&>div]:text-xs [&_span.font-medium]:text-xs">
            {loshonKodeshSlot}
            {personalModelSlot}
          </div>
          <div>{profileSelectorSlot}</div>
        </div>
      )}

      {mode === "grid" && (
        <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
          <div>{loshonKodeshSlot}</div>
          <div>{personalModelSlot}</div>
          <div className="col-span-2">{profileSelectorSlot}</div>
        </div>
      )}

      {mode === "row" && (
        <div
          className="grid grid-cols-3 gap-1.5 [&>*]:min-w-0
                     [&_>*>*]:!py-1.5 [&_>*>*]:!px-2
                     [&_>*>*]:!rounded-lg [&_>*>*]:!h-full
                     [&_span.font-medium]:!text-[11px]
                     [&_p.text-xs]:!hidden
                     "
        >
          <div className="min-w-0">{loshonKodeshSlot}</div>
          <div className="min-w-0">{personalModelSlot}</div>
          <div className="min-w-0">{profileSelectorSlot}</div>
        </div>
      )}

      {mode === "tabs" && (
        <div className="flex gap-2 min-h-[120px]">
          {/* Vertical rectangular tabs */}
          <div
            role="tablist"
            aria-orientation="vertical"
            className="flex flex-col gap-1 shrink-0 w-28"
          >
            {TAB_DEFS.map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "text-right text-xs font-medium px-2.5 py-2 rounded-md border transition-all",
                    active
                      ? "bg-yellow-500/15 border-yellow-500/60 text-foreground shadow-sm"
                      : "bg-background/40 border-border text-muted-foreground hover:border-yellow-500/40 hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-w-0">{slotFor(activeTab)}</div>
        </div>
      )}
    </section>
  );
}
