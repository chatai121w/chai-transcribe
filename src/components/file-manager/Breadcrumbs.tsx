import { ChevronLeft, Home } from 'lucide-react';
import type { FolderNode } from '@/hooks/useFolderTree';

interface Props {
  path: FolderNode[];
  onNavigate: (id: string | null) => void;
}

export const Breadcrumbs = ({ path, onNavigate }: Props) => (
  <div className="flex items-center gap-1 text-sm flex-wrap" dir="rtl">
    <button
      onClick={() => onNavigate(null)}
      className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-yellow-700 font-medium"
    >
      <Home className="w-3.5 h-3.5" />
      הבית
    </button>
    {path.map((f, i) => (
      <div key={f.id} className="flex items-center gap-1">
        <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        <button
          onClick={() => onNavigate(f.id)}
          disabled={i === path.length - 1}
          className="px-2 py-1 rounded hover:bg-muted disabled:font-semibold disabled:hover:bg-transparent"
        >
          {f.emoji && <span className="ml-1">{f.emoji}</span>}
          {f.name}
        </button>
      </div>
    ))}
  </div>
);
