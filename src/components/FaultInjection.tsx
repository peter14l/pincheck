"use client";

import { type CircuitFaultType, type CircuitState } from "@/lib/hardwareEngine";

const FAULTS: Array<{ type: CircuitFaultType; label: string; description: string }> = [
  {
    type: "open",
    label: "Open Circuit",
    description: "Break a signal path and watch the linter flag the dead connection.",
  },
  {
    type: "floating",
    label: "Floating Pin Noise",
    description: "Leave an input undriven so it picks up noise and false triggers.",
  },
  {
    type: "brownout",
    label: "3.1V Brownout Drop",
    description: "Sag the supply rail and surface the resulting reliability risk.",
  },
];

export default function FaultInjection({
  circuitState,
  onFaultInject,
  onClearFaults,
}: {
  circuitState: CircuitState;
  onFaultInject: (type: CircuitFaultType) => void;
  onClearFaults?: () => void;
}) {
  const faults = circuitState.faults ?? [];

  return (
    <div className="p-4 bg-[#0B0F17] text-slate-200 rounded-lg border border-slate-800 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-red-400">
          Fault injection
        </h3>
        {faults.length > 0 && onClearFaults && (
          <button
            type="button"
            onClick={onClearFaults}
            className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            clear {faults.length}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {FAULTS.map((fault) => (
          <button
            key={fault.type}
            type="button"
            onClick={() => onFaultInject(fault.type)}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left transition-colors hover:border-red-400/60 hover:bg-red-500/20"
          >
            <span className="block text-xs font-semibold text-red-300">{fault.label}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">
              {fault.description}
            </span>
          </button>
        ))}
      </div>

      {faults.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
          {faults.map((fault) => (
            <li key={fault.id} className="font-mono text-[10px] text-amber-300">
              {fault.type}
              {fault.rail ? ` @ ${fault.rail}` : ""}
              {fault.note ? ` \u00B7 ${fault.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
