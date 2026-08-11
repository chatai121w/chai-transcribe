import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./progress";

describe("Progress direction", () => {
  it("fills from right to left by default", () => {
    const { getByRole } = render(<Progress value={25} />);
    const root = getByRole("progressbar");
    expect(root).toHaveAttribute("dir", "rtl");
    expect(root.firstElementChild).toHaveStyle({ transform: "translateX(75%)" });
  });

  it("keeps an explicit left-to-right override", () => {
    const { getByRole } = render(<Progress value={25} dir="ltr" />);
    const root = getByRole("progressbar");
    expect(root).toHaveAttribute("dir", "ltr");
    expect(root.firstElementChild).toHaveStyle({ transform: "translateX(-75%)" });
  });
});
