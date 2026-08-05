export type ScrollBlock = "nearest" | "center";

/** Scrolls only the supplied container, never the page or an ancestor panel. */
export function scrollWithinContainer(
  container: HTMLElement,
  target: HTMLElement,
  block: ScrollBlock = "nearest",
  behavior: ScrollBehavior = "smooth",
) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const padding = 16;
  let delta = 0;

  if (block === "center") {
    delta = targetRect.top + targetRect.height / 2
      - (containerRect.top + containerRect.height / 2);
  } else if (targetRect.top < containerRect.top + padding) {
    delta = targetRect.top - containerRect.top - padding;
  } else if (targetRect.bottom > containerRect.bottom - padding) {
    delta = targetRect.bottom - containerRect.bottom + padding;
  }

  if (Math.abs(delta) < 1) return;
  container.scrollTo({
    top: Math.max(0, container.scrollTop + delta),
    behavior,
  });
}
