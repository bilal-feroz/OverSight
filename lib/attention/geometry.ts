/**
 * Geometry the attention tracker measures against.
 *
 * The tracker never reads `window`, `document` or `performance` itself: it
 * asks a GeometrySource. In the browser that is DomGeometrySource (live
 * bounding boxes of the registered regions); tests supply a scripted layout,
 * so the whole gaze-to-evidence pipeline runs in Node.
 */
import type { RectLike, RegionMeta } from "@/types/attention";
import { clamp } from "@/lib/utils";
import { intersect, rectFromDOM } from "./regions";
import { regionRegistry } from "./registry";

export interface RegionGeometry {
  meta: RegionMeta;
  /** Viewport CSS px. */
  rect: RectLike;
}

export interface GeometrySource {
  /** Viewport size in CSS px. */
  viewport(): { width: number; height: number };
  /** Where content can be seen: the viewport intersected with the scroll container. */
  clipRect(): RectLike;
  /** The approval card, or null while it is not mounted. */
  cardRect(): RectLike | null;
  /** Rendered regions of one request; detached and zero-size elements are excluded. */
  regions(scope: string): RegionGeometry[];
  /** Controls marked `data-gaze-anchor` inside the card (the decision buttons). */
  controlRects(): RectLike[];
  /** Current scroll position of the request as the fraction of it seen so far (0-1). */
  scrollDepth(): number;
  /** The page is visible and has focus. */
  focused(): boolean;
  /** Monotonic clock in ms (performance.now() in the browser). */
  now(): number;
}

export interface DomGeometryOptions {
  getCard: () => HTMLElement | null;
  getScrollContainer: () => HTMLElement | null;
}

/** Live DOM geometry: the region registry plus getBoundingClientRect. */
export class DomGeometrySource implements GeometrySource {
  constructor(private readonly opts: DomGeometryOptions) {}

  viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  clipRect(): RectLike {
    const view: RectLike = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const container = this.opts.getScrollContainer();
    if (!container) return view;
    return intersect(view, rectFromDOM(container.getBoundingClientRect())) ?? view;
  }

  cardRect(): RectLike | null {
    const card = this.opts.getCard();
    return card ? rectFromDOM(card.getBoundingClientRect()) : null;
  }

  regions(scope: string): RegionGeometry[] {
    const out: RegionGeometry[] = [];
    for (const { el, meta } of regionRegistry.list(scope)) {
      if (!el.isConnected) continue;
      const rect = rectFromDOM(el.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) continue;
      out.push({ meta, rect });
    }
    return out;
  }

  controlRects(): RectLike[] {
    const card = this.opts.getCard();
    if (!card) return [];
    return [...card.querySelectorAll<HTMLElement>("[data-gaze-anchor]")]
      .map((el) => rectFromDOM(el.getBoundingClientRect()))
      .filter((r) => r.width > 0 && r.height > 0);
  }

  scrollDepth(): number {
    const container = this.opts.getScrollContainer();
    if (!container || container.scrollHeight <= 0) return 1;
    return clamp((container.scrollTop + container.clientHeight) / container.scrollHeight, 0, 1);
  }

  focused(): boolean {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  now(): number {
    return performance.now();
  }
}
