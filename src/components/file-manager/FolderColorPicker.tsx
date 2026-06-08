import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Palette } from 'lucide-react';

const COLORS = ['#eab308', '#3b82f6', '#10b981', '#ef4444', '#a855f7', '#f97316', '#06b6d4', '#64748b'];
const EMOJIS = ['📁', '⭐', '💼', '🎵', '📞', '🎙️', '📝', '🔥', '💡', '🏠', '👨‍👩‍👧', '🎓'];

interface Props {
  color: string | null;
  emoji: string | null;
  onChange: (patch: { color?: string | null; emoji?: string | null }) => void;
  trigger?: React.ReactNode;
}

export const FolderColorPicker = ({ color, emoji, onChange, trigger }: Props) => (
  <Popover>
    <PopoverTrigger asChild>
      {trigger || <Button size="icon" variant="ghost" className="h-7 w-7"><Palette className="w-3.5 h-3.5" /></Button>}
    </PopoverTrigger>
    <PopoverContent dir="rtl" className="w-64 p-3" align="end">
      <div className="text-xs text-muted-foreground mb-2">צבע</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => onChange({ color: null })}
          className="w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/40 hover:border-foreground"
          title="ללא"
        />
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => onChange({ color: c })}
            className={`w-6 h-6 rounded-full border-2 transition ${color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-110'}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="text-xs text-muted-foreground mb-2">אמוג'י</div>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onChange({ emoji: null })}
          className="w-7 h-7 rounded hover:bg-muted text-xs text-muted-foreground"
        >ללא</button>
        {EMOJIS.map(e => (
          <button
            key={e}
            onClick={() => onChange({ emoji: e })}
            className={`w-7 h-7 rounded hover:bg-muted text-lg ${emoji === e ? 'bg-muted' : ''}`}
          >{e}</button>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);
