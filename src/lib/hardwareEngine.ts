export type DiagnosticSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  explanation: string;
  fix: string;
  componentIds?: string[];
  pinIds?: string[];
}

export type PinMode =
  | "gpio"
  | "input-only"
  | "power"
  | "gnd"
  | "analog"
  | "pwm"
  | "uart"
  | "i2c-sda"
  | "i2c-scl"
  | "spi"
  | "reserved";

export interface Pin {
  id: string;
  label: string;
  modes: PinMode[];
  isInputOnly?: boolean;
  isStrapping?: boolean;
  strappingCondition?: string;
  isFlashConnected?: boolean;
  isAdc2?: boolean;
  notes?: string;
}

export interface BoardRail {
  voltage: number;
  maxCurrentMa: number;
}

export interface Board {
  id: string;
  name: string;
  logicVoltage: number;
  logicVoltageTolerant5V: boolean;
  pins: Pin[];
  rails: {
    v3v3?: BoardRail;
    v5?: BoardRail;
  };
}

export interface PeripheralPinRequirement {
  name: string;
  type:
    | "power"
    | "gnd"
    | "digital-in"
    | "digital-out"
    | "digital-bidir"
    | "pwm"
    | "i2c-sda"
    | "i2c-scl"
    | "analog"
    | "uart-tx"
    | "uart-rx";
  voltage?: number;
  i2cAddress?: number;
  notes?: string;
}

export interface Peripheral {
  id: string;
  name: string;
  description: string;
  supplyVoltage: number;
  supplyVoltageMin?: number;
  supplyVoltageMax?: number;
  currentDrawMa: number;
  pinRequirements: PeripheralPinRequirement[];
  notes?: string;
}

export interface ComponentInstance {
  id: string;
  kind: "board" | "peripheral";
  refId: string;
  label?: string;
}

export interface Wire {
  id: string;
  from: { componentId: string; pinId: string };
  to: { componentId: string; pinId: string };
}

export interface PinState {
  componentId: string;
  pinId: string;
  direction?: "input" | "output" | "bidirectional";
  level?: "HIGH" | "LOW" | "FLOATING";
}

export type CircuitFaultType = "open" | "floating" | "brownout";

export interface CircuitFault {
  id: string;
  type: CircuitFaultType;
  componentId?: string;
  pinId?: string;
  rail?: "3.3V" | "5V";
  note?: string;
}

export interface CircuitState {
  components: ComponentInstance[];
  wires: Wire[];
  pinStates?: PinState[];
  faults?: CircuitFault[];
}

function pin(id: string, label: string, modes: PinMode[], extra: Partial<Pin> = {}): Pin {
  return { id, label, modes, ...extra };
}

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

export function scoreDiagnostics(diagnostics: Array<{ severity: DiagnosticSeverity }>): number {
  let score = 100;
  for (const d of diagnostics) {
    if (d.severity === "CRITICAL") score -= 25;
    else if (d.severity === "WARNING") score -= 10;
    else score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}

const INPUT_REQUIREMENTS: ReadonlySet<PeripheralPinRequirement["type"]> = new Set([
  "digital-in",
  "analog",
  "uart-rx",
]);

const OUTPUT_REQUIREMENTS: ReadonlySet<PeripheralPinRequirement["type"]> = new Set([
  "digital-out",
  "pwm",
  "uart-tx",
]);

export function directionForRequirement(
  type: PeripheralPinRequirement["type"],
): "input" | "output" | "bidirectional" {
  if (INPUT_REQUIREMENTS.has(type)) return "input";
  if (OUTPUT_REQUIREMENTS.has(type)) return "output";
  return "bidirectional";
}

export function pinSupportsRequirement(pin: Pin, req: PeripheralPinRequirement): boolean {
  switch (req.type) {
    case "power":
      return pin.modes.includes("power");
    case "gnd":
      return pin.modes.includes("gnd");
    case "i2c-sda":
      return pin.modes.includes("i2c-sda") || pin.modes.includes("gpio");
    case "i2c-scl":
      return pin.modes.includes("i2c-scl") || pin.modes.includes("gpio");
    case "pwm":
      return pin.modes.includes("pwm") && !pin.isInputOnly;
    case "analog":
      return pin.modes.includes("analog");
    case "digital-in":
      return (
        (pin.modes.includes("gpio") ||
          pin.modes.includes("analog") ||
          pin.modes.includes("input-only")) &&
        !pin.isFlashConnected
      );
    case "digital-out":
    case "digital-bidir":
      return pin.modes.includes("gpio") && !pin.isInputOnly && !pin.isFlashConnected;
    case "uart-tx":
    case "uart-rx":
      return pin.modes.includes("uart") && !pin.isInputOnly && !pin.isFlashConnected;
    default:
      return false;
  }
}

/** Pins reserved for the hardware serial console / bootloader. */
export const DEFAULT_UART_PINS: Record<string, readonly string[]> = {
  arduino_uno_r3: ["D0", "D1"],
  esp32_devkit_v1: ["GPIO1", "GPIO3"],
};

export function findCompatiblePin(
  board: Board,
  req: PeripheralPinRequirement,
  usedPins: ReadonlySet<string>,
  options: { allowStrapping?: boolean } = {},
): Pin | null {
  const uartReserved = DEFAULT_UART_PINS[board.id] ?? [];
  const isUartRequirement = req.type === "uart-tx" || req.type === "uart-rx";
  const candidates = board.pins.filter((candidate) => {
    if (usedPins.has(candidate.id)) return false;
    if (!pinSupportsRequirement(candidate, req)) return false;
    if (candidate.isFlashConnected) return false;
    if (uartReserved.includes(candidate.id) && !isUartRequirement) return false;
    if (
      candidate.isStrapping &&
      !options.allowStrapping &&
      req.type !== "power" &&
      req.type !== "gnd"
    ) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;

  const nonAdc2 = candidates.filter((candidate) => !candidate.isAdc2);
  const pool = nonAdc2.length > 0 ? nonAdc2 : candidates;
  return pool.find((candidate) => !candidate.isInputOnly) ?? pool[0];
}

export function powerPinVoltage(board: Board, pin: Pin): number | null {
  if (!pin.modes.includes("power")) return null;
  if (/3V3|3\.3V/i.test(pin.id)) return board.rails.v3v3?.voltage ?? board.logicVoltage;
  if (/5V|VIN|VSYS|VBUS/i.test(pin.id)) return board.rails.v5?.voltage ?? 5;
  return board.logicVoltage;
}

/**
 * Pick a supply pin that can actually power the peripheral. Prefers an exact
 * voltage match, then the rail with the most headroom. Falls back to the
 * closest rail when the board cannot satisfy the peripheral (the linter will
 * then explain the mismatch).
 */
export function selectPowerPinForPeripheral(
  board: Board,
  peripheral: Peripheral,
): { pin: Pin; voltage: number } | null {
  const min = peripheral.supplyVoltageMin ?? peripheral.supplyVoltage;
  const max = peripheral.supplyVoltageMax ?? peripheral.supplyVoltage;
  const target = Math.min(Math.max(peripheral.supplyVoltage, min), max);

  const candidates = board.pins
    .filter((candidate) => candidate.modes.includes("power"))
    .map((candidate) => ({
      pin: candidate,
      voltage: powerPinVoltage(board, candidate),
      rail: candidate.id === "3V3" || candidate.id === "3.3V"
        ? board.rails.v3v3
        : board.rails.v5,
    }))
    .filter((entry): entry is { pin: Pin; voltage: number; rail: BoardRail | undefined } =>
      typeof entry.voltage === "number",
    );

  if (candidates.length === 0) return null;

  const inRange = candidates.filter(
    (entry) => entry.voltage >= min - 0.01 && entry.voltage <= max + 0.01,
  );
  const pool = inRange.length > 0 ? inRange : candidates;
  pool.sort((a, b) => {
    const exactA = Math.abs(a.voltage - target);
    const exactB = Math.abs(b.voltage - target);
    if (exactA !== exactB) return exactA - exactB;
    return (b.rail?.maxCurrentMa ?? 0) - (a.rail?.maxCurrentMa ?? 0);
  });

  const best = pool[0];
  return { pin: best.pin, voltage: best.voltage };
}

export function derivePinStates(state: CircuitState): PinState[] {
  const componentsById = new Map(state.components.map((component) => [component.id, component]));
  const boardPinState = new Map<string, PinState>();

  const add = (
    componentId: string,
    pinId: string,
    direction: "input" | "output" | "bidirectional",
  ) => {
    const key = `${componentId}:${pinId}`;
    const existing = boardPinState.get(key);
    if (!existing) {
      boardPinState.set(key, { componentId, pinId, direction });
      return;
    }
    if (existing.direction !== direction) existing.direction = "bidirectional";
  };

  for (const wire of state.wires) {
    const from = componentsById.get(wire.from.componentId);
    const to = componentsById.get(wire.to.componentId);
    if (!from || !to) continue;

    for (const [boardEnd, peripheralEnd, boardComponent] of [
      [wire.from, wire.to, from] as const,
      [wire.to, wire.from, to] as const,
    ]) {
      if (boardComponent.kind !== "board") continue;
      const otherComponent = componentsById.get(peripheralEnd.componentId);
      if (!otherComponent) continue;

      if (otherComponent.kind === "peripheral") {
        const peripheral = PERIPHERALS[otherComponent.refId];
        const req = peripheral?.pinRequirements.find((entry) => entry.name === peripheralEnd.pinId);
        if (req && req.type !== "power" && req.type !== "gnd") {
          add(boardEnd.componentId, boardEnd.pinId, directionForRequirement(req.type));
        }
      } else if (boardComponent.id === wire.from.componentId) {
        add(boardEnd.componentId, boardEnd.pinId, "output");
      } else {
        add(boardEnd.componentId, boardEnd.pinId, "input");
      }
    }
  }

  for (const existing of state.pinStates ?? []) {
    const key = `${existing.componentId}:${existing.pinId}`;
    const derived = boardPinState.get(key);
    if (derived) {
      if (existing.level) derived.level = existing.level;
    } else {
      boardPinState.set(key, { ...existing });
    }
  }

  return Array.from(boardPinState.values());
}

export interface AutoFixChange {
  code: string;
  description: string;
}

export interface AutoFixResult {
  state: CircuitState;
  changes: AutoFixChange[];
}

/**
 * Deterministically repair the circuit issues that can be fixed by rewiring:
 * unsafe GPIO assignments, pin collisions, disconnected required pins and
 * power rails outside a peripheral's input range.
 */
export function autoFixCircuit(input: CircuitState): AutoFixResult {
  const normalized = normalizeCircuitState(input);
  if (!normalized) return { state: { components: [], wires: [] }, changes: [] };

  const state: CircuitState = {
    components: normalized.components.map((component) => ({ ...component })),
    wires: normalized.wires.map((wire) => ({
      id: wire.id,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    pinStates: (normalized.pinStates ?? []).map((pinState) => ({ ...pinState })),
    faults: (normalized.faults ?? []).map((fault) => ({ ...fault })),
  };
  const changes: AutoFixChange[] = [];
  const componentById = () => new Map(state.components.map((component) => [component.id, component]));
  const boardComponents = () => state.components.filter((component) => component.kind === "board");
  const boardFor = (componentId: string) => {
    const component = componentById().get(componentId);
    return component?.kind === "board" ? BOARDS[component.refId] : undefined;
  };
  const otherEnd = (wire: Wire, componentId: string) =>
    wire.from.componentId === componentId ? wire.to : wire.from;

  const usedBoardPins = (excludeWireId?: string) => {
    const used = new Set<string>();
    for (const wire of state.wires) {
      if (wire.id === excludeWireId) continue;
      for (const end of [wire.from, wire.to]) {
        if (componentById().get(end.componentId)?.kind === "board") {
          used.add(end.pinId);
        }
      }
    }
    return used;
  };

  // 1) Move power wires to a rail inside the peripheral's supply range.
  for (const component of state.components) {
    if (component.kind !== "peripheral") continue;
    const peripheral = PERIPHERALS[component.refId];
    if (!peripheral) continue;
    const powerReq = peripheral.pinRequirements.find((req) => req.type === "power");
    if (!powerReq) continue;
    const wire = state.wires.find(
      (entry) =>
        (entry.from.componentId === component.id && entry.from.pinId === powerReq.name) ||
        (entry.to.componentId === component.id && entry.to.pinId === powerReq.name),
    );
    if (!wire) continue;
    const boardEnd = otherEnd(wire, component.id);
    const board = boardFor(boardEnd.componentId);
    if (!board) continue;
    const currentPin = board.pins.find((candidate) => candidate.id === boardEnd.pinId);
    if (!currentPin) continue;
    const currentVoltage = powerPinVoltage(board, currentPin);
    if (currentVoltage === null) continue;
    const min = peripheral.supplyVoltageMin ?? peripheral.supplyVoltage;
    const max = peripheral.supplyVoltageMax ?? peripheral.supplyVoltage;
    if (currentVoltage >= min - 0.01 && currentVoltage <= max + 0.01) continue;

    const replacement = selectPowerPinForPeripheral(board, peripheral);
    if (!replacement || replacement.pin.id === currentPin.id) continue;
    if (
      replacement.voltage < min - 0.01 ||
      replacement.voltage > max + 0.01
    ) {
      continue;
    }
    boardEnd.pinId = replacement.pin.id;
    changes.push({
      code: "POWER_RAIL_MISMATCH",
      description: `Moved ${peripheral.name} VCC from ${currentPin.label} to ${replacement.pin.label}`,
    });
  }

  // 2) Reroute unsafe signal pins to a compatible free pin.
  const diagnostics = lintCircuit(state);
  const reroutable = new Set([
    "INPUT_ONLY_PIN_AS_OUTPUT",
    "ESP32_FLASH_PIN_USED",
    "ESP32_STRAPPING_PIN_DRIVEN",
    "PIN_COLLISION",
  ]);
  for (const diagnostic of diagnostics) {
    if (!reroutable.has(diagnostic.code)) continue;
    for (const pinId of diagnostic.pinIds ?? []) {
      const boardComponent = boardComponents().find((component) =>
        BOARDS[component.refId]?.pins.some((candidate) => candidate.id === pinId),
      );
      if (!boardComponent) continue;
      const board = BOARDS[boardComponent.refId];
      if (!board) continue;

      for (const wire of state.wires) {
        const boardEnd =
          wire.from.componentId === boardComponent.id && wire.from.pinId === pinId
            ? wire.from
            : wire.to.componentId === boardComponent.id && wire.to.pinId === pinId
              ? wire.to
              : null;
        if (!boardEnd) continue;
        const perEnd = otherEnd(wire, boardComponent.id);
        const perComponent = componentById().get(perEnd.componentId);
        if (perComponent?.kind !== "peripheral") continue;
        const peripheral = PERIPHERALS[perComponent.refId];
        const req = peripheral?.pinRequirements.find((entry) => entry.name === perEnd.pinId);
        if (!peripheral || !req || req.type === "power" || req.type === "gnd") continue;

        const replacement = findCompatiblePin(board, req, usedBoardPins(wire.id));
        if (!replacement || replacement.id === pinId) continue;
        boardEnd.pinId = replacement.id;
        state.pinStates = (state.pinStates ?? []).filter(
          (pinState) =>
            !(pinState.componentId === boardComponent.id && pinState.pinId === pinId),
        );
        changes.push({
          code: diagnostic.code,
          description: `Moved ${peripheral.name} ${req.name} from ${pinId} to ${replacement.label}`,
        });
      }
    }
  }

  // 3) Remove external pulls that hold GPIO12 HIGH at boot and lower its state.
  const strapping = diagnostics.find((diagnostic) => diagnostic.code === "ESP32_STRAPPING_GPIO12_HIGH");
  if (strapping) {
    const boardComponent = boardComponents().find((component) => BOARDS[component.refId]?.pins.some((candidate) => candidate.id === "GPIO12"));
    if (boardComponent) {
      const before = state.wires.length;
      state.wires = state.wires.filter((wire) => {
        const involvesGpio12 =
          (wire.from.componentId === boardComponent.id && wire.from.pinId === "GPIO12") ||
          (wire.to.componentId === boardComponent.id && wire.to.pinId === "GPIO12");
        if (!involvesGpio12) return true;
        const other = otherEnd(wire, boardComponent.id);
        const otherPin = boardFor(other.componentId)?.pins.find((candidate) => candidate.id === other.pinId);
        return !(otherPin && (otherPin.modes.includes("power") || otherPin.modes.includes("gnd")));
      });
      const removed = before - state.wires.length;
      const pinState = state.pinStates?.find(
        (entry) => entry.componentId === boardComponent.id && entry.pinId === "GPIO12",
      );
      if (pinState) pinState.level = "LOW";
      else {
        state.pinStates = [
          ...(state.pinStates ?? []),
          { componentId: boardComponent.id, pinId: "GPIO12", direction: "output", level: "LOW" },
        ];
      }
      changes.push({
        code: "ESP32_STRAPPING_GPIO12_HIGH",
        description: `Removed ${removed} external pull-up wire(s) from GPIO12 and set it LOW at boot`,
      });
    }
  }

  // 4) Wire up required peripheral pins that are still disconnected.
  for (const component of state.components) {
    if (component.kind !== "peripheral") continue;
    const peripheral = PERIPHERALS[component.refId];
    if (!peripheral) continue;
    const boardComponent = boardComponents()[0];
    const board = boardComponent ? BOARDS[boardComponent.refId] : undefined;
    if (!boardComponent || !board) continue;

    for (const req of peripheral.pinRequirements) {
      const connected = state.wires.some(
        (wire) =>
          (wire.from.componentId === component.id && wire.from.pinId === req.name) ||
          (wire.to.componentId === component.id && wire.to.pinId === req.name),
      );
      if (connected) continue;

      const pin =
        req.type === "power"
          ? selectPowerPinForPeripheral(board, peripheral)?.pin
          : req.type === "gnd"
            ? board.pins.find((candidate) => candidate.modes.includes("gnd"))
            : findCompatiblePin(board, req, usedBoardPins());
      if (!pin) continue;

      const wire: Wire = {
        id: `fix_${state.wires.length + 1}_${req.name}`,
        from: { componentId: boardComponent.id, pinId: pin.id },
        to: { componentId: component.id, pinId: req.name },
      };
      while (state.wires.some((entry) => entry.id === wire.id)) wire.id = `${wire.id}_x`;
      state.wires.push(wire);
      changes.push({
        code: "UNCONNECTED_PERIPHERAL_PIN",
        description: `Connected ${peripheral.name} ${req.name} to ${pin.label}`,
      });
    }
  }

  state.pinStates = derivePinStates(state);
  return { state, changes };
}

export const BOARDS: Record<string, Board> = {
  esp32_devkit_v1: {
    id: "esp32_devkit_v1",
    name: "ESP32 DevKit V1 (30-pin)",
    logicVoltage: 3.3,
    logicVoltageTolerant5V: false,
    rails: {
      v3v3: { voltage: 3.3, maxCurrentMa: 500 },
      v5: { voltage: 5, maxCurrentMa: 500 },
    },
    pins: [
      pin("3V3", "3V3", ["power"]),
      pin("GND1", "GND", ["gnd"]),
      pin("GPIO15", "GPIO15", ["gpio", "pwm", "spi"], {
        isStrapping: true,
        strappingCondition: "Strapping pin; affects boot log/output levels.",
      }),
      pin("GPIO2", "GPIO2", ["gpio", "pwm"], {
        isStrapping: true,
        strappingCondition: "Strapping pin; onboard LED and boot influence in some modes.",
        isAdc2: true,
      }),
      pin("GPIO4", "GPIO4", ["gpio", "pwm"], { isAdc2: true }),
      pin("GPIO16", "GPIO16", ["gpio", "uart", "pwm"]),
      pin("GPIO17", "GPIO17", ["gpio", "uart", "pwm"]),
      pin("GPIO5", "GPIO5", ["gpio", "pwm", "spi"], {
        isStrapping: true,
        strappingCondition: "Strapping pin; must be HIGH at boot for normal flash boot.",
      }),
      pin("GPIO18", "GPIO18", ["gpio", "pwm", "spi"]),
      pin("GPIO19", "GPIO19", ["gpio", "pwm", "spi"]),
      pin("GPIO21", "GPIO21", ["gpio", "i2c-sda", "pwm"]),
      pin("GPIO3", "GPIO3 / RX0", ["gpio", "uart", "pwm"]),
      pin("GPIO1", "GPIO1 / TX0", ["gpio", "uart", "pwm"]),
      pin("GPIO22", "GPIO22", ["gpio", "i2c-scl", "pwm"]),
      pin("GPIO23", "GPIO23", ["gpio", "pwm", "spi"]),
      pin("EN", "EN", ["reserved"]),
      pin("VP", "GPIO36 / VP", ["input-only", "analog"], { isInputOnly: true }),
      pin("VN", "GPIO39 / VN", ["input-only", "analog"], { isInputOnly: true }),
      pin("GPIO34", "GPIO34", ["input-only", "analog"], { isInputOnly: true }),
      pin("GPIO35", "GPIO35", ["input-only", "analog"], { isInputOnly: true }),
      pin("GPIO32", "GPIO32", ["gpio", "analog", "pwm"]),
      pin("GPIO33", "GPIO33", ["gpio", "analog", "pwm"]),
      pin("GPIO25", "GPIO25", ["gpio", "analog", "pwm"], { isAdc2: true }),
      pin("GPIO26", "GPIO26", ["gpio", "analog", "pwm"], { isAdc2: true }),
      pin("GPIO27", "GPIO27", ["gpio", "analog", "pwm"], { isAdc2: true }),
      pin("GPIO14", "GPIO14", ["gpio", "pwm"], { isAdc2: true }),
      pin("GPIO12", "GPIO12", ["gpio", "pwm"], {
        isStrapping: true,
        strappingCondition: "If HIGH at boot, sets flash voltage to 1.8V and can cause flash voltage boot failure.",
        isAdc2: true,
      }),
      pin("GPIO13", "GPIO13", ["gpio", "pwm"], { isAdc2: true }),
      pin("GND2", "GND", ["gnd"]),
      pin("VIN", "VIN/5V", ["power"]),
      pin("GPIO6", "GPIO6", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO7", "GPIO7", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO8", "GPIO8", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO9", "GPIO9", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO10", "GPIO10", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO11", "GPIO11", ["reserved"], { isFlashConnected: true, notes: "Connected to internal SPI flash." }),
      pin("GPIO0", "GPIO0", ["gpio", "pwm"], {
        isStrapping: true,
        strappingCondition: "Must be HIGH for normal boot; LOW enters download mode.",
        isAdc2: true,
      }),
    ],
  },
  arduino_uno_r3: {
    id: "arduino_uno_r3",
    name: "Arduino Uno R3",
    logicVoltage: 5,
    logicVoltageTolerant5V: true,
    rails: {
      v3v3: { voltage: 3.3, maxCurrentMa: 50 },
      v5: { voltage: 5, maxCurrentMa: 500 },
    },
    pins: [
      pin("5V", "5V", ["power"]),
      pin("3V3", "3.3V", ["power"]),
      pin("GND1", "GND", ["gnd"]),
      pin("GND2", "GND", ["gnd"]),
      pin("VIN", "VIN", ["power"]),
      pin("D0", "D0/RX", ["gpio", "uart"]),
      pin("D1", "D1/TX", ["gpio", "uart"]),
      pin("D2", "D2", ["gpio"]),
      pin("D3", "D3", ["gpio", "pwm"]),
      pin("D4", "D4", ["gpio"]),
      pin("D5", "D5", ["gpio", "pwm"]),
      pin("D6", "D6", ["gpio", "pwm"]),
      pin("D7", "D7", ["gpio"]),
      pin("D8", "D8", ["gpio"]),
      pin("D9", "D9", ["gpio", "pwm"]),
      pin("D10", "D10", ["gpio", "pwm", "spi"]),
      pin("D11", "D11", ["gpio", "pwm", "spi"]),
      pin("D12", "D12", ["gpio", "spi"]),
      pin("D13", "D13", ["gpio", "spi"]),
      pin("A0", "A0", ["gpio", "analog"]),
      pin("A1", "A1", ["gpio", "analog"]),
      pin("A2", "A2", ["gpio", "analog"]),
      pin("A3", "A3", ["gpio", "analog"]),
      pin("A4", "A4/SDA", ["gpio", "analog", "i2c-sda"]),
      pin("A5", "A5/SCL", ["gpio", "analog", "i2c-scl"]),
    ],
  },
  rpi_pico: {
    id: "rpi_pico",
    name: "Raspberry Pi Pico (RP2040)",
    logicVoltage: 3.3,
    logicVoltageTolerant5V: false,
    rails: {
      v3v3: { voltage: 3.3, maxCurrentMa: 300 },
      v5: { voltage: 5, maxCurrentMa: 500 },
    },
    pins: [
      pin("3V3", "3V3(OUT)", ["power"]),
      pin("VSYS", "VSYS/5V", ["power"]),
      pin("GND1", "GND", ["gnd"]),
      pin("GND2", "GND", ["gnd"]),
      pin("GP0", "GP0 (I2C0 SDA / SPI0 RX)", ["gpio", "i2c-sda", "spi", "uart", "pwm"]),
      pin("GP1", "GP1 (I2C0 SCL / SPI0 CSn)", ["gpio", "i2c-scl", "spi", "uart", "pwm"]),
      pin("GP2", "GP2 (I2C1 SDA / SPI0 SCK)", ["gpio", "i2c-sda", "spi", "pwm"]),
      pin("GP3", "GP3 (I2C1 SCL / SPI0 TX)", ["gpio", "i2c-scl", "spi", "pwm"]),
      pin("GP4", "GP4 (I2C0 SDA / SPI0 RX)", ["gpio", "i2c-sda", "spi", "uart", "pwm"]),
      pin("GP5", "GP5 (I2C0 SCL / SPI0 CSn)", ["gpio", "i2c-scl", "spi", "uart", "pwm"]),
      pin("GP6", "GP6 (I2C1 SDA / SPI0 SCK)", ["gpio", "i2c-sda", "spi", "pwm"]),
      pin("GP7", "GP7 (I2C1 SCL / SPI0 TX)", ["gpio", "i2c-scl", "spi", "pwm"]),
      pin("GP8", "GP8 (I2C0 SDA / SPI1 RX)", ["gpio", "i2c-sda", "spi", "uart", "pwm"]),
      pin("GP9", "GP9 (I2C0 SCL / SPI1 CSn)", ["gpio", "i2c-scl", "spi", "uart", "pwm"]),
      pin("GP10", "GP10 (I2C1 SDA / SPI1 SCK)", ["gpio", "i2c-sda", "spi", "pwm"]),
      pin("GP11", "GP11 (I2C1 SCL / SPI1 TX)", ["gpio", "i2c-scl", "spi", "pwm"]),
      pin("GP12", "GP12 (I2C0 SDA / SPI1 RX)", ["gpio", "i2c-sda", "spi", "uart", "pwm"]),
      pin("GP13", "GP13 (I2C0 SCL / SPI1 CSn)", ["gpio", "i2c-scl", "spi", "uart", "pwm"]),
      pin("GP14", "GP14 (I2C1 SDA / SPI1 SCK)", ["gpio", "i2c-sda", "spi", "pwm"]),
      pin("GP15", "GP15 (I2C1 SCL / SPI1 TX)", ["gpio", "i2c-scl", "spi", "pwm"]),
      pin("GP16", "GP16 (I2C0 SDA / SPI0 RX)", ["gpio", "i2c-sda", "spi", "uart", "pwm"]),
      pin("GP17", "GP17 (I2C0 SCL / SPI0 CSn)", ["gpio", "i2c-scl", "spi", "uart", "pwm"]),
      pin("GP18", "GP18 (I2C1 SDA / SPI0 SCK)", ["gpio", "i2c-sda", "spi", "pwm"]),
      pin("GP19", "GP19 (I2C1 SCL / SPI0 TX)", ["gpio", "i2c-scl", "spi", "pwm"]),
      pin("GP20", "GP20 (I2C0 SDA)", ["gpio", "i2c-sda", "pwm"]),
      pin("GP21", "GP21 (I2C0 SCL)", ["gpio", "i2c-scl", "pwm"]),
      pin("GP26", "GP26/ADC0 (I2C1 SDA)", ["gpio", "analog", "i2c-sda", "pwm"]),
      pin("GP27", "GP27/ADC1 (I2C1 SCL)", ["gpio", "analog", "i2c-scl", "pwm"]),
      pin("GP28", "GP28/ADC2", ["gpio", "analog", "pwm"]),
    ],
  },
};

export const PERIPHERALS: Record<string, Peripheral> = {
  ssd1306: {
    id: "ssd1306",
    name: "SSD1306 OLED (I2C)",
    description: "128x64 I2C OLED display module (default address 0x3C).",
    supplyVoltage: 3.3,
    supplyVoltageMin: 3.3,
    supplyVoltageMax: 5,
    currentDrawMa: 20,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 3.3 },
      { name: "GND", type: "gnd" },
      { name: "SDA", type: "i2c-sda", i2cAddress: 0x3c },
      { name: "SCL", type: "i2c-scl", i2cAddress: 0x3c },
    ],
  },
  hcsr04: {
    id: "hcsr04",
    name: "HC-SR04 Ultrasonic Sensor",
    description: "Ultrasonic distance sensor. VCC is 5V and ECHO outputs 5V logic.",
    supplyVoltage: 5,
    supplyVoltageMin: 5,
    supplyVoltageMax: 5,
    currentDrawMa: 15,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 5 },
      { name: "GND", type: "gnd" },
      { name: "TRIG", type: "digital-out", voltage: 5, notes: "Driven by MCU; 3.3V often accepted by module." },
      { name: "ECHO", type: "digital-in", voltage: 5, notes: "Outputs 5V; requires level shifting to 3.3V MCU GPIO." },
    ],
  },
  dht22: {
    id: "dht22",
    name: "DHT22 Temperature/Humidity Sensor",
    description: "Single-wire digital sensor, 3.3V-5V supply. Requires 10kΩ pull-up on data line.",
    supplyVoltage: 3.3,
    supplyVoltageMin: 3.3,
    supplyVoltageMax: 5,
    currentDrawMa: 2.5,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 3.3 },
      { name: "GND", type: "gnd" },
      { name: "DATA", type: "digital-bidir", voltage: 3.3, notes: "Use 10kΩ pull-up resistor to VCC." },
    ],
    notes: "Recommend 10kΩ pull-up resistor on DATA line.",
  },
  relay_5v_module: {
    id: "relay_5v_module",
    name: "5V Relay Module",
    description: "Single-channel relay module with driver; coil current drawn from supply rail.",
    supplyVoltage: 5,
    currentDrawMa: 70,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 5 },
      { name: "GND", type: "gnd" },
      { name: "IN", type: "digital-out", voltage: 5, notes: "Some modules expect 5V logic; 3.3V may be unreliable." },
    ],
  },
  sg90: {
    id: "sg90",
    name: "SG90 Micro Servo",
    description: "5V hobby servo with PWM control; current spikes during movement.",
    supplyVoltage: 5,
    supplyVoltageMin: 4.8,
    supplyVoltageMax: 6,
    currentDrawMa: 250,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 5 },
      { name: "GND", type: "gnd" },
      { name: "PWM", type: "pwm", voltage: 5, notes: "Control signal often 3.3V-tolerant, but power must be 5V." },
    ],
    notes: "Peak current spikes can brown out onboard regulators when powered from a 3.3V rail.",
  },
  mpu6050: {
    id: "mpu6050",
    name: "MPU6050 IMU (I2C)",
    description: "6-axis accelerometer/gyro module (default address 0x68).",
    supplyVoltage: 3.3,
    supplyVoltageMin: 3.3,
    supplyVoltageMax: 5,
    currentDrawMa: 4,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 3.3 },
      { name: "GND", type: "gnd" },
      { name: "SDA", type: "i2c-sda", i2cAddress: 0x68 },
      { name: "SCL", type: "i2c-scl", i2cAddress: 0x68 },
    ],
  },
  bme280: {
    id: "bme280",
    name: "BME280 Sensor (I2C)",
    description: "Temperature/humidity/pressure sensor (address 0x76 or 0x77).",
    supplyVoltage: 3.3,
    supplyVoltageMin: 3.3,
    supplyVoltageMax: 3.6,
    currentDrawMa: 1,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 3.3 },
      { name: "GND", type: "gnd" },
      { name: "SDA", type: "i2c-sda", i2cAddress: 0x76 },
      { name: "SCL", type: "i2c-scl", i2cAddress: 0x76 },
    ],
    notes: "Some modules use address 0x77 depending on SDO wiring; modeled as 0x76 by default.",
  },
  ws2812b_8: {
    id: "ws2812b_8",
    name: "WS2812B NeoPixel Strip (8 LEDs)",
    description: "Addressable RGB LEDs, 5V supply. Up to 60mA per LED at full white.",
    supplyVoltage: 5,
    supplyVoltageMin: 5,
    supplyVoltageMax: 5,
    currentDrawMa: 480,
    pinRequirements: [
      { name: "VCC", type: "power", voltage: 5 },
      { name: "GND", type: "gnd" },
      { name: "DIN", type: "digital-out", voltage: 5, notes: "Data line; 3.3V logic may work but 5V level shifting is recommended." },
    ],
    notes: "8 LEDs * 60mA = 480mA max. Avoid powering from weak USB/regulator rails without headroom.",
  },
};

export function getBoard(id: string): Board | undefined {
  return BOARDS[id];
}

export function getPeripheral(id: string): Peripheral | undefined {
  return PERIPHERALS[id];
}

export interface ResolvedPin {
  component: ComponentInstance;
  board?: Board;
  pin?: Pin;
  peripheral?: Peripheral;
  perReq?: PeripheralPinRequirement;
}

export function lintCircuit(state: CircuitState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const components = Array.isArray(state.components) ? state.components : [];
  const wires = Array.isArray(state.wires) ? state.wires : [];
  const pinStates = Array.isArray(state.pinStates) ? state.pinStates : [];
  const faults = Array.isArray(state.faults) ? state.faults : [];
  const componentsById = new Map(components.map((c) => [c.id, c]));
  const pinStateIndex = new Map<string, { direction?: "input" | "output" | "bidirectional"; level?: "HIGH" | "LOW" | "FLOATING" }>();
  for (const ps of pinStates) {
    pinStateIndex.set(`${ps.componentId}:${ps.pinId}`, { direction: ps.direction, level: ps.level });
  }

  const resolvePin = (ref: { componentId: string; pinId: string }): ResolvedPin => {
    const component = componentsById.get(ref.componentId);
    if (!component) return { component: undefined as unknown as ComponentInstance };
    if (component.kind === "board") {
      const board = BOARDS[component.refId];
      const pin = board?.pins.find((p) => p.id === ref.pinId);
      return { component, board, pin };
    }
    const peripheral = PERIPHERALS[component.refId];
    const perReq = peripheral?.pinRequirements.find((p) => p.name === ref.pinId);
    return { component, peripheral, perReq };
  };

  const key = (c: string, p: string) => `${c}:${p}`;
  const netParent = new Map<string, string>();
  const find = (x: string): string => {
    if (!netParent.has(x)) netParent.set(x, x);
    const p = netParent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    netParent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) netParent.set(ra, rb);
  };
  for (const w of wires) union(key(w.from.componentId, w.from.pinId), key(w.to.componentId, w.to.pinId));
  const nets = new Map<string, Array<{ componentId: string; pinId: string }>>();
  for (const w of wires) {
    for (const end of [w.from, w.to]) {
      const r = find(key(end.componentId, end.pinId));
      if (!nets.has(r)) nets.set(r, []);
      const arr = nets.get(r)!;
      if (!arr.some((e) => e.componentId === end.componentId && e.pinId === end.pinId)) arr.push(end);
    }
  }

  // 0) Wires that point at components/pins the engine cannot resolve.
  for (const w of wires) {
    for (const end of [w.from, w.to]) {
      const component = componentsById.get(end.componentId);
      if (!component) {
        diagnostics.push({
          severity: "WARNING",
          code: "INVALID_CONNECTION",
          message: `Wire ${w.id} references unknown component "${end.componentId}".`,
          explanation: "The saved circuit contains a wire endpoint that no longer exists. The wire is ignored when rendering and linting.",
          fix: "Delete the dangling wire or re-add the missing component.",
          componentIds: [end.componentId],
        });
        continue;
      }
      const resolved = resolvePin(end);
      const pinExists =
        component.kind === "board" ? Boolean(resolved.pin) : Boolean(resolved.perReq);
      if (!pinExists) {
        diagnostics.push({
          severity: "WARNING",
          code: "INVALID_CONNECTION",
          message: `Wire ${w.id} references unknown pin "${end.pinId}" on ${component.label ?? component.refId}.`,
          explanation: "The pin id does not exist on this board/peripheral definition, so the connection cannot be verified.",
          fix: "Delete the wire or choose a pin that exists on the selected component.",
          componentIds: [end.componentId],
          pinIds: [end.pinId],
        });
      }
    }
  }

  // 1) Pin-to-pin collisions (multiple output drivers on same net)
  for (const [, endpoints] of nets.entries()) {
    const boardGpio = endpoints
      .map((e) => ({ e, r: resolvePin(e) }))
      .filter((x) => x.r.board && x.r.pin && (x.r.pin.modes.includes("gpio") || x.r.pin.modes.includes("pwm") || x.r.pin.modes.includes("uart") || x.r.pin.modes.includes("spi") || x.r.pin.modes.includes("i2c-sda") || x.r.pin.modes.includes("i2c-scl")));
    const outputs = boardGpio.filter((x) => pinStateIndex.get(key(x.e.componentId, x.e.pinId))?.direction === "output");
    if (outputs.length > 1) {
      diagnostics.push({
        severity: "CRITICAL",
        code: "PIN_COLLISION",
        message: `Multiple GPIO outputs drive the same net (${outputs.map((o) => `${o.e.componentId}.${o.r.pin!.id}`).join(", ")}).`,
        explanation: "Two or more output drivers on one net can contend (HIGH vs LOW), causing excessive current and potential pin damage.",
        fix: "Separate signals onto different nets/pins or ensure only one driver is enabled at a time (tri-state/buffer).",
        componentIds: Array.from(new Set(outputs.map((o) => o.e.componentId))),
        pinIds: outputs.map((o) => o.r.pin!.id),
      });
    }
  }

  // 2) I2C bus sharing / address collisions
  for (const [, endpoints] of nets.entries()) {
    const i2cDevices: Array<{ componentId: string; addr: number; name: string }> = [];
    for (const e of endpoints) {
      const r = resolvePin(e);
      if (r.peripheral && r.perReq && (r.perReq.type === "i2c-sda" || r.perReq.type === "i2c-scl") && typeof r.perReq!.i2cAddress === "number") {
        if (!i2cDevices.some((d) => d.componentId === e.componentId && d.addr === r.perReq!.i2cAddress)) {
          i2cDevices.push({ componentId: e.componentId, addr: r.perReq!.i2cAddress, name: r.peripheral.name });
        }
      }
    }
    if (i2cDevices.length > 1) {
      const byAddr = new Map<number, typeof i2cDevices>();
      for (const d of i2cDevices) {
        if (!byAddr.has(d.addr)) byAddr.set(d.addr, []);
        byAddr.get(d.addr)!.push(d);
      }
      for (const [addr, devs] of byAddr.entries()) {
        if (devs.length > 1) {
          diagnostics.push({
            severity: "CRITICAL",
            code: "I2C_ADDRESS_COLLISION",
            message: `I2C address collision at 0x${addr.toString(16)} on shared bus (${devs.map((d) => d.name).join(", ")}).`,
            explanation: "Two I2C peripherals at the same 7-bit address on one bus can both ACK and drive SDA, corrupting transactions.",
            fix: "Change one device address (if configurable), use an I2C multiplexer, or place a device on a separate bus.",
            componentIds: devs.map((d) => d.componentId),
          });
        }
      }
    }
  }

  // 3) Voltage domain and power rail mismatches
  const uartReservedPins: Record<string, string[]> = {
    arduino_uno_r3: ["D0", "D1"],
    esp32_devkit_v1: ["GPIO1", "GPIO3"],
  };
  for (const [, endpoints] of nets.entries()) {
    const boardPins = endpoints
      .map((e) => ({ e, r: resolvePin(e) }))
      .filter((x): x is { e: { componentId: string; pinId: string }; r: ResolvedPin & { board: Board; pin: Pin } } => Boolean(x.r.board && x.r.pin));
    const perPins = endpoints
      .map((e) => ({ e, r: resolvePin(e) }))
      .filter((x): x is { e: { componentId: string; pinId: string }; r: ResolvedPin & { peripheral: Peripheral; perReq: PeripheralPinRequirement } } => Boolean(x.r.peripheral && x.r.perReq));

    for (const bp of boardPins) {
      const board = bp.r.board as Board;
      const bpin = bp.r.pin as Pin;
      if (bpin.modes.includes("reserved")) continue;

      // Supply rails must sit inside the peripheral's rated input range.
      if (bpin.modes.includes("power")) {
        const railVoltage = powerPinVoltage(board, bpin);
        if (railVoltage === null) continue;
        for (const pp of perPins) {
          const req = pp.r.perReq as PeripheralPinRequirement;
          if (req.type !== "power") continue;
          const min = pp.r.peripheral.supplyVoltageMin ?? pp.r.peripheral.supplyVoltage;
          const max = pp.r.peripheral.supplyVoltageMax ?? pp.r.peripheral.supplyVoltage;
          if (railVoltage >= min - 0.01 && railVoltage <= max + 0.01) continue;
          diagnostics.push({
            severity: "WARNING",
            code: "POWER_RAIL_MISMATCH",
            message: `${pp.r.peripheral.name} is powered from ${board.name} ${bpin.label} (${railVoltage}V), outside its ${min}-${max}V supply range.`,
            explanation: "Powering a module outside its rated input range can prevent startup, brown it out under load, or permanently damage it.",
            fix: `Supply ${pp.r.peripheral.name} from a ${pp.r.peripheral.supplyVoltage}V rail (or the range ${min}-${max}V) with a common ground.`,
            componentIds: [bp.e.componentId, pp.e.componentId],
            pinIds: [bpin.id, req.name],
          });
        }
        continue;
      }

      if (bpin.modes.includes("gnd")) continue;
      if (uartReservedPins[board.id]?.includes(bpin.id)) {
        for (const pp of perPins) {
          const req = pp.r.perReq as PeripheralPinRequirement;
          if (req.type === "uart-tx" || req.type === "uart-rx") continue;
          if (req.type === "power" || req.type === "gnd") continue;
          diagnostics.push({
            severity: "WARNING",
            code: "UART_PIN_CONFLICT",
            message: `${board.name} ${bpin.label} is the hardware serial/UART pin but is wired to ${pp.r.peripheral.name} ${req.name}.`,
            explanation: "D0/D1 on the Uno and GPIO1/GPIO3 on the ESP32 carry the bootloader/serial console. Using them for peripherals can block flashing or corrupt serial output.",
            fix: "Move the signal to a non-UART GPIO or intentionally use a software serial port.",
            componentIds: [bp.e.componentId, pp.e.componentId],
            pinIds: [bpin.id, req.name],
          });
        }
      }

      if (board.logicVoltageTolerant5V) continue;
      for (const pp of perPins) {
        const req = pp.r.perReq as PeripheralPinRequirement;
        const sigV = req.voltage;
        if (!sigV || req.type === "power" || req.type === "gnd") continue;
        const isSignal = ["digital-in","digital-out","digital-bidir","pwm","analog","uart-tx","uart-rx","i2c-sda","i2c-scl"].includes(req.type);
        if (!isSignal) continue;
        if (sigV > board.logicVoltage) {
          const isInputToMcu = ["digital-in","digital-bidir","uart-tx","i2c-sda","i2c-scl","analog"].includes(req.type);
          diagnostics.push({
            severity: isInputToMcu ? "CRITICAL" : "WARNING",
            code: "VOLTAGE_DOMAIN_MISMATCH",
            message: `${pp.r.peripheral.name} pin ${req.name} (${sigV}V) connected to ${board.name} ${bpin.label} (${board.logicVoltage}V logic, not 5V tolerant).`,
            explanation: isInputToMcu
              ? "Applying voltage above a non-5V-tolerant GPIO's absolute maximum can damage the MCU pin via protection diodes or latch-up."
              : "Driving a higher-voltage peripheral input from lower-voltage logic can be unreliable and indicates a domain mismatch.",
            fix: isInputToMcu
              ? "Insert a level shifter or resistor divider so the MCU pin never exceeds its rated voltage."
              : "Verify logic thresholds or use a level shifter/buffer.",
            componentIds: [bp.e.componentId, pp.e.componentId],
            pinIds: [bpin.id, req.name],
          });
        }
      }
    }
  }

  // 4) Input-only pin misuse
  for (const ps of pinStates) {
    if (ps.direction !== "output" && ps.direction !== "bidirectional") continue;
    const r = resolvePin({ componentId: ps.componentId, pinId: ps.pinId });
    if (r.board && r.pin && r.pin.isInputOnly) {
      diagnostics.push({
        severity: "CRITICAL",
        code: "INPUT_ONLY_PIN_AS_OUTPUT",
        message: `${r.board.name} ${r.pin.label} is input-only and cannot be driven as an output.`,
        explanation: "Input-only GPIOs have no output driver; attempting to drive them indicates a wiring/firmware design error and will not function.",
        fix: "Move the signal to a GPIO-capable pin that supports output mode.",
        componentIds: [ps.componentId],
        pinIds: [ps.pinId],
      });
    }
  }

  // 5) ESP32 strapping pin hazards & flash-connected pins
  for (const ps of pinStates) {
    const r = resolvePin({ componentId: ps.componentId, pinId: ps.pinId });
    if (!r.board || !r.pin) continue;
    if (r.board.id === "esp32_devkit_v1" && r.pin.id === "GPIO12" && ps.level === "HIGH") {
      diagnostics.push({
        severity: "CRITICAL",
        code: "ESP32_STRAPPING_GPIO12_HIGH",
        message: "ESP32 GPIO12 is driven HIGH at boot (strapping pin).",
        explanation: "If GPIO12 is sampled HIGH at reset, the ESP32 sets SPI flash voltage to 1.8V, which can cause a flash voltage boot failure on 3.3V flash modules.",
        fix: "Ensure GPIO12 is LOW at boot (external pull-down or avoid driving HIGH during reset).",
        componentIds: [ps.componentId],
        pinIds: [ps.pinId],
      });
    }
    if (r.board.id === "esp32_devkit_v1" && r.pin.isStrapping && r.pin.id !== "GPIO12" && ps.direction === "output") {
      diagnostics.push({
        severity: "WARNING",
        code: "ESP32_STRAPPING_PIN_DRIVEN",
        message: `ESP32 ${r.pin.label} is a strapping pin driven as output.`,
        explanation: `Strapping pins are sampled at reset to select boot modes; external drive can alter boot behavior. ${r.pin.strappingCondition ?? ""}`.trim(),
        fix: "Avoid driving strapping pins during reset or ensure required boot levels are preserved.",
        componentIds: [ps.componentId],
        pinIds: [ps.pinId],
      });
    }
  }
  for (const [, endpoints] of nets.entries()) {
    for (const e of endpoints) {
      const r = resolvePin(e);
      if (r.board?.id === "esp32_devkit_v1" && r.pin?.isFlashConnected && endpoints.length > 1) {
        diagnostics.push({
          severity: "CRITICAL",
          code: "ESP32_FLASH_PIN_USED",
          message: `ESP32 ${r.pin.label} is connected to internal SPI flash and must not be used externally.`,
          explanation: "GPIO6-11 are wired to the module's SPI flash; external use can corrupt flash access and crash boot/runtime.",
          fix: "Disconnect external circuitry from GPIO6-11 and select a different GPIO.",
          componentIds: [e.componentId],
          pinIds: [r.pin.id],
        });
      }
    }
  }

  // 6) Required peripheral pins that are not connected.
  for (const component of components) {
    if (component.kind !== "peripheral") continue;
    const peripheral = PERIPHERALS[component.refId];
    if (!peripheral) continue;
    for (const req of peripheral.pinRequirements) {
      const connected = wires.some(
        (wire) =>
          (wire.from.componentId === component.id && wire.from.pinId === req.name) ||
          (wire.to.componentId === component.id && wire.to.pinId === req.name),
      );
      if (connected) continue;
      diagnostics.push({
        severity: "WARNING",
        code: "UNCONNECTED_PERIPHERAL_PIN",
        message: `${peripheral.name} pin ${req.name} is not connected.`,
        explanation: "Every power, ground and signal pin in the component definition is required for the module to operate as modeled.",
        fix: `Wire ${peripheral.name} ${req.name} to a compatible board pin.`,
        componentIds: [component.id],
        pinIds: [req.name],
      });
    }
  }

  // 7) Explicitly injected faults.
  for (const fault of faults) {
    if (fault.type === "open") {
      diagnostics.push({
        severity: "CRITICAL",
        code: "FAULT_OPEN_CIRCUIT",
        message: `Injected open circuit${fault.note ? `: ${fault.note}` : "."}`,
        explanation: "An open signal has no current path, so the peripheral will float or never receive its command.",
        fix: "Reconnect the wire and verify continuity with a multimeter.",
        componentIds: fault.componentId ? [fault.componentId] : undefined,
        pinIds: fault.pinId ? [fault.pinId] : undefined,
      });
    } else if (fault.type === "floating") {
      diagnostics.push({
        severity: "WARNING",
        code: "FAULT_FLOATING_PIN",
        message: `Injected floating input${fault.pinId ? ` on ${fault.pinId}` : ""}.`,
        explanation: "A floating CMOS input picks up noise and can oscillate, producing random readings or false triggers.",
        fix: "Enable the internal pull-up/pull-down or add an external resistor.",
        componentIds: fault.componentId ? [fault.componentId] : undefined,
        pinIds: fault.pinId ? [fault.pinId] : undefined,
      });
    } else {
      diagnostics.push({
        severity: "CRITICAL",
        code: "FAULT_POWER_BROWNOUT",
        message: `Injected brownout on the ${fault.rail ?? "supply"} rail.`,
        explanation: "Dropping the rail below the regulator's dropout or the MCU's minimum causes resets, corrupted I2C transactions, and unreliable GPIO levels.",
        fix: "Use a supply with enough headroom, add bulk capacitance, and reduce peak load.",
        componentIds: fault.componentId ? [fault.componentId] : undefined,
      });
    }
  }

  // 8) Current budget on 3.3V/5V rails
  for (const comp of components) {
    if (comp.kind !== "board") continue;
    const board = BOARDS[comp.refId];
    if (!board) continue;
    const railLoads: Record<string, number> = { "3.3V": 0, "5V": 0 };
    const counted = new Set<string>();
    for (const [, endpoints] of nets.entries()) {
      const boardPower = endpoints
        .filter((e) => e.componentId === comp.id)
        .map((e) => resolvePin(e))
        .find((resolved) => resolved.board && resolved.pin?.modes.includes("power"));
      if (!boardPower?.pin) continue;
      const voltage = powerPinVoltage(board, boardPower.pin);
      if (voltage === null) continue;
      const rail = voltage <= 3.6 ? "3.3V" : "5V";
      for (const e of endpoints) {
        const r = resolvePin(e);
        if (!r.peripheral || r.perReq?.type !== "power") continue;
        const loadKey = `${rail}:${e.componentId}`;
        if (counted.has(loadKey)) continue;
        counted.add(loadKey);
        railLoads[rail] += r.peripheral.currentDrawMa;
        if (r.peripheral.id === "ws2812b_8") {
          diagnostics.push({
            severity: "WARNING",
            code: "NEOPIXEL_POWER_BUDGET",
            message: "WS2812B NeoPixel strip (8 LEDs, up to 480mA) may overload USB/regulator power rails.",
            explanation: "Full-white draw can reach ~480mA for 8 LEDs, exceeding many onboard regulator/USB budgets and causing brownouts.",
            fix: "Use a dedicated 5V supply sized for peak current with bulk capacitance and common ground.",
            componentIds: [comp.id, e.componentId],
          });
        }
      }
    }
    for (const [rail, max] of [["3.3V", board.rails.v3v3?.maxCurrentMa], ["5V", board.rails.v5?.maxCurrentMa]] as const) {
      if (!max) continue;
      const load = railLoads[rail];
      if (load > max) {
        diagnostics.push({
          severity: "WARNING",
          code: "CURRENT_BUDGET_EXCEEDED",
          message: `Estimated load on ${board.name} ${rail} rail is ${load}mA, exceeding rated budget ${max}mA.`,
          explanation: "Exceeding regulator/rail current limits can cause brownouts, resets, overheating, or instability.",
          fix: "Power high-current peripherals from an external regulated supply with common ground, or reduce load.",
          componentIds: [comp.id],
        });
      } else if (load > max * 0.8 && load > 0) {
        diagnostics.push({
          severity: "INFO",
          code: "CURRENT_BUDGET_HIGH",
          message: `Estimated load on ${board.name} ${rail} rail is ${load}mA (${Math.round((load / max) * 100)}% of ${max}mA).`,
          explanation: "Operating near current limits leaves little margin for transients.",
          fix: "Consider an external supply or added capacitance for transient headroom.",
          componentIds: [comp.id],
        });
      }
    }
  }

  const seen = new Set<string>();
  const deduped: Diagnostic[] = [];
  for (const d of diagnostics) {
    const k = JSON.stringify([d.code, d.message, (d.componentIds ?? []).slice().sort(), (d.pinIds ?? []).slice().sort()]);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(d);
  }
  const order: Record<DiagnosticSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  deduped.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
  return deduped;
}
