"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CommandBar from "@/components/CommandBar";
import SchematicCanvas from "@/components/SchematicCanvas";
import { InspectorPanel } from "@/components/InspectorPanel";
import FaultInjection from "@/components/FaultInjection";
import SaveShareDialog from "@/components/SaveShareDialog";
import UndoToast from "@/components/UndoToast";
import {
  BOARDS,
  PERIPHERALS,
  autoFixCircuit,
  derivePinStates,
  lintCircuit,
  scoreDiagnostics,
  type CircuitFault,
  type CircuitFaultType,
  type CircuitState,
  type Wire,
} from "@/lib/hardwareEngine";

const DEFAULT_BOARD_ID = "esp32_devkit_v1";

type UndoEntry = {
  /** Monotonic id so a replacement restarts the auto-dismiss timer. */
  key: number;
  state: CircuitState;
  /** Short action name for the accessible Undo label. */
  label: string;
  /** Human-readable message shown when there is no notice text. */
  message: string;
};

/**
 * Snapshot of everything a destructive edit can change. Arrays and nested
 * wire endpoints are copied so later immutable updates cannot mutate the
 * stored snapshot; pinStates are captured explicitly because they are
 * derived during wire edits.
 */
function cloneCircuitState(state: CircuitState): CircuitState {
  return {
    components: state.components.map((component) => ({ ...component })),
    wires: state.wires.map((wire) => ({
      ...wire,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    pinStates: state.pinStates?.map((pinState) => ({ ...pinState })),
    faults: state.faults?.map((fault) => ({ ...fault })),
  };
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
    faults: [],
  };
}

function nextFault(state: CircuitState, type: CircuitFaultType): CircuitFault {
  const board = state.components.find((component) => component.kind === "board");
  const boardRef = board ? BOARDS[board.refId] : undefined;
  const boardPinIds = new Set(boardRef?.pins.map((pin) => pin.id) ?? []);
  const signalWire = state.wires.find((wire) => {
    const fromIsBoard = wire.from.componentId === board?.id && boardPinIds.has(wire.from.pinId);
    const toIsBoard = wire.to.componentId === board?.id && boardPinIds.has(wire.to.pinId);
    return fromIsBoard || toIsBoard;
  });
  const peripheralEnd = signalWire
    ? signalWire.from.componentId === board?.id
      ? signalWire.to
      : signalWire.from
    : undefined;
  const inputPin = (state.pinStates ?? []).find(
    (pinState) =>
      Boolean(boardRef) &&
      pinState.componentId === board?.id &&
      boardPinIds.has(pinState.pinId) &&
      pinState.direction !== "output",
  );

  return {
    id: `fault_${Date.now()}_${type}`,
    type,
    ...(type === "brownout"
      ? { rail: boardRef && boardRef.logicVoltage > 3.6 ? ("5V" as const) : ("3.3V" as const) }
      : {}),
    ...(type === "open" && peripheralEnd
      ? { componentId: peripheralEnd.componentId, pinId: peripheralEnd.pinId }
      : {}),
    ...(type === "floating" && inputPin
      ? { componentId: inputPin.componentId, pinId: inputPin.pinId }
      : {}),
    note:
      type === "open"
        ? "signal path severed at runtime"
        : type === "floating"
          ? "input left undriven"
          : "supply rail sag under load",
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
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const undoKeyRef = useRef(0);

  const diagnostics = useMemo(() => lintCircuit(circuitState), [circuitState]);
  const healthScore = useMemo(() => scoreDiagnostics(diagnostics), [diagnostics]);

  const pushUndo = useCallback(
    (state: CircuitState, label: string, message: string) => {
      undoKeyRef.current += 1;
      setUndo({
        key: undoKeyRef.current,
        state: cloneCircuitState(state),
        label,
        message,
      });
    },
    [],
  );

  const handleGenerate = useCallback(
    (next: CircuitState, nextBoardId: string, explanation: string) => {
      setBoardId(nextBoardId);
      setCircuitState(next);
      setLastExplanation(explanation);
      setNotice(null);
      setUndo(null);
    },
    [],
  );

  const handleWireChange = useCallback(
    (wires: Wire[]) => {
      // SchematicCanvas only reports completed mutations (one click per wire
      // add, one per delete), so each call is already one undo step.
      pushUndo(circuitState, "wiring change", "Wiring updated");
      const next = { ...circuitState, wires };
      setCircuitState({ ...next, pinStates: derivePinStates(next) });
      setNotice(null);
    },
    [circuitState, pushUndo],
  );

  const handleAutoFix = useCallback(() => {
    const result = autoFixCircuit(circuitState);
    if (result.changes.length === 0) {
      setNotice("No automatic fixes available. Review the remaining diagnostics manually.");
      return;
    }
    pushUndo(circuitState, "auto-fix", "Auto-fix applied");
    setCircuitState(result.state);
    setNotice(
      `Auto-fix applied ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}: ${result.changes
        .map((change) => change.description)
        .join("; ")}`,
    );
  }, [circuitState, pushUndo]);

  const handleUndo = useCallback(() => {
    if (!undo) return;
    setCircuitState(cloneCircuitState(undo.state));
    setUndo(null);
    setNotice("Change undone");
  }, [undo]);

  const handleUndoExpire = useCallback(() => setUndo(null), []);

  const handleFaultInject = useCallback((type: CircuitFaultType) => {
    // Fault edits are outside undo history, but snapshots include faults, so
    // drop a pending snapshot rather than risk it silently reverting a fault.
    setUndo(null);
    setCircuitState((prev) => ({
      ...prev,
      faults: [...(prev.faults ?? []), nextFault(prev, type)],
    }));
    setShowFaultInjection(true);
    setNotice(null);
  }, []);

  const handleClearFaults = useCallback(() => {
    // Same rationale as fault injection: keep undo from reverting fault edits.
    setUndo(null);
    setCircuitState((prev) => ({ ...prev, faults: [] }));
    setNotice("Injected faults cleared.");
  }, []);

  const circuitSummary = useMemo(() => {
    const peripheralCount = circuitState.components.filter(
      (component) => component.kind === "peripheral",
    ).length;
    const peripheralNames = circuitState.components
      .filter((component) => component.kind === "peripheral")
      .map((component) => PERIPHERALS[component.refId]?.name ?? component.refId);
    return {
      peripheralCount,
      wireCount: circuitState.wires.length,
      faultCount: circuitState.faults?.length ?? 0,
      title: peripheralNames.length > 0
        ? `${BOARDS[boardId]?.name ?? boardId} + ${peripheralNames.join(", ")}`
        : `${BOARDS[boardId]?.name ?? boardId} circuit`,
    };
  }, [circuitState, boardId]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <CommandBar onGenerate={handleGenerate} />

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-[#273042] bg-[#0B0F17]">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
          <span>
            board: <span className="text-slate-200">{BOARDS[boardId]?.name ?? boardId}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            peripherals: <span className="text-slate-200">{circuitSummary.peripheralCount}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            wires: <span className="text-slate-200">{circuitSummary.wireCount}</span>
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
          {typeof initialCircuitCount === "number" && (
            <>
              <span className="text-slate-600">|</span>
              <span>
                saved: <span className="text-slate-200">{initialCircuitCount}</span>
              </span>
            </>
          )}
          {circuitSummary.faultCount > 0 && (
            <>
              <span className="text-slate-600">|</span>
              <span className="text-red-400">faults: {circuitSummary.faultCount}</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-mono text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-red-500"
              checked={showFaultInjection}
              onChange={(event) => setShowFaultInjection(event.target.checked)}
            />
            Fault injection
          </label>
          <Link
            href="/gallery"
            className="rounded-lg border border-[#273042] px-3 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:border-emerald-400/50 hover:text-white"
          >
            Gallery
          </Link>
          <SaveShareDialog
            boardId={boardId}
            circuitState={circuitState}
            healthScore={healthScore}
            suggestedTitle={circuitSummary.title}
          />
        </div>
      </div>

      {(notice || undo) && (
        <div
          role="status"
          className="flex items-start justify-between gap-4 border-b border-emerald-400/20 bg-emerald-400/5 px-6 py-2 font-mono text-xs text-emerald-200"
        >
          <span className="min-w-0 flex-1">{notice ?? undo?.message}</span>
          <div className="flex shrink-0 items-center gap-3">
            {undo && (
              <UndoToast
                key={undo.key}
                action={undo.label}
                onUndo={handleUndo}
                onExpire={handleUndoExpire}
              />
            )}
            {notice && (
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 text-emerald-400/70 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]"
                aria-label="Dismiss message"
              >
                dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <main id="main-content" className="relative min-h-[520px] min-w-0 flex-1">
          <SchematicCanvas
            circuitState={circuitState}
            diagnostics={diagnostics}
            onWireChange={handleWireChange}
          />
          {showFaultInjection && (
            <div className="absolute bottom-4 left-4 right-4 z-20 md:right-auto md:w-[420px]">
              <FaultInjection
                circuitState={circuitState}
                onFaultInject={handleFaultInject}
                onClearFaults={handleClearFaults}
              />
            </div>
          )}
          {lastExplanation && (
            <div className="absolute top-4 left-4 z-10 max-w-xl rounded-lg border border-[#273042] bg-[#111928]/90 p-3 font-mono text-xs text-slate-300 backdrop-blur">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">
                Rationale
              </div>
              <pre className="whitespace-pre-wrap leading-relaxed">{lastExplanation}</pre>
            </div>
          )}
        </main>
        <aside className="min-h-0 w-full border-t border-[#273042] bg-[#0B0F17] lg:w-[420px] lg:border-l lg:border-t-0">
          <InspectorPanel
            circuitState={circuitState}
            diagnostics={diagnostics}
            healthScore={healthScore}
            boardId={boardId}
            onAutoFix={handleAutoFix}
            onFirmwareGenerate={() => undefined}
          />
        </aside>
      </div>
    </div>
  );
}
