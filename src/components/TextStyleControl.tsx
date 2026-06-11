import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Type, AlignRight, AlignCenter, AlignLeft, AlignJustify } from "lucide-react";

interface TextStyleControlProps {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  lineHeight: number;
  textAlign?: string;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: string) => void;
  onTextColorChange: (color: string) => void;
  onLineHeightChange: (height: number) => void;
  onTextAlignChange?: (align: string) => void;
}

const FONT_FAMILIES = [
  { value: 'Assistant', label: 'Assistant' },
  { value: 'Rubik', label: 'Rubik' },
  { value: 'Heebo', label: 'Heebo' },
  { value: 'Frank Ruhl Libre', label: 'Frank Ruhl Libre' },
  { value: 'David Libre', label: 'David Libre' },
  { value: 'Noto Sans Hebrew', label: 'Noto Sans Hebrew' },
  { value: 'Arial', label: 'Arial' },
  { value: 'system-ui', label: 'מערכת' }
];

const TEXT_COLORS = [
  { value: 'hsl(var(--foreground))', label: 'ברירת מחדל' },
  { value: 'hsl(220 60% 8%)', label: 'כחול כהה' },
  { value: 'hsl(0 0% 0%)', label: 'שחור' },
  { value: 'hsl(220 40% 30%)', label: 'כחול אפור' },
  { value: 'hsl(0 0% 20%)', label: 'אפור כהה' }
];

const ALIGNMENTS = [
  { value: 'right', label: 'ימין', icon: AlignRight },
  { value: 'center', label: 'מרכז', icon: AlignCenter },
  { value: 'left', label: 'שמאל', icon: AlignLeft },
  { value: 'justify', label: 'ישור', icon: AlignJustify },
];

export const TextStyleControl = ({
  fontSize,
  fontFamily,
  textColor,
  lineHeight,
  textAlign = 'right',
  onFontSizeChange,
  onFontFamilyChange,
  onTextColorChange,
  onLineHeightChange,
  onTextAlignChange,
}: TextStyleControlProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="הגדרות תצוגה"
        >
          <Type className="h-3.5 w-3.5 text-[#0f1e43]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-5"
        side="bottom"
        align="end"
        dir="rtl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Type className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">הגדרות תצוגה</h3>
        </div>

        <div className="space-y-4">
          {/* Font family */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">גופן</Label>
            <Select value={fontFamily} onValueChange={onFontFamilyChange}>
              <SelectTrigger className="h-8 text-sm" dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {FONT_FAMILIES.map(font => (
                  <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Font size slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">גודל גופן</Label>
              <span className="text-xs font-mono text-primary">{fontSize}px</span>
            </div>
            <Slider
              value={[fontSize]}
              onValueChange={(v) => onFontSizeChange(v[0])}
              min={12}
              max={36}
              step={1}
              dir="ltr"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>12</span>
              <span>24</span>
              <span>36</span>
            </div>
          </div>

          {/* Text color */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">צבע טקסט</Label>
            <Select value={textColor} onValueChange={onTextColorChange}>
              <SelectTrigger className="h-8 text-sm" dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {TEXT_COLORS.map(color => (
                  <SelectItem key={color.value} value={color.value}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: color.value }} />
                      {color.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text alignment */}
          {onTextAlignChange && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">יישור טקסט</Label>
              <div className="flex gap-1">
                {ALIGNMENTS.map(a => (
                  <Button
                    key={a.value}
                    variant={textAlign === a.value ? "default" : "outline"}
                    size="sm"
                    className="flex-1 h-8 flex flex-col items-center gap-0.5 p-1"
                    onClick={() => onTextAlignChange(a.value)}
                  >
                    <a.icon className="w-4 h-4" />
                    <span className="text-[9px]">{a.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Line height slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">גובה שורה</Label>
              <span className="text-xs font-mono text-primary">{lineHeight.toFixed(1)}</span>
            </div>
            <Slider
              value={[lineHeight]}
              onValueChange={(v) => onLineHeightChange(v[0])}
              min={1.0}
              max={2.5}
              step={0.1}
              dir="ltr"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>צמוד</span>
              <span>רגיל</span>
              <span>רפוי</span>
            </div>
          </div>

          {/* Reset button */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7 mt-1"
            onClick={() => {
              onFontSizeChange(16);
              onFontFamilyChange('Assistant');
              onTextColorChange('hsl(var(--foreground))');
              onLineHeightChange(1.6);
              onTextAlignChange?.('right');
            }}
          >
            איפוס ברירת מחדל
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
