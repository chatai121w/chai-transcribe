import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("adjudicates directly from the side-by-side decision view", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedDiffView
        versions={versions}
        preselectedLeftId="base"
        preselectedRightId="new"
        onSaveVerifiedVersion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "הכרעה צד-בצד" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מגרסת הבסיס"));
    expect(screen.getByTestId("quick-adjudication-dialog")).toBeVisible();
    await user.click(screen.getByTestId("confirm-quick-once"));
    await user.click(screen.getByRole("tab", { name: "הכרעה", exact: true }));
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

    await user.click(screen.getByRole("tab", { name: "הכרעה צד-בצד" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    const input = screen.getByTestId("quick-custom-input");
    await user.clear(input);
    await user.type(input, "בבא");
    await user.click(screen.getByRole("button", { name: "אשר תיקון" }));
    await user.click(screen.getByRole("tab", { name: "הכרעה", exact: true }));

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

    await user.click(screen.getByRole("tab", { name: "הכרעה צד-בצד" }));
    await user.dblClick(screen.getByTitle("לחץ פעמיים לאפשרויות אישור מהגרסה החדשה"));
    await user.click(screen.getByTestId("confirm-quick-all"));
    await user.click(screen.getByRole("tab", { name: "הכרעה", exact: true }));

    expect(screen.getByTestId("verified-text")).toHaveValue("חורבן כאן, ועוד חורבן. אבל מחורבים לא");
    expect(screen.getByTestId("global-replacement-rules")).toHaveTextContent("החלף בכל הטקסט: חורבים ב-חורבן");
  });
});
