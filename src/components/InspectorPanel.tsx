"use client";

import { useMemo, useState } from "react";
import {
  type Board,
  type CircuitState,
  type Diagnostic,
  type DiagnosticSeverity,
  type Pin,
  getBoard,
  getPeripheral,
  lintCircuit,
  autoFixCircuit,
  scoreDiagnostics,
} from "@/lib/hardwareEngine";
import {
  type FirmwareLanguage,
  generateFirmware,
} from "@/lib/firmwareGenerator";

const EMERALD = "#34D399";
const AMBER = "#FBBF24";
const CRIMSON = "#F43F5E";
const PANEL_BG = "#0B0F17";

const SEVERITY_META: Record<
  DiagnosticSeverity,
  { label: string; color: string }
> = {
  CRITICAL: { label: "CRITICAL", color: CRIMSON },
  WARNING: { label: "WARNING", color: AMBER },
  INFO: { label: "INFO", color: EMERALD },
};

const SEVERITY_KEYS: DiagnosticSeverity[] = ["CRITICAL", "WARNING", "INFO"];

const TABS = [
  { id: "lint", label: "Linter & Fixes" },
  { id: "firmware", label: "Generated Firmware" },
  { id: "matrix", label: "Power & Pinout" },
] as const;

const LANGUAGES: Array<{ id: FirmwareLanguage; label: string; hint: string }> = [
  { id: "cpp", label: "C++", hint: "Arduino / PlatformIO" },
  { id: "micropython", label: "MicroPython", hint: "MicroPython" },
];

type TabId = (typeof TABS)[number]["id"];

export interface InspectorPanelProps {
  circuitState: CircuitState;
  diagnostics?: Diagnostic[];
  healthScore?: number;
  boardId: string;
  onAutoFix?: () => void;
  onFirmwareGenerate?: (language: FirmwareLanguage, code: string) => void;
}

function clampHealth(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function healthColor(score: number): string {
  if (score >= 90) return EMERALD;
  if (score >= 60) return AMBER;
  return CRIMSON;
}

function componentLabel(circuitState: CircuitState, componentId: string): string {
  const component = circuitState.components.find((c) => c.id === componentId);
  if (!component) return componentId;
  if (component.kind === "board") {
    return getBoard(component.refId)?.name ?? component.label ?? componentId;
  }
  return getPeripheral(component.refId)?.name ?? component.label ?? componentId;
}

function pinConstraint(pin: Pin): string | null {
  const notes: string[] = [];
  if (pin.isStrapping) notes.push("strapping pin");
  if (pin.isInputOnly) notes.push("input-only");
  if (pin.isAdc2) notes.push("ADC2 (WiFi conflict)");
  if (pin.isFlashConnected) notes.push("internal flash");
  return notes.length > 0 ? notes.join(" \u00B7 ") : null;
}

interface MatrixRow {
  name: string;
  rail: string;
  currentMa: number;
}

interface RailSummary {
  rail: "3.3V" | "5V";
  loadMa: number;
  maxMa: number | null;
}

interface PinAllocation {
  pinLabel: string;
  modes: string;
  target: string;
  note: string | null;
}

interface MatrixData {
  boardName: string;
  logicVoltage: number;
  logicVoltageTolerant5V: boolean;
  rows: MatrixRow[];
  rails: RailSummary[];
  pins: PinAllocation[];
  unassignedRails: number;
}

function buildMatrix(circuitState: CircuitState, boardId: string): MatrixData {
  const board: Board | undefined = getBoard(boardId);
  const boardComp =
    circuitState.components.find(
      (c) => c.kind === "board" && c.refId === boardId,
    ) ?? circuitState.components.find((c) => c.kind === "board");

  const rows: MatrixRow[] = [];
  const pins: PinAllocation[] = [];
  const railLoad: Record<"3.3V" | "5V", number> = { "3.3V": 0, "5V": 0 };
  let unassignedRails = 0;

  if (!board || !boardComp) {
    return {
      boardName: board?.name ?? boardId,
      logicVoltage: board?.logicVoltage ?? 0,
      logicVoltageTolerant5V: board?.logicVoltageTolerant5V ?? false,
      rows,
      rails: [],
      pins,
      unassignedRails,
    };
  }

  const boardPinById = new Map(board.pins.map((p) => [p.id, p]));
  const compById = new Map(circuitState.components.map((c) => [c.id, c]));

  for (const comp of circuitState.components) {
    if (comp.kind !== "peripheral") continue;
    const peripheral = getPeripheral(comp.refId);
    if (!peripheral) continue;

    let rail: "3.3V" | "5V" | "unknown" = "unknown";
    for (const wire of circuitState.wires) {
      const fromBoard = wire.from.componentId === boardComp.id;
      const toBoard = wire.to.componentId === boardComp.id;
      if (!fromBoard && !toBoard) continue;
      const boardEnd = fromBoard ? wire.from : wire.to;
      const perEnd = fromBoard ? wire.to : wire.from;
      if (perEnd.componentId !== comp.id) continue;
      const bpin = boardPinById.get(boardEnd.pinId);
      if (!bpin || !bpin.modes.includes("power")) continue;
      if (bpin.id === "3V3" || bpin.id === "3.3V") rail = "3.3V";
      else if (bpin.id === "5V" || bpin.id === "VIN" || bpin.id === "VSYS")
        rail = "5V";
      break;
    }

    if (rail === "3.3V" || rail === "5V") {
      railLoad[rail] += peripheral.currentDrawMa;
    } else {
      unassignedRails += 1;
    }

    rows.push({
      name: peripheral.name,
      rail: rail === "unknown" ? "unassigned" : rail,
      currentMa: peripheral.currentDrawMa,
    });
  }

  const seenPins = new Set<string>();
  for (const wire of circuitState.wires) {
    const fromBoard = wire.from.componentId === boardComp.id;
    const toBoard = wire.to.componentId === boardComp.id;
    if (!fromBoard && !toBoard) continue;
    const boardEnd = fromBoard ? wire.from : wire.to;
    const perEnd = fromBoard ? wire.to : wire.from;
    const bpin = boardPinById.get(boardEnd.pinId);
    if (!bpin) continue;
    if (bpin.modes.includes("power") || bpin.modes.includes("gnd")) continue;
    if (bpin.modes.every((m) => m === "reserved")) continue;
    if (seenPins.has(bpin.id)) continue;
    seenPins.add(bpin.id);

    const perComp = compById.get(perEnd.componentId);
    const peripheral =
      perComp && perComp.kind === "peripheral"
        ? getPeripheral(perComp.refId)
        : undefined;
    pins.push({
      pinLabel: bpin.label,
      modes: bpin.modes.join(", "),
      target: peripheral
        ? `${peripheral.name} \u00B7 ${perEnd.pinId}`
        : `${perEnd.componentId} \u00B7 ${perEnd.pinId}`,
      note: pinConstraint(bpin),
    });
  }

  const rails: RailSummary[] = [];
  const v3v3 = board.rails.v3v3;
  const v5 = board.rails.v5;
  if (v3v3) {
    rails.push({ rail: "3.3V", loadMa: railLoad["3.3V"], maxMa: v3v3.maxCurrentMa });
  }
  if (v5) {
    rails.push({ rail: "5V", loadMa: railLoad["5V"], maxMa: v5.maxCurrentMa });
  }

  return {
    boardName: board.name,
    logicVoltage: board.logicVoltage,
    logicVoltageTolerant5V: board.logicVoltageTolerant5V,
    rows,
    rails,
    pins,
    unassignedRails,
  };
}

function StatusLed({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full${pulse ? " animate-pulse" : ""}`}
      style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

function RailTag({ rail }: { rail: string }) {
  const color = rail === "3.3V" ? EMERALD : rail === "5V" ? AMBER : "#A1A1AA";
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {rail}
    </span>
  );
}

function TabBar({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Inspector tabs"
      className="flex shrink-0 border-b border-white/10"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`inspector-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`inspector-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`relative flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${
              selected ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {selected && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function HealthRing({ score }: { score: number }) {
  const color = healthColor(score);
  const degrees = score * 3.6;
  return (
    <div className="flex items-center gap-4">
      <div
        role="img"
        aria-label={`Health score ${score} out of 100`}
        className="relative h-20 w-20 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${color} ${degrees}deg, rgba(255,255,255,0.08) ${degrees}deg)`,
        }}
      >
        <div
          className="absolute inset-1.5 flex flex-col items-center justify-center rounded-full"
          style={{ backgroundColor: PANEL_BG }}
        >
          <span className="text-xl font-bold leading-none" style={{ color }}>
            {score}
          </span>
          <span className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
            / 100
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusLed color={color} pulse />
          <span className="text-sm font-semibold" style={{ color }}>
            {score >= 90 ? "Healthy" : score >= 60 ? "Needs attention" : "Critical"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Live lint health across assigned pins and power rails.
        </p>
      </div>
    </div>
  );
}

function LintTab({
  circuitState,
  diagnostics,
  healthScore,
  onAutoFix,
}: {
  circuitState: CircuitState;
  diagnostics: Diagnostic[];
  healthScore: number;
  onAutoFix?: () => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<DiagnosticSeverity, Diagnostic[]> = {
      CRITICAL: [],
      WARNING: [],
      INFO: [],
    };
    for (const d of diagnostics) map[d.severity].push(d);
    return map;
  }, [diagnostics]);

  const fixable = useMemo(
    () => autoFixCircuit(circuitState).changes.length,
    [circuitState],
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <HealthRing score={healthScore} />
        <button
          type="button"
          onClick={() => onAutoFix?.()}
          disabled={!onAutoFix || fixable === 0}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#04110C] transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-zinc-500"
        >
          {fixable === 0 ? "No fixes needed" : `Auto-Fix Circuit (${fixable})`}
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          Reroutes conflicting pins to safe, constraint-aware alternatives.
        </p>
      </section>

      {SEVERITY_KEYS.map((severity) => {
        const items = grouped[severity];
        const meta = SEVERITY_META[severity];
        return (
          <section key={severity}>
            <div className="mb-2 flex items-center gap-2">
              <StatusLed color={meta.color} />
              <h3
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: meta.color }}
              >
                {meta.label}
              </h3>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-zinc-500">
                No {meta.label.toLowerCase()} issues.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((d, idx) => {
                  const labels = (d.componentIds ?? []).map((id) =>
                    componentLabel(circuitState, id),
                  );
                  return (
                    <li
                      key={`${d.code}-${idx}`}
                      className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                          style={{
                            color: meta.color,
                            backgroundColor: `${meta.color}1A`,
                          }}
                        >
                          {d.code}
                        </span>
                        {labels.length > 0 && (
                          <span className="truncate text-[10px] text-zinc-500">
                            {labels.join(", ")}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-zinc-200">{d.message}</p>
                      {d.explanation && (
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          {d.explanation}
                        </p>
                      )}
                      {d.fix && (
                        <p className="mt-2 text-xs leading-relaxed text-zinc-300">
                          <span className="font-semibold" style={{ color: meta.color }}>
                            Fix:
                          </span>{" "}
                          {d.fix}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function FirmwareTab({
  circuitState,
  boardId,
  onFirmwareGenerate,
}: {
  circuitState: CircuitState;
  boardId: string;
  onFirmwareGenerate?: (language: FirmwareLanguage, code: string) => void;
}) {
  const [language, setLanguage] = useState<FirmwareLanguage>("cpp");
  const [copied, setCopied] = useState(false);

  const code = useMemo(
    () => generateFirmware(circuitState, boardId, language),
    [circuitState, boardId, language],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function handleGenerate() {
    onFirmwareGenerate?.(language, code);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-2">
        {LANGUAGES.map((lang) => {
          const selected = lang.id === language;
          return (
            <button
              key={lang.id}
              type="button"
              onClick={() => setLanguage(lang.id)}
              className={`rounded-lg border px-3 py-1.5 text-left transition-colors ${
                selected
                  ? "border-emerald-400/60 bg-emerald-400/10"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <span
                className={`block text-xs font-semibold ${
                  selected ? "text-emerald-300" : "text-zinc-300"
                }`}
              >
                {lang.label}
              </span>
              <span className="block text-[10px] text-zinc-500">{lang.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-[#04110C] transition-colors hover:bg-emerald-400"
        >
          Generate firmware
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20"
        >
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>

      <pre className="max-h-[460px] overflow-auto rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-xs leading-relaxed text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MatrixTab({
  circuitState,
  boardId,
}: {
  circuitState: CircuitState;
  boardId: string;
}) {
  const data = useMemo(
    () => buildMatrix(circuitState, boardId),
    [circuitState, boardId],
  );

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Current Draw Budget
          </h3>
          <span className="text-[11px] text-zinc-500">
            {data.boardName}{" \u00B7 "}{data.logicVoltage}V logic
            {data.logicVoltageTolerant5V ? " \u00B7 5V tolerant" : " \u00B7 3.3V only"}
          </span>
        </div>

        {data.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-zinc-500">
            No peripherals wired yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Peripheral</th>
                  <th className="px-3 py-2 font-medium">Rail</th>
                  <th className="px-3 py-2 text-right font-medium">Draw</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map((row, idx) => (
                  <tr key={`${row.name}-${idx}`} className="bg-white/[0.01]">
                    <td className="px-3 py-2 text-zinc-200">{row.name}</td>
                    <td className="px-3 py-2">
                      <RailTag rail={row.rail} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">
                      {row.currentMa} mA
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {data.rails.map((rail) => {
            const pct = rail.maxMa
              ? Math.min(100, (rail.loadMa / rail.maxMa) * 100)
              : 0;
            const color =
              rail.maxMa && rail.loadMa > rail.maxMa
                ? CRIMSON
                : pct >= 80
                  ? AMBER
                  : EMERALD;
            return (
              <div
                key={rail.rail}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <StatusLed color={color} />
                    <span className="font-semibold text-zinc-200">
                      {rail.rail} rail
                    </span>
                  </div>
                  <span className="font-mono text-zinc-400">
                    {rail.loadMa} / {rail.maxMa ?? "?"} mA
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
          {data.unassignedRails > 0 && (
            <p className="text-[11px] text-amber-300/80">
              {data.unassignedRails} peripheral(s) have no detected supply rail.
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Pin Allocation Map
        </h3>
        {data.pins.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-zinc-500">
            No signal pins assigned.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Pin</th>
                  <th className="px-3 py-2 font-medium">Modes</th>
                  <th className="px-3 py-2 font-medium">Connected To</th>
                  <th className="px-3 py-2 font-medium">Constraints</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.pins.map((pin, idx) => (
                  <tr key={`${pin.pinLabel}-${idx}`} className="bg-white/[0.01]">
                    <td className="px-3 py-2 font-mono text-zinc-200">
                      {pin.pinLabel}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-500">
                      {pin.modes}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{pin.target}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {pin.note ? (
                        <span className="text-amber-300/90">{pin.note}</span>
                      ) : (
                        <span className="text-zinc-600">{"\u2014"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function InspectorPanel({
  circuitState,
  diagnostics,
  healthScore,
  boardId,
  onAutoFix,
  onFirmwareGenerate,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("lint");

  const liveDiagnostics = useMemo(
    () => diagnostics ?? lintCircuit(circuitState),
    [diagnostics, circuitState],
  );

  const resolvedHealth = useMemo(
    () =>
      typeof healthScore === "number"
        ? clampHealth(healthScore)
        : scoreDiagnostics(liveDiagnostics),
    [healthScore, liveDiagnostics],
  );

  const headerColor = healthColor(resolvedHealth);

  return (
    <aside
      aria-label="Circuit inspector"
      className="flex h-full w-full min-w-0 flex-col text-zinc-200"
      style={{ backgroundColor: PANEL_BG }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Inspector</h2>
          <p className="truncate text-[11px] text-zinc-500">{boardId}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusLed color={headerColor} pulse />
          <span className="text-xs font-semibold" style={{ color: headerColor }}>
            {resolvedHealth}%
          </span>
        </div>
      </header>

      <TabBar active={activeTab} onChange={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "lint" && (
          <div
            role="tabpanel"
            id="inspector-panel-lint"
            aria-labelledby="inspector-tab-lint"
          >
            <LintTab
              circuitState={circuitState}
              diagnostics={liveDiagnostics}
              healthScore={resolvedHealth}
              onAutoFix={onAutoFix}
            />
          </div>
        )}
        {activeTab === "firmware" && (
          <div
            role="tabpanel"
            id="inspector-panel-firmware"
            aria-labelledby="inspector-tab-firmware"
          >
            <FirmwareTab
              circuitState={circuitState}
              boardId={boardId}
              onFirmwareGenerate={onFirmwareGenerate}
            />
          </div>
        )}
        {activeTab === "matrix" && (
          <div
            role="tabpanel"
            id="inspector-panel-matrix"
            aria-labelledby="inspector-tab-matrix"
          >
            <MatrixTab circuitState={circuitState} boardId={boardId} />
          </div>
        )}
      </div>
    </aside>
  );
}
