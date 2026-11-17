import {
  PERIPHERALS,
  type Board,
  type CircuitFault,
  type CircuitState,
  type ComponentInstance,
  type PeripheralPinRequirement,
  type Pin,
  type PinState,
  type Wire,
  derivePinStates,
  findCompatiblePin,
  getBoard,
  getPeripheral,
  lintCircuit,
  scoreDiagnostics,
  selectPowerPinForPeripheral,
} from "../hardware/index";
import { analyzePrompt } from "./analyze";
import { PRESETS, detectPreset } from "./presets";

export interface GenerationOptions {
  /** Force a specific board id (validated against the board database). */
  preferBoard?: string;
  /** Force a specific set of peripheral ids (validated against the database). */
  peripherals?: string[];
}

export interface CircuitGenerationResult {
  circuitState: CircuitState;
  boardId: string;
  explanation: string;
  diagnostics: ReturnType<typeof lintCircuit>;
  healthScore: number;
  presetUsed?: string;
}

export interface CircuitPlan {
  boardId: string;
  peripheralIds: string[];
  faults?: CircuitFault[];
  /** key: `${peripheralId}:${pinRequirementName}` -> board pin id */
  overrides?: Record<string, string>;
  /** Pin levels applied on top of the derived states (used by the buggy demo). */
  pinLevels?: Array<{ pinId: string; level: "HIGH" | "LOW" | "FLOATING" }>;
}

type Assignment = {
  peripheralId: string;
  req: PeripheralPinRequirement;
  pin: Pin;
};

function assignmentKey(peripheralId: string, reqName: string): string {
  return `${peripheralId}:${reqName}`;
}

function buildAssignments(
  board: Board,
  peripheralIds: string[],
  overrides: Record<string, string> = {},
): Assignment[] {
  const assignments: Assignment[] = [];
  const usedSignalPins = new Set<string>();
  const i2cBuses: Record<"i2c-sda" | "i2c-scl", Pin | undefined> = {
    "i2c-sda": undefined,
    "i2c-scl": undefined,
  };

  for (const peripheralId of peripheralIds) {
    const peripheral = PERIPHERALS[peripheralId];
    if (!peripheral) continue;

    for (const req of peripheral.pinRequirements) {
      const overridePinId = overrides[assignmentKey(peripheralId, req.name)];
      const overridePin = overridePinId
        ? board.pins.find((pin) => pin.id === overridePinId)
        : undefined;
      if (overridePin) {
        assignments.push({ peripheralId, req, pin: overridePin });
        continue;
      }

      if (req.type === "power") {
        const chosen = selectPowerPinForPeripheral(board, peripheral);
        const fallback = board.pins.find((pin) => pin.modes.includes("power"));
        const pin = chosen?.pin ?? fallback;
        if (pin) assignments.push({ peripheralId, req, pin });
        continue;
      }

      if (req.type === "gnd") {
        const pin = board.pins.find((candidate) => candidate.modes.includes("gnd"));
        if (pin) assignments.push({ peripheralId, req, pin });
        continue;
      }

      if (req.type === "i2c-sda" || req.type === "i2c-scl") {
        const existing = i2cBuses[req.type];
        if (existing) {
          assignments.push({ peripheralId, req, pin: existing });
          continue;
        }
      }

      const pin = findCompatiblePin(board, req, usedSignalPins);
      if (!pin) continue;

      if (req.type === "i2c-sda" || req.type === "i2c-scl") {
        i2cBuses[req.type] = pin;
      }
      usedSignalPins.add(pin.id);
      assignments.push({ peripheralId, req, pin });
    }
  }

  return assignments;
}

function describeAssignment(board: Board, assignment: Assignment): string {
  const peripheral = PERIPHERALS[assignment.peripheralId];
  const { req, pin } = assignment;
  const reason: string[] = [];
  switch (req.type) {
    case "power": {
      const voltage = /3V3|3\.3V/i.test(pin.id) ? board.rails.v3v3?.voltage : board.rails.v5?.voltage;
      reason.push(`${voltage ?? req.voltage ?? "?"}V supply rail`);
      break;
    }
    case "gnd":
      reason.push("ground reference");
      break;
    case "i2c-sda":
      reason.push(`I2C SDA (address 0x${req.i2cAddress?.toString(16) ?? "?"})`);
      break;
    case "i2c-scl":
      reason.push(`I2C SCL (address 0x${req.i2cAddress?.toString(16) ?? "?"})`);
      break;
    case "pwm":
      reason.push("PWM output");
      break;
    case "analog":
      reason.push("ADC input");
      break;
    case "uart-tx":
      reason.push("UART TX");
      break;
    case "uart-rx":
      reason.push("UART RX");
      break;
    case "digital-in":
      reason.push("digital input");
      break;
    case "digital-out":
      reason.push("digital output");
      break;
    case "digital-bidir":
      reason.push("bidirectional digital signal");
      break;
  }

  const notes: string[] = [];
  if (pin.isInputOnly) notes.push("input-only");
  if (pin.isStrapping) notes.push("strapping pin");
  if (pin.isFlashConnected) notes.push("internal flash");
  if (pin.isAdc2) notes.push("ADC2/WiFi conflict");
  const suffix = notes.length > 0 ? ` [${notes.join(", ")}]` : "";

  return `• ${peripheral?.name ?? assignment.peripheralId} ${req.name} → ${pin.label}${suffix}: ${reason.join(", ")}`;
}

function buildExplanation(board: Board, assignments: Assignment[], faults: CircuitFault[]): string {
  const lines: string[] = [];
  lines.push(
    `Board: ${board.name} (${board.logicVoltage}V logic${board.logicVoltageTolerant5V ? ", 5V tolerant" : ", NOT 5V tolerant"})`,
  );
  lines.push("");

  const seen = new Set<string>();
  for (const assignment of assignments) {
    const key = `${assignment.peripheralId}:${assignment.req.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(describeAssignment(board, assignment));
  }

  const i2cDevices = assignments.filter(
    (assignment) => assignment.req.type === "i2c-sda" || assignment.req.type === "i2c-scl",
  );
  if (i2cDevices.length > 2) {
    const sda = i2cDevices.find((assignment) => assignment.req.type === "i2c-sda")?.pin;
    const scl = i2cDevices.find((assignment) => assignment.req.type === "i2c-scl")?.pin;
    lines.push("");
    lines.push(
      `I2C bus shared by ${new Set(i2cDevices.map((assignment) => assignment.peripheralId)).size} devices on SDA=${sda?.label ?? "?"} / SCL=${scl?.label ?? "?"}.`,
    );
  }

  if (faults.length > 0) {
    lines.push("");
    lines.push(`Injected faults: ${faults.map((fault) => fault.type).join(", ")}.`);
  }

  return lines.join("\n");
}

export function buildCircuitFromPlan(plan: CircuitPlan): CircuitGenerationResult {
  const board = getBoard(plan.boardId);
  if (!board) throw new Error(`Unknown board id "${plan.boardId}"`);

  const peripheralIds = Array.from(
    new Set(plan.peripheralIds.filter((id) => Boolean(getPeripheral(id)))),
  );
  if (peripheralIds.length === 0) {
    throw new Error("A circuit needs at least one known peripheral");
  }

  const components: ComponentInstance[] = [
    { id: "board_1", kind: "board", refId: board.id, label: board.name },
    ...peripheralIds.map((peripheralId, index) => ({
      id: `peripheral_${index + 1}`,
      kind: "peripheral" as const,
      refId: peripheralId,
      label: PERIPHERALS[peripheralId]?.name,
    })),
  ];

  const assignments = buildAssignments(board, peripheralIds, plan.overrides);
  const assignmentFor = (peripheralId: string, reqName: string) =>
    assignments.find(
      (assignment) => assignment.peripheralId === peripheralId && assignment.req.name === reqName,
    );

  const wires: Wire[] = [];
  let wireNumber = 1;
  for (const [index, peripheralId] of peripheralIds.entries()) {
    const peripheral = PERIPHERALS[peripheralId];
    if (!peripheral) continue;
    for (const req of peripheral.pinRequirements) {
      const assignment = assignmentFor(peripheralId, req.name);
      if (!assignment) continue;
      wires.push({
        id: `wire_${wireNumber++}`,
        from: { componentId: "board_1", pinId: assignment.pin.id },
        to: { componentId: `peripheral_${index + 1}`, pinId: req.name },
      });
    }
  }

  const faults = plan.faults ? plan.faults.map((fault) => ({ ...fault })) : [];
  const baseState: CircuitState = { components, wires, faults };
  const derived = derivePinStates(baseState);

  const pinStateMap = new Map<string, PinState>();
  for (const pinState of derived) {
    pinStateMap.set(`${pinState.componentId}:${pinState.pinId}`, {
      ...pinState,
      direction: pinState.direction ?? "bidirectional",
      level: pinState.level ?? "FLOATING",
    });
  }
  for (const override of plan.pinLevels ?? []) {
    const key = `board_1:${override.pinId}`;
    const existing = pinStateMap.get(key);
    if (existing) {
      existing.level = override.level;
    } else {
      pinStateMap.set(key, {
        componentId: "board_1",
        pinId: override.pinId,
        direction: "output",
        level: override.level,
      });
    }
  }

  const circuitState: CircuitState = {
    components,
    wires,
    pinStates: Array.from(pinStateMap.values()),
    ...(faults.length > 0 ? { faults } : {}),
  };

  const diagnostics = lintCircuit(circuitState);
  return {
    circuitState,
    boardId: board.id,
    explanation: buildExplanation(board, assignments, faults),
    diagnostics,
    healthScore: scoreDiagnostics(diagnostics),
  };
}

export async function generateCircuitFromPrompt(
  prompt: string,
  options: GenerationOptions = {},
): Promise<CircuitGenerationResult> {
  const presetName = detectPreset(prompt);
  if (presetName && !options.preferBoard && !options.peripherals) {
    const preset = PRESETS[presetName];
    return {
      ...buildCircuitFromPlan({
        boardId: preset.boardId,
        peripheralIds: preset.peripherals,
        faults: preset.faults,
        overrides: preset.overrides,
        pinLevels: preset.pinLevels,
      }),
      presetUsed: presetName,
    };
  }

  const analysis = analyzePrompt(prompt);
  const peripheralIds = options.peripherals?.filter((id) => Boolean(getPeripheral(id))) ?? analysis.peripheralIds;
  const boardId =
    options.preferBoard && getBoard(options.preferBoard)
      ? options.preferBoard
      : analysis.boardId;

  const result = buildCircuitFromPlan({
    boardId,
    peripheralIds: peripheralIds.length > 0 ? peripheralIds : ["ssd1306"],
  });

  return { ...result, presetUsed: presetName ?? undefined };
}
