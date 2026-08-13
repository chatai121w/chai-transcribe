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
});
