import { useState } from "react";
import {
  LayoutPanelLeft,
  LayoutPanelTop,
  Square,
  StretchHorizontal,
  SlidersHorizontal,
  PictureInPicture2,
  Settings2,
  GripVertical,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export type PlayerLayout = "split" | "stacked" | "full" | "wide" | "eq-wide";

export interface WidgetMeta {
  id: string;
  label: string;
  emoji?: string;
}

interface Props {
  layout: PlayerLayout;
  onLayoutChange: (l: PlayerLayout) => void;
  isPlayerFloating: boolean;
  onTogglePlayerFloating: () => void;
  isEqFloating: boolean;
  onToggleEqFloating: () => void;
  fontSize: number;
  onFontSizeChange: (v: number) => void;
  widgets: WidgetMeta[];
  order: string[];
  visibility: Record<string, boolean>;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggleVisible: (id: string) => void;
}

const LAYOUT_OPTIONS: { value: PlayerLayout; label: string; icon: React.ElementType }[] = [
  { value: "split", label: "מפוצלת — תמלול ועריכה זה לצד זה", icon: LayoutPanelLeft },
  { value: "stacked", label: "מוערמת — תמלול מעל עריכה", icon: LayoutPanelTop },
  { value: "wide", label: "רחבה — נגן + תמלולים מקבילים", icon: StretchHorizontal },
  { value: "full", label: "נגן בלבד — מלא", icon: Square },
  { value: "eq-wide", label: "אקולייזר פרוס תחת הנגן", icon: SlidersHorizontal },
];

export function PlayerTabToolbar({
  layout,
  onLayoutChange,
  isPlayerFloating,
  onTogglePlayerFloating,
  isEqFloating,
  onToggleEqFloating,
  fontSize,
  onFontSizeChange,
  widgets,
  order,
  visibility,
  onMove,
  onToggleVisible,
}: Props) {
  return (
    <div
      dir="rtl"
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-5 py-4 shadow-sm"
    >
      {/* Right group: layout + font */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">פריסה</span>
          <Select value={layout} onValueChange={(v) => onLayoutChange(v as PlayerLayout)}>
            <SelectTrigger className="h-9 w-[210px] rounded-xl text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl" className="rounded-xl">
              {LAYOUT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <SelectItem key={opt.value} value={opt.value} className="text-sm">
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {opt.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 min-w-[200px]">
          <Type className="w-4 h-4 text-muted-foreground" />
          <Slider
            min={12}
            max={28}
            step={1}
            value={[fontSize]}
            onValueChange={(v) => onFontSizeChange(v[0])}
            className="w-32"
          />
          <span className="text-xs text-muted-foreground tabular-nums w-8 text-center">
            {fontSize}px
          </span>
        </div>
      </div>

      {/* Left group: floating + widgets manager */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={isPlayerFloating ? "default" : "outline"}
          size="sm"
          className="h-9 rounded-xl gap-1.5 text-xs"
          onClick={onTogglePlayerFloating}
          title="נגן צף (Ctrl+Shift+F)"
        >
          <PictureInPicture2 className="w-4 h-4" />
          נגן צף
        </Button>
        <Button
          variant={isEqFloating ? "default" : "outline"}
          size="sm"
          className="h-9 rounded-xl gap-1.5 text-xs"
          onClick={onToggleEqFloating}
          title="איקולייזר צף (Ctrl+Shift+E)"
        >
          <SlidersHorizontal className="w-4 h-4" />
          EQ צף
        </Button>

        <WidgetsMenu
          widgets={widgets}
          order={order}
          visibility={visibility}
          onMove={onMove}
          onToggleVisible={onToggleVisible}
        />
      </div>
    </div>
  );
}

function WidgetsMenu({
  widgets,
  order,
  visibility,
  onMove,
  onToggleVisible,
}: {
  widgets: WidgetMeta[];
  order: string[];
  visibility: Record<string, boolean>;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggleVisible: (id: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const ordered = order
    .map((id) => widgets.find((w) => w.id === id))
    .filter((w): w is WidgetMeta => !!w);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 text-xs">
          <Settings2 className="w-4 h-4" />
          ווידג'טים
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-xl p-2" style={{ direction: 'rtl' }}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          סדר ונראות הווידג'טים — גרור או השתמש בחיצים
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-1">
          {ordered.map((w, idx) => {
            const visible = visibility[w.id] !== false;
            const isDragging = dragId === w.id;
            return (
              <div
                key={w.id}
                draggable
                onDragStart={() => setDragId(w.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragId || dragId === w.id) return;
                  const fromIdx = order.indexOf(dragId);
                  const toIdx = order.indexOf(w.id);
                  if (fromIdx < 0 || toIdx < 0) return;
                  const dir = toIdx > fromIdx ? 1 : -1;
                  // Move step-by-step until in place
                  let cur = fromIdx;
                  while (cur !== toIdx) {
                    onMove(dragId, dir);
                    cur += dir;
                  }
                }}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 transition-colors ${
                  isDragging ? "bg-accent/60" : "hover:bg-accent/40"
                }`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                <span className="flex-1 text-sm">
                  {w.emoji && <span className="ml-1">{w.emoji}</span>}
                  {w.label}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === 0}
                    onClick={(e) => {
                      e.preventDefault();
                      onMove(w.id, -1);
                    }}
                    title="העלה"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === ordered.length - 1}
                    onClick={(e) => {
                      e.preventDefault();
                      onMove(w.id, 1);
                    }}
                    title="הורד"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Switch
                  checked={visible}
                  onCheckedChange={() => onToggleVisible(w.id)}
                  aria-label={visible ? "הסתר" : "הצג"}
                />
                {visible ? (
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
