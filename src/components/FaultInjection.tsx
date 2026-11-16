"use client";

import { useState } from "react";
import { type CircuitState } from "@/lib/hardwareEngine";

const FAULTS = ["Open Circuit", "Floating Pin Noise", "3.1V Brownout Drop"];

export default function FaultInjection({
  circuitState,
  onFaultInject,
}: {
  circuitState: CircuitState;
  onFaultInject: (fault: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  void circuitState;

  const inject = (fault: string) => {
    setLog((l) => [...l, `[${new Date().toLocaleTimeString()}] ${fault}`]);
    onFaultInject(fault);
  };

  return (
    <div className="p-4 bg-[#0B0F17] text-slate-200 rounded-lg border border-slate-800">
      <button
        onClick={() => setActive((a) => !a)}
        className={`px-4 py-2 rounded font-semibold ${active ? "bg-red-600 text-white animate-pulse" : "bg-slate-700 text-slate-100"}`}
      >
        {active ? "Chaos Mode ACTIVE" : "Inject Fault / Chaos Mode"}
      </button>
      {active && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {FAULTS.map((f) => (
            <button key={f} onClick={() => inject(f)} className="px-3 py-1 text-xs rounded bg-red-900/60 border border-red-700 hover:bg-red-800">
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 h-40 overflow-auto bg-black/60 rounded p-2 font-mono text-xs text-green-400">
        {log.map((l, i) => <div key={i}>{l}</div>)}
        {log.length === 0 && <div className="text-slate-600">serial monitor idle…</div>}
      </div>
    </div>
  );
}
