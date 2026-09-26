/**
 * Registry of semantic regions currently rendered on screen.
 *
 * The app owns the DOM, so it knows exactly where each decision-critical
 * sentence is drawn: every block renders with `data-attention-region="<id>"`
 * and registers its element here. Gaze is mapped to these elements'
 * bounding boxes; nothing is inferred from camera pixels.
 *
 * Regions are scoped by request id: while one request's card animates out
 * and the next animates in, both may render a block called `impact-2`, and a
 * review must only ever measure its own request's elements.
 */
import type { RegionMeta } from "@/types/attention";

export interface RegisteredRegion {
  el: HTMLElement;
  meta: RegionMeta;
}

const keyOf = (scope: string | undefined, id: string) => `${scope ?? ""}::${id}`;

class RegionRegistry {
  private regions = new Map<string, RegisteredRegion>();

  register(meta: RegionMeta, el: HTMLElement): () => void {
    const key = keyOf(meta.scope, meta.id);
    this.regions.set(key, { el, meta });
    return () => {
      if (this.regions.get(key)?.el === el) this.regions.delete(key);
    };
  }

  get(id: string, scope?: string): RegisteredRegion | undefined {
    return this.regions.get(keyOf(scope, id));
  }

  /** All regions, or only those belonging to one request. */
  list(scope?: string): RegisteredRegion[] {
    const all = [...this.regions.values()];
    return scope === undefined ? all : all.filter((r) => r.meta.scope === scope);
  }
}

export const regionRegistry = new RegionRegistry();
