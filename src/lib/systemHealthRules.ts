/**
 * איך נקבע מצב הבריאות של המערכת.
 *
 * הכלל הקודם ספר כל התראה פעילה, בלי קשר לגיל שלה. התוצאה: התראה
 * בת שעה השאירה את המערכת מסומנת "לא יציב" גם כששום דבר לא קרה
 * מאז — אפס שגיאות לדקה והשרת עונה. מצב בריאות אמור לתאר את
 * **עכשיו**; ההיסטוריה נשארת ברשימת ההתראות לעיון.
 */

export type HealthStatus = "healthy" | "degraded" | "critical";

/** עד כמה אחורה התראה עוד מעידה על המצב הנוכחי. */
export const RECENT_ALERT_MS = 10 * 60 * 1000;

export interface HealthInput {
  /** שגיאות לדקה בחמש הדקות האחרונות. */
  errorRate: number;
  /** האם שרת התמלול עונה. */
  serverUp: boolean;
  /** התראות פעילות, עם זמן היצירה שלהן. */
  alerts: Array<{ dismissed?: boolean; timestamp: number }>;
  now?: number;
}

/** כמה התראות פעילות ועדיין רלוונטיות. */
export function countRecentAlerts(
  alerts: HealthInput["alerts"],
  now = Date.now(),
  windowMs = RECENT_ALERT_MS,
): number {
  return alerts.filter((alert) => !alert.dismissed && (now - alert.timestamp) < windowMs).length;
}

export function computeHealthStatus({ errorRate, serverUp, alerts, now = Date.now() }: HealthInput): HealthStatus {
  const recent = countRecentAlerts(alerts, now);
  if (errorRate > 5 || !serverUp || recent >= 5) return "critical";
  if (errorRate > 1 || recent >= 2) return "degraded";
  return "healthy";
}

/** התיאור בעברית של המצב. */
export function healthLabel(status: HealthStatus): string {
  if (status === "critical") return "תקלה";
  if (status === "degraded") return "לא יציב";
  return "תקין";
}
