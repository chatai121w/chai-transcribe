import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bold, Underline, Italic, Strikethrough,
  Highlighter, Palette, Star, Type, Eraser,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingFormatToolbarProps {
  containerRef: React.RefObject<HTMLDivElement>;
  onExecCommand: (command: string, value?: string) => void;
  onSyncContent: () => void;
}

const HIGHLIGHT_COLORS = [
  "#ffff00", "#00ff00", "#00ffff", "#ff00ff", "#ffa500", "#ff6b6b",
  "#a8e6cf", "#dda0dd", "#f0e68c", "#87ceeb",
];

const TEXT_COLORS = [
  "#000000", "#ffffff", "#ff0000", "#0000ff", "#008000",
  "#800080", "#ff8c00", "#808080", "#c0392b", "#2980b9",
];

const FONT_FAMILIES = [
  { value: "Assistant", label: "Assistant" },
  { value: "Rubik", label: "Rubik" },
  { value: "Heebo", label: "Heebo" },
  { value: "Frank Ruhl Libre", label: "Frank Ruhl Libre" },
  { value: "David Libre", label: "David Libre" },
  { value: "Noto Sans Hebrew", label: "Noto Sans Hebrew" },
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", label: "Courier New" },
];

export const FloatingFormatToolbar = ({
  containerRef,
  onExecCommand,
  onSyncContent,
}: FloatingFormatToolbarProps) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showColors, setShowColors] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [showFont, setShowFont] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  const updatePosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Check selection is inside our editor
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Position above the selection, centered
    const toolbarHeight = 44;
    const gap = 8;
    // Account for scroll offset inside the editor
    let top = rect.top - containerRect.top + container.scrollTop - toolbarHeight - gap;
    let left = rect.left - containerRect.left + container.scrollLeft + rect.width / 2;

    // Keep within container bounds
    if (top < container.scrollTop) {
      // Show below if no room above
      top = rect.bottom - containerRect.top + container.scrollTop + gap;
    }

    // Clamp left to avoid overflow
    const minLeft = 120;
    const maxLeft = containerRect.width - 120;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    setPosition({ top, left });
    setVisible(true);
  }, [containerRef]);

  const handleSelectionChange = useCallback(() => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      // Delay hiding so user can click toolbar buttons
      hideTimeout.current = setTimeout(() => {
        setVisible(false);
        setShowColors(false);
        setShowHighlight(false);
        setShowFont(false);
      }, 200);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      hideTimeout.current = setTimeout(() => {
        setVisible(false);
      }, 200);
      return;
    }

    updatePosition();
  }, [containerRef, updatePosition]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [handleSelectionChange]);

  const handleAction = (command: string, value?: string) => {
    onExecCommand(command, value);
    onSyncContent();
    // Re-check position after formatting
    requestAnimationFrame(() => updatePosition());
  };

  const handleFontChange = (fontFamily: string) => {
    onExecCommand("fontName", fontFamily);
    onSyncContent();
    setShowFont(false);
    requestAnimationFrame(() => updatePosition());
  };

  const handleFavorite = () => {
    // Wrap selection in a styled span with star marker
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const container = containerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    // Check if already favorited (has the favorite class)
    const parent = range.commonAncestorContainer.parentElement;
    if (parent?.classList.contains("favorite-text")) {
      // Un-favorite: unwrap
      const text = document.createTextNode(parent.textContent || "");
      parent.parentNode?.replaceChild(text, parent);
      onSyncContent();
      return;
    }

    const span = document.createElement("span");
    span.className = "favorite-text";
    span.style.backgroundColor = "#fef3c7";
    span.style.borderBottom = "2px solid #f59e0b";
    span.style.paddingBottom = "1px";
    span.style.borderRadius = "2px";

    try {
      range.surroundContents(span);
      onSyncContent();
    } catch {
      // surroundContents can fail if selection crosses element boundaries
      // Fall back to highlight color
      onExecCommand("hiliteColor", "#fef3c7");
      onSyncContent();
    }
  };

  // Keep toolbar alive when clicking inside it
  const handleToolbarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
  };

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      onMouseDown={handleToolbarMouseDown}
      className={cn(
        "absolute z-50 flex items-center gap-0.5 px-1.5 py-1",
        "bg-popover/95 backdrop-blur-md border border-border/60",
        "rounded-xl shadow-lg shadow-black/10",
        "animate-in fade-in-0 zoom-in-95 duration-150",
        "select-none"
      )}
      style={{
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
      }}
    >
      {/* Bold */}
      <ToolbarBtn
        icon={Bold}
        title="מודגש"
        onClick={() => handleAction("bold")}
      />

      {/* Italic */}
      <ToolbarBtn
        icon={Italic}
        title="נטוי"
        onClick={() => handleAction("italic")}
      />

      {/* Underline */}
      <ToolbarBtn
        icon={Underline}
        title="קו תחתון"
        onClick={() => handleAction("underline")}
      />

      {/* Strikethrough */}
      <ToolbarBtn
        icon={Strikethrough}
        title="קו חוצה"
        onClick={() => handleAction("strikeThrough")}
      />

      <div className="w-px h-5 bg-border/50 mx-0.5" />

      {/* Text Color */}
      <div className="relative">
        <ToolbarBtn
          icon={Palette}
          title="צבע טקסט"
          onClick={() => {
            setShowColors(!showColors);
            setShowHighlight(false);
            setShowFont(false);
          }}
          active={showColors}
        />
        {showColors && (
          <div
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 p-2 bg-popover border border-border rounded-lg shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="grid grid-cols-5 gap-1.5">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    handleAction("foreColor", c);
                    setShowColors(false);
                  }}
                  className="w-6 h-6 rounded-full border-2 border-border hover:scale-125 transition-transform"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-center">
              <input
                type="color"
                onChange={(e) => {
                  handleAction("foreColor", e.target.value);
                  setShowColors(false);
                }}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                title="צבע מותאם"
              />
            </div>
          </div>
        )}
      </div>

      {/* Highlight */}
      <div className="relative">
        <ToolbarBtn
          icon={Highlighter}
          title="צבע הדגשה"
          onClick={() => {
            setShowHighlight(!showHighlight);
            setShowColors(false);
            setShowFont(false);
          }}
          active={showHighlight}
        />
        {showHighlight && (
          <div
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 p-2 bg-popover border border-border rounded-lg shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="grid grid-cols-5 gap-1.5">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    handleAction("hiliteColor", c);
                    setShowHighlight(false);
                  }}
                  className="w-6 h-6 rounded-full border-2 border-border hover:scale-125 transition-transform"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
            <button
              onClick={() => {
                handleAction("hiliteColor", "transparent");
                setShowHighlight(false);
              }}
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Eraser className="w-3 h-3 inline ml-1" />
              הסר הדגשה
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border/50 mx-0.5" />

      {/* Font Family */}
      <div className="relative">
        <ToolbarBtn
          icon={Type}
          title="שנה גופן"
          onClick={() => {
            setShowFont(!showFont);
            setShowColors(false);
            setShowHighlight(false);
          }}
          active={showFont}
          extra={<ChevronDown className="w-2.5 h-2.5 mr-[-2px]" />}
        />
        {showFont && (
          <div
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 p-1.5 bg-popover border border-border rounded-lg shadow-lg min-w-[160px] max-h-[200px] overflow-y-auto"
            onMouseDown={(e) => e.preventDefault()}
          >
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.value}
                onClick={() => handleFontChange(f.value)}
                className="w-full text-right px-3 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Favorite */}
      <ToolbarBtn
        icon={Star}
        title="סמן כמועדף"
        onClick={handleFavorite}
        className="text-amber-500 hover:text-amber-400"
      />

      {/* Clear formatting */}
      <ToolbarBtn
        icon={Eraser}
        title="נקה עיצוב"
        onClick={() => handleAction("removeFormat")}
      />
    </div>
  );
};

// Small icon button for the floating toolbar
function ToolbarBtn({
  icon: Icon,
  title,
  onClick,
  active,
  className,
  extra,
}: {
  icon: React.ElementType;
  title: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
  extra?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center justify-center h-7 min-w-7 px-1 rounded-md",
        "text-muted-foreground hover:text-foreground hover:bg-accent/80",
        "transition-all duration-100",
        active && "bg-accent text-foreground",
        className
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {extra}
    </button>
  );
}
