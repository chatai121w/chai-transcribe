import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, GripVertical, Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface TabConfig {
  id: string;
  label: string;
  emoji?: string;
  group: "primary" | "secondary";
}

interface TabSettingsManagerProps {
  allTabs: TabConfig[];
  visibleTabs: string[];
  tabOrder: string[];
  onVisibilityChange: (visibleTabs: string[]) => void;
  onOrderChange: (newOrder: string[]) => void;
}

const STORAGE_KEY = "tab_settings";

export function getDefaultTabConfig(): { visible: string[]; order: string[] } {
  const allIds = [
    "player", "speakers", "templates", "ai", "pipeline", "prompts",
    "ollama", "learning", "vocab", "summary", "analytics", "compare", "history",
  ];
  return { visible: allIds, order: allIds };
}

// Remove legacy/removed tab ids (e.g. "ab" merged into "compare", "edit" merged into "player") from persisted settings.
const REMOVED_TAB_IDS = new Set<string>(["ab", "edit"]);
const stripRemoved = (ids: string[] | undefined): string[] =>
  Array.isArray(ids) ? ids.filter((id) => !REMOVED_TAB_IDS.has(id)) : [];

export function loadTabSettings(): { visible: string[]; order: string[] } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.visible && parsed.order) {
        const cleaned = {
          visible: stripRemoved(parsed.visible),
          order: stripRemoved(parsed.order),
        };
        // Persist the migration so we don't re-clean on every load.
        if (
          cleaned.visible.length !== parsed.visible.length ||
          cleaned.order.length !== parsed.order.length
        ) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          } catch {}
        }
        return cleaned;
      }
    }
  } catch {}
  return getDefaultTabConfig();
}

export function saveTabSettings(visible: string[], order: string[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      visible: stripRemoved(visible),
      order: stripRemoved(order),
    })
  );
}

export function TabSettingsManager({
  allTabs,
  visibleTabs,
  tabOrder,
  onVisibilityChange,
  onOrderChange,
}: TabSettingsManagerProps) {
  const [open, setOpen] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const sortedTabs = [...allTabs].sort(
    (a, b) => tabOrder.indexOf(a.id) - tabOrder.indexOf(b.id)
  );

  const toggleTab = (tabId: string) => {
    const newVisible = visibleTabs.includes(tabId)
      ? visibleTabs.filter((t) => t !== tabId)
      : [...visibleTabs, tabId];
    // Ensure at least one tab is visible
    if (newVisible.length === 0) return;
    onVisibilityChange(newVisible);
    saveTabSettings(newVisible, tabOrder);
  };

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const newOrder = [...sortedTabs.map((t) => t.id)];
    const [dragged] = newOrder.splice(dragItem.current, 1);
    newOrder.splice(dragOverItem.current, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    onOrderChange(newOrder);
    saveTabSettings(visibleTabs, newOrder);
  };

  const handleReset = () => {
    const defaults = getDefaultTabConfig();
    onVisibilityChange(defaults.visible);
    onOrderChange(defaults.order);
    saveTabSettings(defaults.visible, defaults.order);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          title="הגדרות טאבים"
        >
          <Settings className="h-3.5 w-3.5 text-[#0f1e43]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="end"
        dir="rtl"
      >
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-medium">ניהול טאבים</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3" />
            איפוס
          </Button>
        </div>
        <div className="p-2 max-h-[400px] overflow-y-auto space-y-0.5">
          {sortedTabs.map((tab, index) => {
            const isVisible = visibleTabs.includes(tab.id);
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing transition-colors",
                  "hover:bg-muted/60",
                  !isVisible && "opacity-50"
                )}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm flex-1 truncate">
                  {tab.emoji && <span className="ml-1">{tab.emoji}</span>}
                  {tab.label}
                </span>
                <Switch
                  checked={isVisible}
                  onCheckedChange={() => toggleTab(tab.id)}
                  className="scale-75"
                />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
