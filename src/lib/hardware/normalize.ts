import type { CircuitFault, CircuitState, ComponentInstance, PinState, Wire } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEndpoint(value: unknown): { componentId: string; pinId: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.componentId !== "string" || typeof value.pinId !== "string") {
    return null;
  }
  if (value.componentId.trim().length === 0 || value.pinId.trim().length === 0) {
    return null;
  }
  return { componentId: value.componentId, pinId: value.pinId };
}

/**
 * Validate and normalize data that may come from the database, an API request,
 * or an older version of the app. Returns null when the value cannot represent
 * a circuit at all. Unknown components/wires are dropped rather than allowed to
 * crash the linter or renderer.
 */
export function normalizeCircuitState(input: unknown): CircuitState | null {
  if (!isRecord(input)) return null;
  if (!Array.isArray(input.components)) return null;

  const components: ComponentInstance[] = [];
  const componentIds = new Set<string>();
  for (const raw of input.components) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const kind = raw.kind === "board" || raw.kind === "peripheral" ? raw.kind : null;
    const refId = typeof raw.refId === "string" ? raw.refId.trim() : "";
    if (!id || !kind || !refId || componentIds.has(id)) continue;
    componentIds.add(id);
    components.push({
      id,
      kind,
      refId,
      ...(typeof raw.label === "string" && raw.label.trim().length > 0
        ? { label: raw.label }
        : {}),
    });
  }

  if (components.length === 0) return null;

  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  const rawWires = Array.isArray(input.wires) ? input.wires : [];
  for (const raw of rawWires) {
    if (!isRecord(raw)) continue;
    const from = normalizeEndpoint(raw.from);
    const to = normalizeEndpoint(raw.to);
    if (!from || !to) continue;
    if (!componentIds.has(from.componentId) || !componentIds.has(to.componentId)) continue;
    if (from.componentId === to.componentId && from.pinId === to.pinId) continue;
    let id =
      typeof raw.id === "string" && raw.id.trim().length > 0
        ? raw.id
        : `wire_${wires.length + 1}`;
    while (wireIds.has(id)) id = `${id}_${wires.length + 1}`;
    wireIds.add(id);
    wires.push({ id, from, to });
  }

  const pinStates: PinState[] = [];
  const pinKeys = new Set<string>();
  const rawPinStates = Array.isArray(input.pinStates) ? input.pinStates : [];
  for (const raw of rawPinStates) {
    if (!isRecord(raw)) continue;
    const componentId = typeof raw.componentId === "string" ? raw.componentId : "";
    const pinId = typeof raw.pinId === "string" ? raw.pinId : "";
    if (!componentId || !pinId || !componentIds.has(componentId)) continue;
    const key = `${componentId}:${pinId}`;
    if (pinKeys.has(key)) continue;
    const direction =
      raw.direction === "input" ||
      raw.direction === "output" ||
      raw.direction === "bidirectional"
        ? raw.direction
        : undefined;
    const level =
      raw.level === "HIGH" || raw.level === "LOW" || raw.level === "FLOATING"
        ? raw.level
        : undefined;
    pinKeys.add(key);
    pinStates.push({ componentId, pinId, direction, level });
  }

  const faults: CircuitFault[] = [];
  const faultIds = new Set<string>();
  const rawFaults = Array.isArray(input.faults) ? input.faults : [];
  for (const raw of rawFaults) {
    if (!isRecord(raw)) continue;
    if (raw.type !== "open" && raw.type !== "floating" && raw.type !== "brownout") {
      continue;
    }
    let id =
      typeof raw.id === "string" && raw.id.trim().length > 0
        ? raw.id
        : `fault_${faults.length + 1}`;
    while (faultIds.has(id)) id = `${id}_${faults.length + 1}`;
    faultIds.add(id);
    const componentId =
      typeof raw.componentId === "string" && componentIds.has(raw.componentId)
        ? raw.componentId
        : undefined;
    const rail = raw.rail === "3.3V" || raw.rail === "5V" ? raw.rail : undefined;
    faults.push({
      id,
      type: raw.type,
      ...(componentId ? { componentId } : {}),
      ...(typeof raw.pinId === "string" ? { pinId: raw.pinId } : {}),
      ...(rail ? { rail } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    });
  }

  return {
    components,
    wires,
    ...(pinStates.length > 0 ? { pinStates } : {}),
    ...(faults.length > 0 ? { faults } : {}),
  };
}

export function parseCircuitState(json: string): CircuitState | null {
  try {
    return normalizeCircuitState(JSON.parse(json));
  } catch {
    return null;
  }
}
