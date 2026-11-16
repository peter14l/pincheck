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

export default function SchematicCanvas({
  circuitState,
  diagnostics,
  onWireChange,
}: {
  circuitState: CircuitState;
  diagnostics: Diagnostic[];
  onWireChange: (wires: Wire[]) => void;
}) {
  const [selected, setSelected] = useState<{ componentId: string; pinId: string } | null>(null);
  const [hoveredWire, setHoveredWire] = useState<string | null>(null);

  const errorWireIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of diagnostics) {
      if (d.severity === "CRITICAL") {
        for (const w of circuitState.wires) {
          if ((d.pinIds ?? []).includes(w.from.pinId) || (d.pinIds ?? []).includes(w.to.pinId)) {
            ids.add(w.id);
          }
        }
      }
    }
    return ids;
  }, [diagnostics, circuitState.wires]);

  const boards = circuitState.components.filter((c) => c.kind === "board");
  const peripherals = circuitState.components.filter((c) => c.kind === "peripheral");

  const handlePinClick = (componentId: string, pinId: string) => {
    if (!selected) {
      setSelected({ componentId, pinId });
      return;
    }
    if (selected.componentId === componentId && selected.pinId === pinId) {
      setSelected(null);
      return;
    }
    const newWire: Wire = { id: `w-${crypto.randomUUID()}`, from: selected, to: { componentId, pinId } };
    onWireChange([...circuitState.wires, newWire]);
    setSelected(null);
  };

  const wireColor = (w: Wire) => {
    const fromComp = circuitState.components.find((c) => c.id === w.from.componentId);
    const isBoard = fromComp?.kind === "board";
    const board = isBoard ? getBoard(fromComp!.refId) : getBoard(circuitState.components.find((c) => c.id === w.to.componentId)?.refId ?? "");
    const pinId = isBoard ? w.from.pinId : w.to.pinId;
    const pin = board?.pins.find((p) => p.id === pinId);
    if (pin) {
      if (pin.modes.includes("power")) return "#EF4444";
      if (pin.modes.includes("gnd")) return "#64748B";
      if (pin.modes.includes("i2c-sda") || pin.modes.includes("i2c-scl")) return "#22D3EE";
      return "#A78BFA";
    }
    return "#A78BFA";
  };

  return (
    <div className="relative w-full h-full" style={{ background: BG }}>
      <svg className="w-full h-full" viewBox="0 0 1200 700">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1E293B" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1200" height="700" fill={BG} />
        <rect width="1200" height="700" fill="url(#grid)" />

        {boards.map((comp, i) => {
          const board = getBoard(comp.refId);
          if (!board) return null;
          const x = 60 + i * 360;
          const y = 60;
          return (
            <g key={comp.id}>
              <rect x={x} y={y} width="260" height={40 + board.pins.length * 14} rx="8" fill="#111827" stroke="#334155" />
              <text x={x + 130} y={y + 22} textAnchor="middle" fill="#E2E8F0" fontSize="13" fontWeight="600">{board.name}</text>
              {board.pins.map((pin, pi) => (
                <g key={pin.id} onClick={() => handlePinClick(comp.id, pin.id)} style={{ cursor: "pointer" }}>
                  <circle cx={x + 12} cy={y + 36 + pi * 14} r="4" fill={selected?.componentId === comp.id && selected.pinId === pin.id ? "#FBBF24" : "#475569"} />
                  <text x={x + 22} y={y + 40 + pi * 14} fill="#CBD5E1" fontSize="9">{pin.label}</text>
                </g>
              ))}
            </g>
          );
        })}

        {peripherals.map((comp, i) => {
          const per = getPeripheral(comp.refId);
          if (!per) return null;
          const x = 900;
          const y = 60 + i * 120;
          return (
            <g key={comp.id}>
              <rect x={x} y={y} width="220" height={40 + per.pinRequirements.length * 14} rx="8" fill="#111827" stroke="#334155" />
              <text x={x + 110} y={y + 22} textAnchor="middle" fill="#E2E8F0" fontSize="12" fontWeight="600">{per.name}</text>
              {per.pinRequirements.map((req, pi) => (
                <g key={req.name} onClick={() => handlePinClick(comp.id, req.name)} style={{ cursor: "pointer" }}>
                  <circle cx={x + 12} cy={y + 36 + pi * 14} r="4" fill={selected?.componentId === comp.id && selected.pinId === req.name ? "#FBBF24" : "#475569"} />
                  <text x={x + 22} y={y + 40 + pi * 14} fill="#CBD5E1" fontSize="9">{req.name}</text>
                </g>
              ))}
            </g>
          );
        })}

        {circuitState.wires.map((w) => {
          const color = wireColor(w);
          const isError = errorWireIds.has(w.id);
          const x1 = 72, y1 = 96;
          const x2 = 912, y2 = 96;
          const path = `M ${x1} ${y1} C ${x1 + 120} ${y1}, ${x2 - 120} ${y2}, ${x2} ${y2}`;
          return (
            <g key={w.id} onMouseEnter={() => setHoveredWire(w.id)} onMouseLeave={() => setHoveredWire(null)}>
              <path d={path} fill="none" stroke={isError ? "#DC2626" : color} strokeWidth="2.5" opacity={0.85}
                className={isError ? "animate-pulse" : ""} />
              {hoveredWire === w.id && isError && (
                <g>
                  <rect x={(x1 + x2) / 2 - 90} y={(y1 + y2) / 2 - 20} width="180" height="36" rx="6" fill="#7F1D1D" stroke="#DC2626" />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 2} textAnchor="middle" fill="#FECACA" fontSize="10">
                    {diagnostics.find((d) => (d.pinIds ?? []).includes(w.from.pinId) || (d.pinIds ?? []).includes(w.to.pinId))?.message ?? "Fault"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {selected && (
        <div className="absolute bottom-4 left-4 text-xs text-slate-300 bg-slate-900/80 px-3 py-1 rounded">
          Selected {selected.componentId}:{selected.pinId} — click a pin to wire
        </div>
      )}
    </div>
  );
}
