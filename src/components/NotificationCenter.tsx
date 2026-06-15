import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, CheckCheck, Trash2, X, AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const typeConfig = {
  success: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
  error: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10" },
};

export const NotificationCenter = () => {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "עכשיו";
    if (diff < 3600000) return `לפני ${Math.floor(diff / 60000)} דק'`;
    if (diff < 86400000) return `לפני ${Math.floor(diff / 3600000)} שע'`;
    return date.toLocaleDateString('he-IL');
  };

  return (
    <div className="relative" dir="rtl">
      <Button
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0"
        onClick={() => setOpen(o => !o)}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -left-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-red-500 text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </Button>

      {open && (
        <Card className="absolute left-0 top-full mt-2 w-80 max-h-96 z-50 shadow-xl border">
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-semibold text-sm">התראות</h3>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                  <CheckCheck className="w-3 h-3 ml-1" />
                  סמן הכל
                </Button>
              )}
              {notifications.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={clearAll}>
                  <Trash2 className="w-3 h-3 ml-1" />
                  נקה
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <ScrollArea className="max-h-72">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                אין התראות
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map(n => {
                  const config = typeConfig[n.type];
                  const Icon = config.icon;
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "p-3 hover:bg-muted/50 cursor-pointer transition-colors",
                        !n.read && "bg-primary/5"
                      )}
                      onClick={() => markRead(n.id)}
                    >
                      <div className="flex items-start gap-2 flex-row-reverse">
                        <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0", config.bg)}>
                          <Icon className={cn("w-3.5 h-3.5", config.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-row-reverse">
                            <span className={cn("text-sm font-medium truncate", !n.read && "font-bold")}>{n.title}</span>
                            {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                          </div>
                          {n.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.description}</p>
                          )}
                          <span className="text-[10px] text-muted-foreground mt-1 block">{formatTime(n.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>
      )}
    </div>
  );
};
