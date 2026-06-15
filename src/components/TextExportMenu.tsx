import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Download, Share2, MessageCircle, Mail, Copy, FileText, FileDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface TextExportMenuProps {
  /** Text to export. */
  getText: () => string;
  /** Optional file name (no extension). Defaults to "טקסט". */
  filename?: string;
  /** Optional subject for email/title. */
  subject?: string;
  /** Visual size. */
  size?: "icon" | "sm";
  /** When true, show plain Download icon instead of Share. */
  variant?: "share" | "download";
  /** Optional label next to the icon. */
  label?: string;
  /** Extra className. */
  className?: string;
  /** Tooltip. */
  title?: string;
}

const WHATSAPP_LIMIT = 4000; // wa.me URL length safety cap

function download(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Compact icon button that opens a menu with copy / download / WhatsApp / email actions.
 * Drop next to any block of text. Uses the local OS WhatsApp/email handler via wa.me / mailto.
 */
export function TextExportMenu({
  getText,
  filename = "טקסט",
  subject,
  size = "icon",
  variant = "share",
  label,
  className = "",
  title,
}: TextExportMenuProps) {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "טקסט";

  const grab = (): string | null => {
    const t = (getText() || "").trim();
    if (!t) {
      toast({ title: "אין טקסט לייצא", variant: "destructive" });
      return null;
    }
    return t;
  };

  const handleCopy = async () => {
    const t = grab();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      toast({ title: "הטקסט הועתק ללוח" });
    } catch {
      toast({ title: "שגיאה בהעתקה", variant: "destructive" });
    }
  };

  const handleTxt = () => {
    const t = grab();
    if (t) {
      download(t, `${safeName}.txt`, "text/plain");
      toast({ title: "הקובץ הורד" });
    }
  };

  const handleMd = () => {
    const t = grab();
    if (t) {
      download(t, `${safeName}.md`, "text/markdown");
      toast({ title: "הקובץ הורד" });
    }
  };

  const handleDoc = () => {
    const t = grab();
    if (!t) return;
    // Simple .doc compatible HTML — opens cleanly in Word/Google Docs.
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${safeName}</title></head><body><pre style="font-family:Arial,sans-serif;white-space:pre-wrap;direction:rtl;text-align:right;">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
    download(html, `${safeName}.doc`, "application/msword");
    toast({ title: "הקובץ הורד" });
  };

  const handleWhatsApp = () => {
    const t = grab();
    if (!t) return;
    let body = t;
    if (body.length > WHATSAPP_LIMIT) {
      body = body.slice(0, WHATSAPP_LIMIT) + "\n\n…(הטקסט נחתך — שלח כקובץ לטקסט מלא)";
    }
    const url = `https://wa.me/?text=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleEmail = () => {
    const t = grab();
    if (!t) return;
    const subj = encodeURIComponent(subject || filename || "טקסט");
    const body = encodeURIComponent(t);
    window.location.href = `mailto:?subject=${subj}&body=${body}`;
  };

  const handleShareNative = async () => {
    const t = grab();
    if (!t) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator;
    if (nav?.share) {
      try {
        await nav.share({ title: subject || filename, text: t });
      } catch {
        /* user cancelled */
      }
    } else {
      handleCopy();
    }
  };

  const Icon = variant === "download" ? Download : Share2;
  const tooltip = title || "ייצוא ושיתוף";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={`${size === "icon" ? "h-7 w-7" : "h-7 px-2 text-xs gap-1"} text-muted-foreground hover:text-yellow-600 hover:bg-yellow-500/10 ${className}`}
          title={tooltip}
          aria-label={tooltip}
        >
          <Icon className="w-4 h-4" />
          {label && <span>{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" dir="rtl" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">ייצוא ושיתוף</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopy} className="text-xs gap-2 cursor-pointer">
          <Copy className="w-4 h-4" />העתק ללוח
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleTxt} className="text-xs gap-2 cursor-pointer">
          <FileText className="w-4 h-4" />הורד כ-TXT
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleMd} className="text-xs gap-2 cursor-pointer">
          <FileText className="w-4 h-4" />הורד כ-Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDoc} className="text-xs gap-2 cursor-pointer">
          <FileDown className="w-4 h-4" />הורד כ-Word (.doc)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleWhatsApp} className="text-xs gap-2 cursor-pointer">
          <MessageCircle className="w-4 h-4 text-green-600" />שלח ב-WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleEmail} className="text-xs gap-2 cursor-pointer">
          <Mail className="w-4 h-4 text-blue-600" />שלח באימייל
        </DropdownMenuItem>
        {typeof navigator !== "undefined" && (navigator as unknown as { share?: unknown }).share && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleShareNative} className="text-xs gap-2 cursor-pointer">
              <Share2 className="w-4 h-4" />שיתוף מערכת
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TextExportMenu;
