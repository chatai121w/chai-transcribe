import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import {
  JOBS_CENTER_KEY, readCloudJobsCenterVisible, readLocalJobsCenterVisible,
  writeLocalJobsCenterVisible,
} from "@/lib/jobsCenterPrefs";

/**
 * הגדרות תצוגה — מה מוצג על המסך בכל העמודים.
 *
 * כרגע יש כאן דבר אחד: מרכז המשימות. הוא כפתור צף שנמצא תמיד,
 * בכל עמוד, ומי שאינו משתמש בהורדות וברקע אינו צריך אותו כלל.
 *
 * הבחירה נשמרת בענן ולא בדפדפן בלבד, כדי שתעבור גם למחשב אחר.
 */
export function DisplaySettings() {
  const { toast } = useToast();
  const { preferences, patchTabSettings, isLoaded } = useCloudPreferences();

  const [jobsVisible, setJobsVisible] = useState<boolean>(() => readLocalJobsCenterVisible());

  useEffect(() => {
    if (!isLoaded) return;
    const cloud = readCloudJobsCenterVisible(preferences.tab_settings_json || "");
    if (cloud === null) {
      // אין עדיין ערך בענן — מעלים לשם את מה שנבחר כאן, כדי
      // שבחירה קיימת לא תימחק בכניסה הראשונה אחרי השינוי.
      patchTabSettings({ [JOBS_CENTER_KEY]: readLocalJobsCenterVisible() });
      return;
    }
    setJobsVisible(cloud);
    writeLocalJobsCenterVisible(cloud);
  }, [isLoaded, preferences.tab_settings_json, patchTabSettings]);

  const toggleJobs = (next: boolean) => {
    setJobsVisible(next);
    writeLocalJobsCenterVisible(next);
    patchTabSettings({ [JOBS_CENTER_KEY]: next });
    toast({
      title: next ? "מרכז המשימות יוצג" : "מרכז המשימות הוסתר",
      description: next
        ? "הכפתור העגול יחזור לפינה התחתונה בכל העמודים."
        : "הכפתור לא יוצג יותר. אפשר להחזיר אותו מכאן בכל רגע.",
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="jobs-center-visible" className="flex items-center gap-2 text-base font-medium">
            <Activity className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            הצג את מרכז המשימות
          </Label>
          <p className="text-sm leading-relaxed text-muted-foreground">
            כפתור עגול בפינה השמאלית התחתונה, בכל העמודים. פתיחתו מציגה את
            ההורדות, ההמרות והתמלולים שרצים ברקע.
          </p>
          <p className="text-xs text-muted-foreground">
            אם אינך משתמש בעבודות רקע — אפשר לכבות, והכפתור לא יתפוס מקום.
          </p>
        </div>
        <Switch
          id="jobs-center-visible"
          checked={jobsVisible}
          onCheckedChange={toggleJobs}
          aria-label="הצגת מרכז המשימות"
        />
      </div>
    </div>
  );
}
