/** Distance from the bottom-right corner of the window, in pixels. */
export interface Offset {
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Gap kept between a dragged element and the window edge. */
const EDGE_MARGIN = 8;

/**
 * Moves an element of `size` placed at `offset` so it sits fully inside `viewport`, keeping `margin`
 * from each edge. A viewport too small for the element pins it to the bottom-right margin.
 */
export function clampOffset(offset: Offset, size: Size, viewport: Size, margin = 0): Offset {
  const clamp = (value: number, room: number): number =>
    Math.round(Math.max(margin, Math.min(value, room - margin)));
  return {
    right: clamp(offset.right, viewport.width - size.width),
    bottom: clamp(offset.bottom, viewport.height - size.height),
  };
}

/** Reads a stored offset, rejecting anything that is not two finite numbers. */
export function parseOffset(raw: unknown): Offset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { right, bottom } = raw as Record<string, unknown>;
  return typeof right === 'number' &&
    typeof bottom === 'number' &&
    Number.isFinite(right) &&
    Number.isFinite(bottom)
    ? { right, bottom }
    : null;
}

function readOffset(storageKey: string): Offset | null {
  try {
    return parseOffset(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
  } catch {
    return null;
  }
}

function saveOffset(storageKey: string, offset: Offset | null): void {
  try {
    if (offset) localStorage.setItem(storageKey, JSON.stringify(offset));
    else localStorage.removeItem(storageKey);
  } catch {
    // The position still applies until the page reloads.
  }
}

/**
 * Lets the user drag a fixed-position element around the window. The spot is kept as an offset
 * from the bottom-right corner, so the element stays near that corner as the window resizes, and
 * is remembered in localStorage. A double click puts it back where the stylesheet places it.
 *
 * Returns a function that fits the element back inside the window; call it after the element is
 * shown or changes size.
 */
export function makeDraggable(element: HTMLElement, storageKey: string): () => void {
  // The chosen spot. It is clamped only when applied, so a briefly small window doesn't lose it.
  let offset = readOffset(storageKey);
  let drag: { x: number; y: number; start: Offset; pointerId: number } | null = null;

  const viewport = (): Size => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  });
  const size = (): Size => ({ width: element.offsetWidth, height: element.offsetHeight });

  const apply = (target: Offset | null): void => {
    if (!target) {
      element.style.removeProperty('right');
      element.style.removeProperty('bottom');
      return;
    }
    const fitted = clampOffset(target, size(), viewport(), EDGE_MARGIN);
    element.style.right = `${fitted.right}px`;
    element.style.bottom = `${fitted.bottom}px`;
  };

  // A hidden element has no size to fit, so wait until it is shown.
  const place = (): void => {
    if (!element.hidden) apply(offset);
  };

  const endDrag = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    // A plain click leaves the saved spot alone.
    if (!element.dataset.dragging) return;
    delete element.dataset.dragging;
    const right = Number.parseFloat(element.style.right);
    const bottom = Number.parseFloat(element.style.bottom);
    if (Number.isFinite(right) && Number.isFinite(bottom)) {
      offset = { right, bottom };
      saveOffset(storageKey, offset);
    }
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const view = viewport();
    drag = {
      x: event.clientX,
      y: event.clientY,
      start: { right: view.width - rect.right, bottom: view.height - rect.bottom },
      pointerId: event.pointerId,
    };
  });
  element.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    element.dataset.dragging = 'true';
    apply({
      right: drag.start.right - (event.clientX - drag.x),
      bottom: drag.start.bottom - (event.clientY - drag.y),
    });
  });
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  // Also ends a drag if the element is hidden while the button is down.
  element.addEventListener('lostpointercapture', endDrag);
  element.addEventListener('dblclick', () => {
    offset = null;
    saveOffset(storageKey, null);
    apply(null);
  });
  window.addEventListener('resize', place);

  return place;
}
