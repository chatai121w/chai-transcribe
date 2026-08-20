import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedDiffView } from "./AdvancedDiffView";
import type { TextVersion } from "./TextEditHistory";

vi.mock("./ComparisonSourceDialog", () => ({ ComparisonSourceDialog: () => null }));

const versions: TextVersion[] = [
  {
    id: "base",
    text: "אמר בברא בתרא היום",
    timestamp: new Date("2026-08-13T09:00:00Z"),
    source: "original",
  },
  {
    id: "new",
    text: "אמר בטרה בתרא היום",
    timestamp: new Date("2026-08-13T09:01:00Z"),
    source: "manual",
  },
];

describe("AdvancedDiffView adjudication", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens quick adjudication directly from the regular side-by-side view", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס"));
    expect(screen.getByTestId("quick-adjudication-dialog")).toBeVisible();
    await user.click(screen.getByTestId("confirm-quick-once"));
    await user.click(screen.getByRole("tab", { name: /^הכרעה$/ }));

    expect(screen.getByTestId("verified-text")).toHaveValue("אמר בברא בתרא היום");
  });

  it("chooses a source word and saves a new verified version", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={onSave}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "הכרעה" }));
    await user.click(screen.getByRole("button", { name: /בחר מגרסת הבסיס/ }));
    expect(screen.getByTestId("verified-text")).toHaveValue("אמר בברא בתרא היום");
    await user.click(screen.getByTestId("save-verified-version"));
    expect(onSave).toHaveBeenCalledWith("אמר בברא בתרא היום");
  });

  it("accepts a correction when both versions are wrong", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "הכרעה" }));
    const input = screen.getByTestId("adjudication-custom-input");
    fireEvent.change(input, { target: { value: "בבא" } });
    await user.click(screen.getByRole("button", { name: "אשר" }));
    expect(screen.getByTestId("verified-text")).toHaveValue("אמר בבא בתרא היום");
  });

  it("switches to the aligned layout and preserves its adjudication", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: "הכרעה צד-בצד" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "תצוגה לפי הבדלים" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס"));
    expect(screen.getByTestId("quick-adjudication-dialog")).toBeVisible();
    await user.click(screen.getByTestId("confirm-quick-once"));
    await user.click(screen.getByRole("button", { name: "תצוגה רציפה" }));
    expect(screen.getByText("הוכרעו 1")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /^הכרעה$/ }));
    expect(screen.getByTestId("verified-text")).toHaveValue("אמר בברא בתרא היום");
  });

  it("offers a custom correction from the side-by-side dialog", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "תצוגה לפי הבדלים" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    const input = screen.getByTestId("quick-custom-input");
    await user.clear(input);
    await user.type(input, "בבא");
    await user.click(screen.getByRole("button", { name: "אשר תיקון" }));
    await user.click(screen.getByRole("tab", { name: /^הכרעה$/ }));

    expect(screen.getByTestId("verified-text")).toHaveValue("אמר בבא בתרא היום");
  });

  it("applies an approved correction to every exact repeated occurrence", async () => {
    const user = userEvent.setup();
    const repeatedVersions: TextVersion[] = [
      {
        id: "repeat-base",
        text: "חורבים כאן, ועוד חורבים. אבל מחורבים לא",
        timestamp: new Date("2026-08-13T09:00:00Z"),
        source: "original",
      },
      {
        id: "repeat-new",
        text: "חורבן כאן, ועוד חורבים. אבל מחורבים לא",
        timestamp: new Date("2026-08-13T09:01:00Z"),
        source: "manual",
      },
    ];

    render(
      <AdvancedDiffView
        versions={repeatedVersions}
        preselectedLeftId="repeat-base"
        preselectedRightId="repeat-new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "הכרעה" }));
    await user.click(screen.getByRole("checkbox", { name: "תקן את כל המופעים הזהים בטקסט" }));
    await user.click(screen.getByRole("button", { name: "אשר" }));

    expect(screen.getByTestId("verified-text")).toHaveValue("חורבן כאן, ועוד חורבן. אבל מחורבים לא");
    expect(screen.getByTestId("global-replacement-rules")).toHaveTextContent("החלף בכל הטקסט: חורבים ב-חורבן");
  });

  it("applies a repeated correction from the side-by-side dialog", async () => {
    const user = userEvent.setup();
    const repeatedVersions: TextVersion[] = [
      {
        id: "repeat-base-quick",
        text: "חורבים כאן, ועוד חורבים. אבל מחורבים לא",
        timestamp: new Date("2026-08-13T09:00:00Z"),
        source: "original",
      },
      {
        id: "repeat-new-quick",
        text: "חורבן כאן, ועוד חורבים. אבל מחורבים לא",
        timestamp: new Date("2026-08-13T09:01:00Z"),
        source: "manual",
      },
    ];

    render(
      <AdvancedDiffView
        versions={repeatedVersions}
        preselectedLeftId="repeat-base-quick"
        preselectedRightId="repeat-new-quick"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "תצוגה לפי הבדלים" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    await user.click(screen.getByTestId("confirm-quick-all"));
    await user.click(screen.getByRole("tab", { name: /^הכרעה$/ }));

    expect(screen.getByTestId("verified-text")).toHaveValue("חורבן כאן, ועוד חורבן. אבל מחורבים לא");
    expect(screen.getByTestId("global-replacement-rules")).toHaveTextContent("החלף בכל הטקסט: חורבים ב-חורבן");
  });

  it("saves and immediately corrects the opposite side when the right side is approved", async () => {
    const user = userEvent.setup();
    const onSaveImmediate = vi.fn();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
        onSaveImmediateVersion={onSaveImmediate}
      />,
    );

    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    await user.click(screen.getByTestId("save-quick-once"));

    expect(onSaveImmediate).toHaveBeenCalledWith("אמר בטרה בתרא היום", "תיקון מיידי בהשוואה");
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס")).not.toBeInTheDocument();
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה")).not.toBeInTheDocument();
  });

  it("saves and immediately corrects the right side when the left side is approved", async () => {
    const user = userEvent.setup();
    const onSaveImmediate = vi.fn();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
        onSaveImmediateVersion={onSaveImmediate}
      />,
    );

    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס"));
    await user.click(screen.getByTestId("save-quick-once"));

    expect(onSaveImmediate).toHaveBeenCalledWith("אמר בברא בתרא היום", "תיקון מיידי בהשוואה");
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס")).not.toBeInTheDocument();
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה")).not.toBeInTheDocument();
  });

  it("saves a custom correction and updates both displayed sides immediately", async () => {
    const user = userEvent.setup();
    const onSaveImmediate = vi.fn();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
        onSaveImmediateVersion={onSaveImmediate}
      />,
    );

    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    await user.clear(screen.getByTestId("quick-custom-input"));
    await user.type(screen.getByTestId("quick-custom-input"), "בבא");
    await user.click(screen.getByTestId("save-custom-immediately"));

    expect(onSaveImmediate).toHaveBeenCalledWith("אמר בבא בתרא היום", "תיקון מיידי בשתי הגרסאות");
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס")).not.toBeInTheDocument();
    expect(screen.queryByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה")).not.toBeInTheDocument();
  });
});
