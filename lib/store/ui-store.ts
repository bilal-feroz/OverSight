import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface UiState {
  /** Soft gaze heatmap + critical-region outlines on the approval card (O). */
  overlay: boolean;
  /** Developer diagnostics panel and raw gaze cursor (D). */
  diagnostics: boolean;
  /** Switch to critical-only review mode automatically when a low-attention pattern is detected. */
  criticalOnlyAuto: boolean;
  shortcutsOpen: boolean;
  composeOpen: boolean;
  setOverlay: (on: boolean) => void;
  setDiagnostics: (on: boolean) => void;
  setCriticalOnlyAuto: (on: boolean) => void;
  setShortcutsOpen: (on: boolean) => void;
  setComposeOpen: (on: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      overlay: false,
      diagnostics: false,
      criticalOnlyAuto: true,
      shortcutsOpen: false,
      composeOpen: false,
      setOverlay: (overlay) => set({ overlay }),
      setDiagnostics: (diagnostics) => set({ diagnostics }),
      setCriticalOnlyAuto: (criticalOnlyAuto) => set({ criticalOnlyAuto }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setComposeOpen: (composeOpen) => set({ composeOpen }),
    }),
    {
      name: "oversight.ui.v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ overlay: s.overlay, diagnostics: s.diagnostics, criticalOnlyAuto: s.criticalOnlyAuto }),
    },
  ),
);
