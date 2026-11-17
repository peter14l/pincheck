import type { DiagnosticSeverity } from "./types";

export function scoreDiagnostics(diagnostics: Array<{ severity: DiagnosticSeverity }>): number {
  let score = 100;
  for (const d of diagnostics) {
    if (d.severity === "CRITICAL") score -= 25;
    else if (d.severity === "WARNING") score -= 10;
    else score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}
