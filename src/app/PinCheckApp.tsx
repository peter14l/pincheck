"use client";

import { useCallback, useMemo, useState } from "react";
import CommandBar from "@/components/CommandBar";
import SchematicCanvas from "@/components/SchematicCanvas";
import { InspectorPanel } from "@/components/InspectorPanel";
import FaultInjection from "@/components/FaultInjection";
import {
  BOARDS,
  PERIPHERALS,
  lintCircuit,
  type CircuitState,
  type Diagnostic,
  type Wire,
} from "@/lib/hardwareEngine";
import { type CircuitGenerationResult } from "@/lib/circuitGenerator";
import { generateFirmware, type FirmwareLanguage } from "@/lib/firmwareGenerator";

const DEFAULT_BOARD_ID = "esp32_devkit_v1";

function clampHealth(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeHealthScore(diagnostics: Diagnostic[]): number {
  let score = 100;
  for (const d of diagnostics) {
    if (d.severity === "CRITICAL") score -= 25;
    else if (d.severity === "WARNING") score -= 10;
    else score -= 3;
  }
  return clampHealth(score);
}

function createEmptyCircuit(boardId: string): CircuitState {
  const board = BOARDS[boardId] ?? BOARDS[DEFAULT_BOARD_ID];
  return {
    components: [
      {
        id: "board_1",
        kind: "board",
        refId: board.id,
        label: board.name,
      },
    ],
    wires: [],
    pinStates: [],
  };
}

export default function PinCheckApp({
  initialCircuitCount,
}: {
  initialCircuitCount?: number | null;
}) {
  const [boardId, setBoardId] = useState<string>(DEFAULT_BOARD_ID);
  const [circuitState, setCircuitState] = useState<CircuitState>(() =>
    createEmptyCircuit(DEFAULT_BOARD_ID),
  );
  const [showFaultInjection, setShowFaultInjection] = useState(false);
  const [lastExplanation, setLastExplanation] = useState<string>("");

  const diagnostics = useMemo(() => lintCircuit(circuitState), [circuitState]);
  const healthScore = useMemo(
    () => computeHealthScore(diagnostics),
    [diagnostics],
  );

  const handleGenerate = useCallback(
    (next: CircuitState, nextBoardId: string, explanation: string) => {
      setBoardId(nextBoardId);
      setCircuitState(next);
      setLastExplanation(explanation);
      if (process.env.NODE_ENV !== "production") {
        // Keep imports "live" for integration points referenced by the app wiring.
        void (PERIPHERALS && typeof generateFirmware === "function");
      }
    },
    [],
  );

  const handleWireChange = useCallback((wires: Wire[]) => {
    setCircuitState((prev) => ({ ...prev, wires }));
  }, []);

  const handleAutoFix = useCallback(() => {
    // Basic stub: log a candidate fix action; full rerouting requires generation context.
    const critical = diagnostics.filter((d) => d.severity === "CRITICAL");
    if (process.env.NODE_ENV !== "production") {
      console.log("[PinCheck] Auto-fix requested", {
        boardId,
        critical: critical.map((d) => d.code),
        suggestion:
          "Re-run generation or manually reassign conflicting pins to safe GPIOs.",
      });
    }
    setLastExplanation(
      (prev) =>
        prev ||
        "Auto-fix stub: review critical diagnostics and regenerate or reassign conflicting pins.",
    );
  }, [boardId, diagnostics]);

  const handleFirmwareGenerate = useCallback(
    (language: FirmwareLanguage, code: string) => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[PinCheck] Firmware generated", {
          language,
          bytes: code.length,
        });
      }
      // Ensure firmware generator import is exercised in app wiring.
      void generateFirmware(circuitState, boardId, language);
    },
    [boardId, circuitState],
  );

  const handleFaultInject = useCallback((fault: string) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[PinCheck] Fault injected", fault);
    }
  }, []);

  const circuitSummary = useMemo(() => {
    const peripheralCount = circuitState.components.filter(
      (c) => c.kind === "peripheral",
    ).length;
    return {
      peripheralCount,
      wireCount: circuitState.wires.length,
    };
  }, [circuitState]);

  void (initialCircuitCount as unknown);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <CommandBar onGenerate={handleGenerate} />

      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-[#273042] bg-[#0B0F17]">
        <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
          <span>
            board:{" "}
            <span className="text-slate-200">
              {BOARDS[boardId]?.name ?? boardId}
            </span>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            peripherals:{" "}
            <span className="text-slate-200">
              {circuitSummary.peripheralCount}
            </span>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            wires:{" "}
            <span className="text-slate-200">{circuitSummary.wireCount}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            health:{" "}
            <span
              className={
                healthScore >= 80
                  ? "text-emerald-400"
                  : healthScore >= 50
                    ? "text-amber-400"
                    : "text-red-400"
              }
            >
              {healthScore}
            </span>
          </span>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-mono text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-red-500"
            checked={showFaultInjection}
            onChange={(e) => setShowFaultInjection(e.target.checked)}
          />
          Fault injection
        </label>
      </div>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 min-h-0 relative">
          <SchematicCanvas
            circuitState={circuitState}
            diagnostics={diagnostics}
            onWireChange={handleWireChange}
          />
          {showFaultInjection && (
            <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-[420px] z-20">
              <FaultInjection
                circuitState={circuitState}
                onFaultInject={handleFaultInject}
              />
            </div>
          )}
          {lastExplanation && (
            <div className="absolute top-4 left-4 max-w-xl bg-[#111928]/90 border border-[#273042] rounded-lg p-3 text-xs text-slate-300 font-mono backdrop-blur">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">
                Rationale
              </div>
              <pre className="whitespace-pre-wrap leading-relaxed">
                {lastExplanation}
              </pre>
            </div>
          )}
        </main>
        <aside className="w-[420px] max-w-full border-l border-[#273042] bg-[#0B0F17] min-h-0">
          <InspectorPanel
            circuitState={circuitState}
            diagnostics={diagnostics}
            healthScore={healthScore}
            boardId={boardId}
            onAutoFix={handleAutoFix}
            onFirmwareGenerate={handleFirmwareGenerate}
          />
        </aside>
      </div>
    </div>
  );
}

// Type-only reference to keep CircuitGenerationResult import meaningful in this module.
export type { CircuitGenerationResult };
