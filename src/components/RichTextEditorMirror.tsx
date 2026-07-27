/**
 * RichTextEditorMirror — visual mirror of the RichTextEditor toolbar for use
 * in a paired/locked column. Renders the SAME icon strip with the SAME
 * dimensions so both columns line up at the exact same vertical height.
 *
 * Only the alignment buttons are interactive (they broadcast to the shared
 * `onTextAlignChange`, keeping both columns aligned). All other buttons are
 * no-ops that show a tooltip indicating editing is done on the opposite side.
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Copy, Scissors, FileDown,
  AlignRight, AlignCenter, AlignLeft, AlignJustify,
  Undo, Redo, Type, Eraser, Trash2,
  Maximize2, SplitSquareVertical, Eye, Search, SpellCheck,
  ChevronDown, Save,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface RichTextEditorMirrorProps {
  textAlign?: 'right' | 'left' | 'center' | 'justify';
  onTextAlignChange?: (a: 'right' | 'left' | 'center' | 'justify') => void;
}

const NOOP_TITLE = "ערוך מהעמודה הנגדית";

const MirrorBtn = ({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) => (
  <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="sm"
          onClick={onClick}
          className={cn(
            "h-8 w-8 p-0",
            active && "bg-accent ring-1 ring-primary/30",
            !onClick && "opacity-60 cursor-default",
          )}
        >
          <Icon className="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const RichTextEditorMirror = ({ textAlign, onTextAlignChange }: RichTextEditorMirrorProps) => {
  return (
    <Card className="p-4" dir="rtl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 pb-3 border-b">
          {/* Undo / Redo — mirror only */}
          <MirrorBtn icon={Undo} label={NOOP_TITLE} />
          <MirrorBtn icon={Redo} label={NOOP_TITLE} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* T popover — mirror only */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1 font-bold text-base px-2 opacity-60 cursor-default"
            title={NOOP_TITLE}
          >
            T
            <ChevronDown className="w-3 h-3" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* === יישור — INTERACTIVE: broadcasts to both columns === */}
          <MirrorBtn
            icon={AlignRight}
            label="יישור לימין"
            active={textAlign === 'right'}
            onClick={onTextAlignChange ? () => onTextAlignChange('right') : undefined}
          />
          <MirrorBtn
            icon={AlignCenter}
            label="מרכוז"
            active={textAlign === 'center'}
            onClick={onTextAlignChange ? () => onTextAlignChange('center') : undefined}
          />
          <MirrorBtn
            icon={AlignLeft}
            label="יישור לשמאל"
            active={textAlign === 'left'}
            onClick={onTextAlignChange ? () => onTextAlignChange('left') : undefined}
          />
          <MirrorBtn
            icon={AlignJustify}
            label="יישור לשני הצדדים"
            active={textAlign === 'justify'}
            onClick={onTextAlignChange ? () => onTextAlignChange('justify') : undefined}
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          <MirrorBtn icon={Copy} label={NOOP_TITLE} />
          <MirrorBtn icon={Scissors} label={NOOP_TITLE} />
          <MirrorBtn icon={Trash2} label={NOOP_TITLE} />
          <MirrorBtn icon={Eraser} label={NOOP_TITLE} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          <MirrorBtn icon={Save} label={NOOP_TITLE} />
          <MirrorBtn icon={Copy} label={NOOP_TITLE} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          <MirrorBtn icon={Type} label={NOOP_TITLE} />
          <MirrorBtn icon={Eye} label={NOOP_TITLE} />
          <MirrorBtn icon={SplitSquareVertical} label={NOOP_TITLE} />
          <MirrorBtn icon={Maximize2} label={NOOP_TITLE} />

          <MirrorBtn icon={Search} label={NOOP_TITLE} />
          <MirrorBtn icon={SpellCheck} label={NOOP_TITLE} />

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs opacity-60 cursor-default"
            title={NOOP_TITLE}
          >
            <FileDown className="w-4 h-4" />
            ייצא
            <ChevronDown className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
