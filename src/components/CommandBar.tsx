"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateCircuitFromPrompt } from "@/lib/circuitGenerator";
import { Board, CircuitState, Diagnostic, getBoard } from "@/lib/hardwareEngine";

interface CommandBarProps {
  onGenerate: (circuitState: CircuitState, boardId: string, explanation: string) => void;
}

const PRESETS: readonly string[] = [
  "ESP32 Weather Station with OLED & BME280",
  "Arduino Obstacle Robot with HC-SR04 & Servo",
  "Deliberate Buggy Circuit Demo",
];

export default function CommandBar({ onGenerate }: CommandBarProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState("");
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [circuitState, setCircuitState] = useState<CircuitState | null>(null);
  const [explanation, setExplanation] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResults = useCallback(() => {
    setBoardId(null);
    setBoardName("");
    setHealthScore(null);
    setCircuitState(null);
    setExplanation("");
    setDiagnostics([]);
  }, []);

  const runGeneration = useCallback(
    async (value: string) => {
      if (!value.trim()) {
        clearResults();
        return;
      }
      setLoading(true);
      try {
        const result = await generateCircuitFromPrompt(value);
        const board: Board | undefined = getBoard(result.boardId);
        setBoardId(result.boardId);
        setBoardName(board?.name ?? result.boardId);
        setHealthScore(result.healthScore);
        setCircuitState(result.circuitState);
        setExplanation(result.explanation);
        setDiagnostics(result.diagnostics);
      } finally {
        setLoading(false);
      }
    },
    [clearResults]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runGeneration(prompt.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [prompt, runGeneration]);

  const selectPreset = (name: string) => {
    setPrompt(name);
  };

  const handleGenerate = () => {
    if (!circuitState || !boardId || !explanation) return;
    onGenerate(circuitState, boardId, explanation);
  };

  const pinCount = circuitState?.components.filter((c) => c.kind !== "board").length ?? 0;
  const wireCount = circuitState?.wires.length ?? 0;
  const scoreColor =
    healthScore === null
      ? "text-slate-500"
      : healthScore >= 80
        ? "text-[#10B981]"
        : healthScore >= 50
          ? "text-[#F59E0B]"
          : "text-[#DC2626]";

  return (
    <header className="bg-[#0B0F17] border-b border-[#273042] sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#10B981] animate-pulse" aria-hidden="true" />
            <span className="font-mono text-xs font-semibold tracking-wider text-[#10B981] uppercase">
              pincheck &middot; prompt-to-verified-pinout
            </span>
          </div>

          <div className="relative">
            <input
              className="w-full rounded-lg border border-[#273042] bg-[#111928]/60 px-4 py-3 text-white font-mono text-sm placeholder-[#6B7280] focus:outline-none focus:ring-1 focus:ring-[#10B981] focus:border-[#10B981] transition-colors"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Describe your circuit (e.g. "ESP32 weather station with OLED and BME280")'
              aria-label="Circuit prompt"
            />
            {loading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center">
                <span className="h-3 w-3 rounded-full border-2 border-[#10B981] border-t-transparent animate-spin" aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectPreset(name)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-[11px] font-mono transition-colors ${
                  prompt === name
                    ? "border-[#10B981] bg-[#10B981]/10 text-[#10B981]"
                    : "border-[#273042] bg-[#111928]/40 text-slate-400 hover:border-[#10B981] hover:text-white"
                }`}
                aria-pressed={prompt === name}
              >
                <span className="h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                {name}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#273042]/50">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-slate-400">board:</span>
              <span className={`font-mono text-xs font-medium ${scoreColor}`}>
                {boardName || "—"}
              </span>
              <span className="font-mono text-xs text-slate-500">|</span>
              <span className="font-mono text-xs text-slate-400">pins:</span>
              <span className="font-mono text-xs font-medium text-white">{pinCount}</span>
              <span className="font-mono text-xs text-slate-500">|</span>
              <span className="font-mono text-xs text-slate-400">wires:</span>
              <span className="font-mono text-xs font-medium text-white">{wireCount}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`font-mono text-xs font-bold tracking-tight rounded px-2 py-1 ${
                healthScore === null
                  ? "bg-[#111928]/50 border border-[#273042]/50 text-slate-500"
                  : healthScore >= 80
                    ? "bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981]"
                    : healthScore >= 50
                      ? "bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B]"
                      : "bg-[#DC2626]/10 border border-[#DC2626]/30 text-[#DC2626]"
              }`}>
                health {healthScore === null ? "—" : healthScore}
              </span>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || !circuitState || !boardId}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border font-mono text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  loading || !circuitState || !boardId
                    ? "border-[#273042]/50 bg-[#111928]/40 text-slate-500"
                    : "border-[#10B981] bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 hover:border-[#10B981]/60"
                }`}
              >
                {loading ? "generating…" : "generate circuit"}
              </button>
            </div>
          </div>

          {explanation && (
            <div className="mt-3 pt-3 border-t border-[#273042]/40">
              <span className="block font-mono text-[10px] font-semibold tracking-wider text-[#DC2626]/70 uppercase mb-1">
                pin assignment rationale
              </span>
              <pre className="font-mono text-sm text-[#CBD5E1] leading-relaxed overflow-x-auto whitespace-pre-line">{explanation}</pre>
              {diagnostics.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {diagnostics.map((d) => {
                    const color =
                      d.severity === "CRITICAL"
                        ? "border-[#DC2626]/30 text-[#DC2626]"
                        : d.severity === "WARNING"
                          ? "border-[#F59E0B]/30 text-[#F59E0B]"
                          : "border-[#10B981]/30 text-[#10B981]";
                    return (
                      <span key={d.code} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono ${color}`}>
                        {d.severity === "CRITICAL" ? "!" : d.severity === "WARNING" ? "?" : "i"}
                        {d.code}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}