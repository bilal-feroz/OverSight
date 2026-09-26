"use client";

import { createContext, forwardRef, useCallback, useContext, useEffect, useRef } from "react";
import type { RiskLevel } from "@/types/approval";
import type { RegionRole } from "@/types/attention";
import { regionRegistry } from "@/lib/attention/registry";

/** The approval request that owns the regions rendered below it. */
const RegionScopeContext = createContext<string | undefined>(undefined);
export const RegionScope = RegionScopeContext.Provider;

interface AttentionRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  regionId: string;
  regionRole: RegionRole;
  label: string;
  words: number;
  severity?: RiskLevel;
}

/**
 * Renders content as a semantic attention region: the element is tagged
 * `data-attention-region` and registered (scoped to its request) so gaze can
 * be tested against its live bounding box.
 */
export const AttentionRegion = forwardRef<HTMLDivElement, AttentionRegionProps>(function AttentionRegion(
  { regionId, regionRole, label, words, severity, children, ...rest },
  forwardedRef,
) {
  const scope = useContext(RegionScopeContext);
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      localRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    return regionRegistry.register({ id: regionId, role: regionRole, label, words, severity, scope }, el);
  }, [regionId, regionRole, label, words, severity, scope]);

  return (
    <div
      ref={setRef}
      data-attention-region={regionId}
      data-attention-role={regionRole}
      data-attention-scope={scope}
      {...rest}
    >
      {children}
    </div>
  );
});
