import { describe, it, expect } from "vitest";
import { computeHealthStatus, countRecentAlerts, healthLabel, RECENT_ALERT_MS } from "./systemHealthRules";

const NOW = 1_700_000_000_000;
const minutesAgo = (minutes: number) => NOW - minutes * 60 * 1000;

describe("ספירת התראות רלוונטיות", () => {
  it("סופרת התראה טרייה", () => {
    expect(countRecentAlerts([{ timestamp: minutesAgo(1) }], NOW)).toBe(1);
  });

  /*
    זה לב התיקון. במצב אמיתי הוצגה "לא יציב" בגלל שתי התראות — אחת
    בת 18 דקות ואחת בת שעה — בזמן ששום דבר לא קרה באותו רגע, אפס
    שגיאות לדקה והשרת ענה.
  */
  it("אינה סופרת התראה ישנה", () => {
    expect(countRecentAlerts([{ timestamp: minutesAgo(18) }, { timestamp: minutesAgo(60) }], NOW)).toBe(0);
  });

  it("אינה סופרת התראה שנדחתה", () => {
    expect(countRecentAlerts([{ timestamp: minutesAgo(1), dismissed: true }], NOW)).toBe(0);
  });

  it("הגבול הוא עשר דקות", () => {
    expect(countRecentAlerts([{ timestamp: NOW - RECENT_ALERT_MS + 1000 }], NOW)).toBe(1);
    expect(countRecentAlerts([{ timestamp: NOW - RECENT_ALERT_MS - 1000 }], NOW)).toBe(0);
  });
});

describe("מצב הבריאות", () => {
  const base = { errorRate: 0, serverUp: true, alerts: [], now: NOW };

  it("תקין כששקט", () => {
    expect(computeHealthStatus(base)).toBe("healthy");
  });

  it("תקין גם כשיש התראות ישנות ברשימה", () => {
    expect(computeHealthStatus({
      ...base,
      alerts: [{ timestamp: minutesAgo(18) }, { timestamp: minutesAgo(60) }],
    })).toBe("healthy");
  });

  it("לא יציב כששתי התראות טריות", () => {
    expect(computeHealthStatus({
      ...base,
      alerts: [{ timestamp: minutesAgo(1) }, { timestamp: minutesAgo(2) }],
    })).toBe("degraded");
  });

  it("לא יציב כשיש יותר משגיאה לדקה", () => {
    expect(computeHealthStatus({ ...base, errorRate: 1.5 })).toBe("degraded");
  });

  it("תקלה כשהשרת אינו עונה", () => {
    expect(computeHealthStatus({ ...base, serverUp: false })).toBe("critical");
  });

  it("תקלה כשיש מבול שגיאות", () => {
    expect(computeHealthStatus({ ...base, errorRate: 7 })).toBe("critical");
  });

  it("תקלה כשחמש התראות טריות", () => {
    const alerts = Array.from({ length: 5 }, (_, index) => ({ timestamp: minutesAgo(index) }));
    expect(computeHealthStatus({ ...base, alerts })).toBe("critical");
  });

  it("חמש התראות ישנות אינן תקלה", () => {
    const alerts = Array.from({ length: 5 }, (_, index) => ({ timestamp: minutesAgo(30 + index) }));
    expect(computeHealthStatus({ ...base, alerts })).toBe("healthy");
  });
});

describe("התיאור בעברית", () => {
  it("מתאר כל מצב במילה אחת", () => {
    expect(healthLabel("healthy")).toBe("תקין");
    expect(healthLabel("degraded")).toBe("לא יציב");
    expect(healthLabel("critical")).toBe("תקלה");
  });
});
