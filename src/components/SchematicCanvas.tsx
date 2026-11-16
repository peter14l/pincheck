"use client";

import { useMemo, useState } from "react";
import {
  type CircuitState,
  type Diagnostic,
  type Wire,
  getBoard,
  getPeripheral,
} from "@/lib/hardwareEngine";

const BG = "#0B0F17";
const BOARD_X = 60;
const PERIPHERAL_X = 900;
const TOP = 60;

function endpointMatchesDiagnostic(
  diagnostic: Diagnostic,
  componentId: string,
  pinId: string,
): boolean {
  const pinMatches = (diagnostic.pinIds ?? []).includes(pinId);
  if (!pinMatches) return false;
  if (!diagnostic.componentIds || diagnostic.componentIds.length === 0) return true;
  return diagnostic.componentIds.includes(componentId);
}

export default function SchematicCanvas({
  circuitState,
  diagnostics,
  onWireChange,
  readOnly = false,
}: {
  circuitState: CircuitState;
  diagnostics: Diagnostic[];
  onWireChange?: (wires: Wire[]) => void;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<{ componentId: string; pinId: string } | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [hoveredWire, setHoveredWire] = useState<string | null>(null);

  const boards = circuitState.components.filter((component) => component.kind === "board");
  const peripherals = circuitState.components.filter(
    (component) => component.kind === "peripheral",
  );

  const boardGeometry = useMemo(() => {
    return boards.map((component, index) => {
      const board = getBoard(component.refId);
      const pinCount = board?.pins.length ?? 0;
      return {
        component,
        board,
        x: BOARD_X + index * 360,
        y: TOP,
        height: 40 + pinCount * 14,
      };
    });
  }, [boards]);

  const peripheralGeometry = useMemo(() => {
    return peripherals.map((component, index) => {
      const peripheral = getPeripheral(component.refId);
      const pinCount = peripheral?.pinRequirements.length ?? 0;
      return {
        component,
        peripheral,
        x: PERIPHERAL_X,
        y: TOP + index * 140,
        height: 40 + pinCount * 14,
      };
    });
  }, [peripherals]);

  const canvasHeight = useMemo(() => {
    const boardBottom = Math.max(0, ...boardGeometry.map((entry) => entry.y + entry.height));
    const peripheralBottom = Math.max(
      0,
      ...peripheralGeometry.map((entry) => entry.y + entry.height),
    );
    return Math.max(600, boardBottom + 80, peripheralBottom + 80);
  }, [boardGeometry, peripheralGeometry]);

  const errorWireIds = useMemo(() => {
    const ids = new Set<string>();
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== "CRITICAL" && diagnostic.severity !== "WARNING") continue;
      for (const wire of circuitState.wires) {
        if (
          endpointMatchesDiagnostic(diagnostic, wire.from.componentId, wire.from.pinId) ||
          endpointMatchesDiagnostic(diagnostic, wire.to.componentId, wire.to.pinId)
        ) {
          ids.add(wire.id);
        }
      }
    }
    return ids;
  }, [diagnostics, circuitState.wires]);

  const faultyEndpoints = useMemo(() => {
    const endpoints = new Set<string>();
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "INFO") continue;
      for (const componentId of diagnostic.componentIds ?? []) {
        for (const pinId of diagnostic.pinIds ?? []) {
          endpoints.add(`${componentId}:${pinId}`);
        }
      }
    }
    return endpoints;
  }, [diagnostics]);

  const pinPosition = (componentId: string, pinId: string): { x: number; y: number } | null => {
    const boardEntry = boardGeometry.find((entry) => entry.component.id === componentId);
    if (boardEntry) {
      const pinIndex = boardEntry.board?.pins.findIndex((pin) => pin.id === pinId) ?? -1;
      if (pinIndex < 0) return null;
      return { x: boardEntry.x + 12, y: boardEntry.y + 36 + pinIndex * 14 };
    }
    const peripheralEntry = peripheralGeometry.find((entry) => entry.component.id === componentId);
    if (peripheralEntry) {
      const pinIndex =
        peripheralEntry.peripheral?.pinRequirements.findIndex((req) => req.name === pinId) ?? -1;
      if (pinIndex < 0) return null;
      return { x: peripheralEntry.x + 12, y: peripheralEntry.y + 36 + pinIndex * 14 };
    }
    return null;
  };

  const handlePinClick = (componentId: string, pinId: string) => {
    if (readOnly || !onWireChange) return;
    if (!selected) {
      setSelected({ componentId, pinId });
      setSelectedWireId(null);
      return;
    }
    if (selected.componentId === componentId && selected.pinId === pinId) {
      setSelected(null);
      return;
    }
    const duplicate = circuitState.wires.some(
      (wire) =>
        (wire.from.componentId === selected.componentId &&
          wire.from.pinId === selected.pinId &&
          wire.to.componentId === componentId &&
          wire.to.pinId === pinId) ||
        (wire.to.componentId === selected.componentId &&
          wire.to.pinId === selected.pinId &&
          wire.from.componentId === componentId &&
          wire.from.pinId === pinId),
    );
    if (!duplicate) {
      const newWire: Wire = {
        id: `w-${crypto.randomUUID()}`,
        from: selected,
        to: { componentId, pinId },
      };
      onWireChange([...circuitState.wires, newWire]);
    }
    setSelected(null);
  };

  const deleteWire = (wireId: string | null) => {
    if (!wireId || readOnly || !onWireChange) return;
    onWireChange(circuitState.wires.filter((wire) => wire.id !== wireId));
    setSelectedWireId(null);
    setHoveredWire(null);
  };

  const boardPinForWire = (wire: Wire) => {
    const fromBoard = boardGeometry.find((entry) => entry.component.id === wire.from.componentId);
    if (fromBoard) {
      return fromBoard.board?.pins.find((pin) => pin.id === wire.from.pinId);
    }
    const toBoard = boardGeometry.find((entry) => entry.component.id === wire.to.componentId);
    return toBoard?.board?.pins.find((pin) => pin.id === wire.to.pinId);
  };

  const wireColor = (wire: Wire) => {
    const pin = boardPinForWire(wire);
    if (pin) {
      if (pin.modes.includes("power")) return "#EF4444";
      if (pin.modes.includes("gnd")) return "#64748B";
      if (pin.modes.includes("i2c-sda") || pin.modes.includes("i2c-scl")) return "#22D3EE";
      return "#A78BFA";
    }
    return "#A78BFA";
  };

  const wireLabel = (wire: Wire): string => {
    const pin = boardPinForWire(wire);
    const peripheralEnd =
      boardGeometry.some((entry) => entry.component.id === wire.from.componentId)
        ? wire.to
        : wire.from;
    const peripheralComponent = circuitState.components.find(
      (component) => component.id === peripheralEnd.componentId,
    );
    const peripheral = peripheralComponent
      ? getPeripheral(peripheralComponent.refId)
      : undefined;
    return `${pin?.label ?? wire.from.pinId} to ${peripheral?.name ?? peripheralEnd.componentId} ${peripheralEnd.pinId}`;
  };

  return (
    <div className="relative w-full" style={{ background: BG }}>
      <svg
        className="w-full"
        viewBox={`0 0 1200 ${canvasHeight}`}
        style={{ height: canvasHeight }}
        role="img"
        aria-label="Interactive circuit schematic"
      >
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1E293B" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1200" height={canvasHeight} fill={BG} />
        <rect width="1200" height={canvasHeight} fill="url(#grid)" />

        {boardGeometry.map(({ component, board, x, y, height }) => {
          if (!board) return null;
          return (
            <g key={component.id}>
              <rect x={x} y={y} width="260" height={height} rx="8" fill="#111827" stroke="#334155" />
              <text x={x + 130} y={y + 22} textAnchor="middle" fill="#E2E8F0" fontSize="13" fontWeight="600">
                {board.name}
              </text>
              {board.pins.map((pin, pinIndex) => {
                const isSelected =
                  selected?.componentId === component.id && selected.pinId === pin.id;
                const isFaulty = faultyEndpoints.has(`${component.id}:${pin.id}`);
                return (
                  <g
                    key={pin.id}
                    role="button"
                    tabIndex={readOnly ? -1 : 0}
                    aria-label={`${board.name} pin ${pin.label}${isFaulty ? ", has a diagnostic" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => handlePinClick(component.id, pin.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handlePinClick(component.id, pin.id);
                      }
                    }}
                    style={{ cursor: readOnly ? "default" : "pointer", outline: "none" }}
                  >
                    <title>{`${pin.label}: ${pin.modes.join(", ")}`}</title>
                    <circle
                      cx={x + 12}
                      cy={y + 36 + pinIndex * 14}
                      r={isSelected ? 5 : 4}
                      fill={isSelected ? "#FBBF24" : isFaulty ? "#DC2626" : "#475569"}
                    />
                    <text x={x + 22} y={y + 40 + pinIndex * 14} fill="#CBD5E1" fontSize="9">
                      {pin.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {peripheralGeometry.map(({ component, peripheral, x, y, height }) => {
          if (!peripheral) return null;
          return (
            <g key={component.id}>
              <rect x={x} y={y} width="220" height={height} rx="8" fill="#111827" stroke="#334155" />
              <text x={x + 110} y={y + 22} textAnchor="middle" fill="#E2E8F0" fontSize="12" fontWeight="600">
                {peripheral.name}
              </text>
              {peripheral.pinRequirements.map((req, pinIndex) => {
                const isSelected =
                  selected?.componentId === component.id && selected.pinId === req.name;
                const isFaulty = faultyEndpoints.has(`${component.id}:${req.name}`);
                return (
                  <g
                    key={req.name}
                    role="button"
                    tabIndex={readOnly ? -1 : 0}
                    aria-label={`${peripheral.name} pin ${req.name}${isFaulty ? ", has a diagnostic" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => handlePinClick(component.id, req.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handlePinClick(component.id, req.name);
                      }
                    }}
                    style={{ cursor: readOnly ? "default" : "pointer", outline: "none" }}
                  >
                    <title>{`${req.name}: ${req.type}`}</title>
                    <circle
                      cx={x + 12}
                      cy={y + 36 + pinIndex * 14}
                      r={isSelected ? 5 : 4}
                      fill={isSelected ? "#FBBF24" : isFaulty ? "#DC2626" : "#475569"}
                    />
                    <text x={x + 22} y={y + 40 + pinIndex * 14} fill="#CBD5E1" fontSize="9">
                      {req.name}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {circuitState.wires.map((wire) => {
          const fromPos = pinPosition(wire.from.componentId, wire.from.pinId);
          const toPos = pinPosition(wire.to.componentId, wire.to.pinId);
          if (!fromPos || !toPos) return null;
          const color = wireColor(wire);
          const isError = errorWireIds.has(wire.id);
          const isSelected = selectedWireId === wire.id;
          const path = `M ${fromPos.x} ${fromPos.y} C ${fromPos.x + 120} ${fromPos.y}, ${toPos.x - 120} ${toPos.y}, ${toPos.x} ${toPos.y}`;
          const midX = (fromPos.x + toPos.x) / 2;
          const midY = (fromPos.y + toPos.y) / 2;
          return (
            <g
              key={wire.id}
              onMouseEnter={() => setHoveredWire(wire.id)}
              onMouseLeave={() => setHoveredWire(null)}
            >
              <path
                d={path}
                fill="none"
                stroke={isError ? "#DC2626" : color}
                strokeWidth={isSelected ? 4 : 2.5}
                opacity={0.9}
                role={readOnly ? undefined : "button"}
                tabIndex={readOnly ? -1 : 0}
                aria-label={`${wireLabel(wire)}${isError ? ", diagnostic on this wire" : ""}`}
                onClick={() => {
                  if (readOnly) return;
                  setSelectedWireId(wire.id);
                  setSelected(null);
                }}
                onKeyDown={(event) => {
                  if (readOnly) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedWireId(wire.id);
                  }
                }}
                style={{ cursor: readOnly ? "default" : "pointer", outline: "none" }}
                className={isError ? "animate-pulse" : ""}
              />
              {hoveredWire === wire.id && (
                <g pointerEvents="none">
                  <rect
                    x={midX - 90}
                    y={midY - 20}
                    width="180"
                    height={isError ? 36 : 22}
                    rx="6"
                    fill={isError ? "#7F1D1D" : "#111827"}
                    stroke={isError ? "#DC2626" : "#334155"}
                  />
                  <text x={midX} y={midY - 6} textAnchor="middle" fill={isError ? "#FECACA" : "#CBD5E1"} fontSize="9">
                    {wireLabel(wire)}
                  </text>
                  {isError && (
                    <text x={midX} y={midY + 9} textAnchor="middle" fill="#FECACA" fontSize="8">
                      {diagnostics.find(
                        (diagnostic) =>
                          endpointMatchesDiagnostic(diagnostic, wire.from.componentId, wire.from.pinId) ||
                          endpointMatchesDiagnostic(diagnostic, wire.to.componentId, wire.to.pinId),
                      )?.code ?? "diagnostic"}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {readOnly && (
        <div className="absolute right-4 top-4 rounded border border-slate-700 bg-slate-900/80 px-3 py-1 font-mono text-[10px] text-slate-400">
          read-only shared view
        </div>
      )}

      {!readOnly && selected && (
        <div className="absolute bottom-4 left-4 rounded bg-slate-900/90 px-3 py-2 font-mono text-xs text-slate-200">
          Selected {selected.pinId}. Click another pin to wire it, or click it again to cancel.
        </div>
      )}

      {!readOnly && selectedWireId && (
        <div className="absolute bottom-4 right-4 flex items-center gap-3 rounded bg-slate-900/90 px-3 py-2 font-mono text-xs text-slate-200">
          <span className="max-w-[240px] truncate">
            {wireLabel(circuitState.wires.find((wire) => wire.id === selectedWireId) ?? {
              id: selectedWireId,
              from: { componentId: "", pinId: "" },
              to: { componentId: "", pinId: "" },
            })}
          </span>
          <button
            type="button"
            onClick={() => deleteWire(selectedWireId)}
            className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-red-300 hover:bg-red-500/20"
          >
            Delete wire
          </button>
          <button
            type="button"
            onClick={() => setSelectedWireId(null)}
            className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {peripherals.length === 0 && (
        <p className="absolute inset-x-0 top-4 mx-auto w-fit rounded border border-slate-700 bg-slate-900/80 px-3 py-1 font-mono text-[11px] text-slate-400">
          Describe a circuit above to place components.
        </p>
      )}
    </div>
  );
}
