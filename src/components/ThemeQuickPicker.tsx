import { useState } from 'react';
import { Check, Palette, Settings } from 'lucide-react';
import { useCloudPreferences } from '@/hooks/useCloudPreferences';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';

type ThemeQuickPickerProps = {
  onManage: () => void;
  className?: string;
};

const themeColor = (value: string) => value.includes(' ') ? `hsl(${value})` : value;

export function ThemeQuickPicker({ onManage, className }: ThemeQuickPickerProps) {
  const [open, setOpen] = useState(false);
  const { activeThemeId, allThemes, setTheme } = useTheme();
  const { updatePreferences } = useCloudPreferences();
  const activeTheme = allThemes.find(theme => theme.id === activeThemeId) || allThemes[0];

  const chooseTheme = (themeId: string) => {
    const theme = allThemes.find(item => item.id === themeId);
    if (!theme || theme.id === activeThemeId) return;

    setTheme(theme.id);
    void updatePreferences({
      theme: theme.id,
      custom_themes: localStorage.getItem('app_custom_themes') || '[]',
    });
    toast({ title: 'ערכת נושא הוחלפה', description: theme.nameHe });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', className)}
          title="פתח בורר ערכות נושא"
          aria-label="פתח בורר ערכות נושא"
        >
          <Palette className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        dir="rtl"
        align="end"
        side="bottom"
        sideOffset={8}
        className="z-[70] w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-md border-border p-0 shadow-xl"
      >
        <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
          <div className="text-right">
            <p className="font-semibold">תצוגת נושא</p>
            <p className="text-xs opacity-75">בחר מראה לכל המערכת</p>
          </div>
          <Palette className="h-5 w-5 text-accent" />
        </div>

        <ScrollArea className="h-[min(25rem,62vh)]">
          <div className="grid grid-cols-2 gap-2 p-3">
            {allThemes.map(theme => {
              const isActive = theme.id === activeThemeId;
              const swatches = [theme.colors.primary, theme.colors.accent, theme.colors.background];
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => chooseTheme(theme.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'relative min-h-20 rounded-md border bg-card p-3 text-right transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive && 'border-primary ring-2 ring-primary/25',
                  )}
                >
                  <span className="mb-3 flex items-center gap-1" aria-hidden="true">
                    {swatches.map((color, index) => (
                      <span
                        key={`${theme.id}-${index}`}
                        className="h-4 flex-1 border border-black/10 first:rounded-r last:rounded-l"
                        style={{ backgroundColor: themeColor(color) }}
                      />
                    ))}
                  </span>
                  <span className="block truncate text-sm font-semibold">{theme.nameHe}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{theme.isCustom ? 'ערכה אישית' : theme.source === 'community' ? 'ערכה משותפת' : 'ערכה מובנית'}</span>
                  {isActive && (
                    <span className="absolute left-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="הערכה הפעילה">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Settings className="h-4 w-4" />
            ניהול ויצירת ערכות נושא
          </button>
        </div>
        {activeTheme && <span className="sr-only">הערכה הפעילה: {activeTheme.nameHe}</span>}
      </PopoverContent>
    </Popover>
  );
}
