"use client";

import { useEffect } from "react";

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Undo affordance for the most recent destructive circuit edit.
 *
 * Rendered inside the app's existing role="status" notice bar, so this
 * component must not add its own live region. The parent announces the
 * accompanying message; this only owns the button and its expiry timer.
 */
export default function UndoToast({
  action,
  onUndo,
  onExpire,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  /** Short action name, used for the accessible button label. */
  action: string;
  onUndo: () => void;
  onExpire: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onExpire, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onExpire, timeoutMs]);

  return (
    <button
      type="button"
      onClick={onUndo}
      aria-label={`Undo ${action}`}
      className="shrink-0 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 font-mono text-xs text-emerald-200 transition-colors hover:border-emerald-300/70 hover:bg-emerald-400/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]"
    >
      Undo
    </button>
  );
}
