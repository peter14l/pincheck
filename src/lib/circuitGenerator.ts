import {
  Board,
  CircuitState,
  Wire,
  ComponentInstance,
  Pin,
  BOARDS,
  PERIPHERALS,
  lintCircuit,
  getBoard,
  getPeripheral,
  PeripheralPinRequirement,
  CircuitFault,
  PinState,
  findCompatiblePin,
  pinSupportsRequirement,
  selectPowerPinForPeripheral,
  derivePinStates,
  scoreDiagnostics,
} from "./hardwareEngine";

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

type PeripheralKeyword = {
  specific: string[];
  generic: string[];
};

const PERIPHERAL_KEYWORDS: Record<string, PeripheralKeyword> = {
  ssd1306: {
    specific: ["ssd1306", "128x64", "oled"],
    generic: ["display", "screen"],
  },
  bme280: {
    specific: ["bme280", "bme"],
    generic: ["pressure", "weather station"],
  },
  dht22: {
    specific: ["dht22", "dht"],
    generic: ["humidity"],
  },
  hcsr04: {
    specific: ["hc-sr04", "hcsr04", "ultrasonic"],
    generic: ["distance sensor", "obstacle"],
  },
  sg90: {
    specific: ["sg90", "servo"],
    generic: ["hobby servo", "micro servo"],
  },
  relay_5v_module: {
    specific: ["relay"],
    generic: ["relay module"],
  },
  ws2812b_8: {
    specific: ["neopixel", "ws2812", "ws2812b"],
    generic: ["addressable led", "rgb led", "led strip"],
  },
  mpu6050: {
    specific: ["mpu6050", "mpu"],
    generic: ["imu", "accelerometer", "gyroscope", "gyro"],
  },
};

/**
 * Board names are deliberately separated from peripheral keywords. An explicit
 * board mention always wins; peripheral keywords must never outvote it.
 */
const BOARD_KEYWORDS: Array<{ id: string; keywords: string[] }> = [
  { id: "rpi_pico", keywords: ["raspberry pi pico", "pi pico", "rp2040", "pico"] },
  { id: "esp32_devkit_v1", keywords: ["esp32", "esp-32", "espressif", "devkit"] },
  { id: "arduino_uno_r3", keywords: ["arduino uno", "arduino", "uno r3", "uno", "atmega"] },
];

type Preset = {
  boardId: string;
  peripherals: string[];
  description: string;
  faults?: CircuitFault[];
  overrides?: Record<string, string>;
  pinLevels?: Array<{ pinId: string; level: "HIGH" | "LOW" | "FLOATING" }>;
};

const PRESETS: Record<string, Preset> = {
  "ESP32 Weather Station with OLED & BME280": {
    boardId: "esp32_devkit_v1",
    peripherals: ["ssd1306", "bme280"],
    description:
      "ESP32 DevKit V1 with an SSD1306 OLED and BME280 sensor sharing the I2C bus on GPIO21/GPIO22.",
  },
  "Arduino Obstacle Robot with HC-SR04 & Servo": {
    boardId: "arduino_uno_r3",
    peripherals: ["hcsr04", "sg90"],
    description:
      "Arduino Uno R3 with an HC-SR04 ultrasonic sensor and SG90 servo, using 5V logic and the 5V rail.",
  },
  "Deliberate Buggy Circuit Demo": {
    boardId: "esp32_devkit_v1",
    peripherals: ["ssd1306", "relay_5v_module", "ws2812b_8"],
    description:
      "ESP32 with deliberately unsafe wiring: GPIO34 driven as an output, flash pin GPIO6 used for LED data, a 5V relay on the 3.3V rail, plus injected open/brownout/floating faults.",
    overrides: {
      "relay_5v_module:IN": "GPIO34",
      "relay_5v_module:VCC": "3V3",
      "ws2812b_8:DIN": "GPIO6",
    },
    pinLevels: [{ pinId: "GPIO34", level: "HIGH" }],
    faults: [
      {
        id: "fault_open_relay",
        type: "open",
        componentId: "peripheral_2",
        pinId: "IN",
        note: "relay control wire is broken",
      },
      {
        id: "fault_brownout_5v",
        type: "brownout",
        rail: "5V",
        note: "USB supply sags under LED load",
      },
      {
        id: "fault_floating_sda",
        type: "floating",
        componentId: "peripheral_1",
        pinId: "SDA",
        note: "I2C SDA has no pull-up",
      },
    ],
  },
};

export function getPresetNames(): string[] {
  return Object.keys(PRESETS);
}

export function detectPreset(prompt: string): string | null {
  const lower = prompt.toLowerCase().trim();
  if (!lower) return null;
  for (const name of Object.keys(PRESETS)) {
    if (lower === name.toLowerCase()) return name;
  }
  for (const [name] of Object.entries(PRESETS)) {
    const words = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 2);
    const matches = words.filter((word) => lower.includes(word)).length;
    if (matches >= 3) return name;
  }
  return null;
}

export function detectBoardFromPrompt(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  for (const { id, keywords } of BOARD_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword))) return id;
  }
  return null;
}

export function detectPeripheralsFromPrompt(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const specific: string[] = [];
  const generic: string[] = [];

  for (const [id, keywords] of Object.entries(PERIPHERAL_KEYWORDS)) {
    if (keywords.specific.some((keyword) => lower.includes(keyword))) {
      specific.push(id);
    } else if (keywords.generic.some((keyword) => lower.includes(keyword))) {
      generic.push(id);
    }
  }

  // Model names win over broad words such as "humidity" or "display".
  const detected = specific.length > 0 ? specific : generic;
  return Array.from(new Set(detected));
}

function boardSupportsPeripherals(boardId: string, peripheralIds: string[]): number {
  const board = getBoard(boardId);
  if (!board) return Number.NEGATIVE_INFINITY;

  let score = 0;
  for (const peripheralId of peripheralIds) {
    const peripheral = getPeripheral(peripheralId);
    if (!peripheral) {
      score -= 100;
      continue;
    }
    for (const req of peripheral.pinRequirements) {
      if (board.pins.some((pin) => pinSupportsRequirement(pin, req))) score += 10;
      else score -= 50;
    }
    const min = peripheral.supplyVoltageMin ?? peripheral.supplyVoltage;
    const max = peripheral.supplyVoltageMax ?? peripheral.supplyVoltage;
    const powerPin = selectPowerPinForPeripheral(board, peripheral);
    if (powerPin && powerPin.voltage >= min - 0.01 && powerPin.voltage <= max + 0.01) {
      score += 5;
    } else {
      score -= 30;
    }
    const maxSignal = Math.max(
      0,
      ...peripheral.pinRequirements
        .filter((req) => req.voltage && req.type !== "power" && req.type !== "gnd")
        .map((req) => req.voltage ?? 0),
    );
    if (maxSignal > board.logicVoltage && !board.logicVoltageTolerant5V) score -= 20;
  }
  return score;
}

export function selectBestBoard(peripheralIds: string[], explicitBoardId?: string | null): string {
  if (explicitBoardId && getBoard(explicitBoardId)) return explicitBoardId;

  const ranked = Object.keys(BOARDS)
    .map((id) => ({ id, score: boardSupportsPeripherals(id, peripheralIds) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.id ?? "esp32_devkit_v1";
}

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

export interface PromptAnalysis {
  presetName: string | null;
  boardId: string;
  peripheralIds: string[];
}

export function analyzePrompt(prompt: string): PromptAnalysis {
  const presetName = detectPreset(prompt);
  if (presetName) {
    const preset = PRESETS[presetName];
    return {
      presetName,
      boardId: preset.boardId,
      peripheralIds: [...preset.peripherals],
    };
  }

  let peripheralIds = detectPeripheralsFromPrompt(prompt);
  if (peripheralIds.length === 0) peripheralIds = ["ssd1306"];

  const explicitBoard = detectBoardFromPrompt(prompt);
  return {
    presetName: null,
    boardId: selectBestBoard(peripheralIds, explicitBoard),
    peripheralIds,
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
