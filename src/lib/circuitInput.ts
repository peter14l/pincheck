import {
  BOARDS,
  getBoard,
  lintCircuit,
  normalizeCircuitState,
  scoreDiagnostics,
  type CircuitState,
} from "./hardwareEngine";

export interface ValidatedCircuitState {
  state: CircuitState;
  stateJson: string;
  boardId: string;
  healthScore: number;
}

type ValidationResult =
  | { ok: true; value: ValidatedCircuitState }
  | { ok: false; error: string };

/**
 * Validate a client-supplied circuit, normalize it, and compute its health on
 * the server. Client-supplied health scores are never trusted.
 */
export function validateCircuitState(
  input: unknown,
  claimedBoardId?: unknown,
): ValidationResult {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, error: "`stateJson` must be a valid JSON string" };
    }
  }

  const state = normalizeCircuitState(parsed);
  if (!state) {
    return {
      ok: false,
      error: "`stateJson` must describe a circuit with at least one valid component",
    };
  }

  const boardComponent = state.components.find((component) => component.kind === "board");
  if (!boardComponent) {
    return { ok: false, error: "Circuit state must include a board component" };
  }
  if (!getBoard(boardComponent.refId)) {
    return {
      ok: false,
      error: `Unknown board id "${boardComponent.refId}". Known boards: ${Object.keys(BOARDS).join(", ")}`,
    };
  }

  if (
    claimedBoardId !== undefined &&
    claimedBoardId !== null &&
    (typeof claimedBoardId !== "string" || claimedBoardId !== boardComponent.refId)
  ) {
    return {
      ok: false,
      error: `\`boardId\` must match the board in the circuit state ("${boardComponent.refId}")`,
    };
  }

  const diagnostics = lintCircuit(state);
  return {
    ok: true,
    value: {
      state,
      stateJson: JSON.stringify(state),
      boardId: boardComponent.refId,
      healthScore: scoreDiagnostics(diagnostics),
    },
  };
}

export function validateTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  return trimmed;
}

export function validateDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}
