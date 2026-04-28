import { useEffect, useState } from "react";
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
  BookOpen,
  Pencil,
  Presentation,
  Save,
  Trash2,
  Bookmark,
  MoreHorizontal,
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
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export type PlayerLayout = "split" | "stacked" | "full" | "wide" | "eq-wide";

export interface WidgetMeta {
  id: string;
  label: string;
  emoji?: string;
}

export interface LayoutProfile {
  id: string;
  name: string;
  builtIn?: boolean;
  icon?: "study" | "edit" | "present";
  layout: PlayerLayout;
  fontSize: number;
  order: string[];
  visibility: Record<string, boolean>;
  isPlayerFloating?: boolean;
  isEqFloating?: boolean;
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
  onApplyProfile: (p: LayoutProfile) => void;
}

const LAYOUT_OPTIONS: { value: PlayerLayout; label: string; icon: React.ElementType }[] = [
  { value: "split", label: "מפוצלת — תמלול ועריכה זה לצד זה", icon: LayoutPanelLeft },
  { value: "stacked", label: "מוערמת — תמלול מעל עריכה", icon: LayoutPanelTop },
  { value: "wide", label: "רחבה — נגן + תמלולים מקבילים", icon: StretchHorizontal },
  { value: "full", label: "נגן בלבד — מלא", icon: Square },
  { value: "eq-wide", label: "אקולייזר פרוס תחת הנגן", icon: SlidersHorizontal },
];

const BUILT_IN_PROFILES: LayoutProfile[] = [
  {
    id: "builtin-study",
    name: "לימוד",
    builtIn: true,
    icon: "study",
    layout: "stacked",
    fontSize: 22,
    order: ["player", "transcript", "editable"],
    visibility: { player: true, transcript: true, editable: false },
    isPlayerFloating: false,
    isEqFloating: false,
  },
  {
    id: "builtin-edit",
    name: "עריכה",
    builtIn: true,
    icon: "edit",
    layout: "split",
    fontSize: 16,
    order: ["player", "editable", "transcript"],
    visibility: { player: true, transcript: true, editable: true },
    isPlayerFloating: true,
    isEqFloating: false,
  },
  {
    id: "builtin-present",
    name: "הקרנה",
    builtIn: true,
    icon: "present",
    layout: "full",
    fontSize: 26,
    order: ["player", "transcript", "editable"],
    visibility: { player: true, transcript: true, editable: false },
    isPlayerFloating: false,
    isEqFloating: false,
  },
];

const PROFILES_KEY = "player_layout_profiles_v1";

function loadCustomProfiles(): LayoutProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((p) => p && p.id && !p.builtIn);
  } catch {}
  return [];
}

function saveCustomProfiles(list: LayoutProfile[]) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {}
}

function ProfileIcon({ kind }: { kind?: "study" | "edit" | "present" }) {
  if (kind === "study") return <BookOpen className="w-4 h-4" />;
  if (kind === "edit") return <Pencil className="w-4 h-4" />;
  if (kind === "present") return <Presentation className="w-4 h-4" />;
  return <Bookmark className="w-4 h-4" />;
}

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
  onApplyProfile,
}: Props) {
  const [customProfiles, setCustomProfiles] = useState<LayoutProfile[]>(() => loadCustomProfiles());
  const [saveOpen, setSaveOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  useEffect(() => {
    saveCustomProfiles(customProfiles);
  }, [customProfiles]);

  const applyProfile = (p: LayoutProfile) => {
    onApplyProfile(p);
    toast.success(`הוחלה פריסה: ${p.name}`);
  };

  const saveCurrentAsProfile = () => {
    const name = newProfileName.trim();
    if (!name) {
      toast.error("יש להזין שם לפריסה");
      return;
    }
    const profile: LayoutProfile = {
      id: `custom-${Date.now()}`,
      name,
      layout,
      fontSize,
      order: [...order],
      visibility: { ...visibility },
      isPlayerFloating,
      isEqFloating,
    };
    setCustomProfiles((prev) => [...prev, profile]);
    setNewProfileName("");
    setSaveOpen(false);
    toast.success(`נשמרה פריסה: ${name}`);
  };

  const deleteProfile = (id: string) => {
    setCustomProfiles((prev) => prev.filter((p) => p.id !== id));
    toast.success("הפריסה נמחקה");
  };

  return (
    <div dir="rtl" className="space-y-3">
      {/* Layout profiles row — quick access */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm px-4 py-3">
        <span className="text-xs text-muted-foreground font-medium ml-1">פרופילי פריסה:</span>

        {BUILT_IN_PROFILES.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            size="sm"
            className="h-9 rounded-xl gap-1.5 text-xs border-yellow-500/40 hover:bg-yellow-500/10 hover:border-yellow-500/70"
            onClick={() => applyProfile(p)}
            title={`החל פריסת ${p.name}`}
          >
            <ProfileIcon kind={p.icon} />
            {p.name}
          </Button>
        ))}

        {customProfiles.length > 0 && (
          <>
            <div className="w-px h-6 bg-border/60 mx-1" />
            {customProfiles.map((p) => (
              <div key={p.id} className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-background/60 pr-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-xl gap-1.5 text-xs px-2"
                  onClick={() => applyProfile(p)}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  {p.name}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteProfile(p.id)}
                  title="מחק פריסה"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </>
        )}

        <div className="flex-1" />

        <Popover open={saveOpen} onOpenChange={setSaveOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 text-xs">
              <Save className="w-4 h-4" />
              שמור פריסה נוכחית
            </Button>
          </PopoverTrigger>
          <PopoverContent dir="rtl" className="w-72 rounded-xl">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">שמור פריסה אישית</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  שומר את הפריסה, גודל הטקסט, סדר הווידג'טים והנראות.
                </p>
              </div>
              <Input
                placeholder="שם הפריסה (למשל: 'תיקון מהיר')"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentAsProfile()}
                className="rounded-lg"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                  ביטול
                </Button>
                <Button size="sm" onClick={saveCurrentAsProfile} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                  שמור
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Main toolbar — compact essentials + overflow menu */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm px-5 py-3 shadow-sm">
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
            <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">
              {fontSize}px
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <WidgetsMenu
            widgets={widgets}
            order={order}
            visibility={visibility}
            onMove={onMove}
            onToggleVisible={onToggleVisible}
          />

          {/* Less-used controls collapsed under "more" */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 text-xs">
                <MoreHorizontal className="w-4 h-4" />
                עוד
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 rounded-xl" style={{ direction: 'rtl' }}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">חלונות צפים</DropdownMenuLabel>
              <DropdownMenuItem onClick={onTogglePlayerFloating} className="gap-2 text-sm">
                <PictureInPicture2 className="w-4 h-4" />
                <span className="flex-1">נגן צף</span>
                <Switch checked={isPlayerFloating} className="pointer-events-none" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleEqFloating} className="gap-2 text-sm">
                <SlidersHorizontal className="w-4 h-4" />
                <span className="flex-1">איקולייזר צף</span>
                <Switch checked={isEqFloating} className="pointer-events-none" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="px-2 py-1 text-[10px] text-muted-foreground">
                Ctrl+Shift+F · נגן צף • Ctrl+Shift+E · EQ צף
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
