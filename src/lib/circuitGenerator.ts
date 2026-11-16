import {
  Board,
  Peripheral,
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
} from "./hardwareEngine";

export interface GenerationOptions {
  useAI?: boolean;
  apiKey?: string;
  provider?: "openai" | "gemini";
  preferBoard?: string;
}

export interface CircuitGenerationResult {
  circuitState: CircuitState;
  boardId: string;
  explanation: string;
  diagnostics: ReturnType<typeof lintCircuit>;
  healthScore: number;
  presetUsed?: string;
}

type RawPinAssignment = {
  peripheral: Peripheral | undefined;
  req: PeripheralPinRequirement | undefined;
  pin: Pin | undefined;
};
type PinAssignment = {
  peripheral: Peripheral;
  req: PeripheralPinRequirement;
  pin: Pin;
};

const BOARD_KEYWORDS: Record<string, string[]> = {
  esp32_devkit_v1: [
    "esp32",
    "esp-32",
    "espressif",
    "devkit",
    "weather station",
    "bme",
    "bme280",
    "oled",
    "ssd1306",
    "dht",
    "dht22",
    "relay",
    "neopixel",
    "ws2812",
    "mpu",
    "mpu6050",
  ],
  arduino_uno_r3: [
    "arduino",
    "uno",
    "atmega",
    "obstacle robot",
    "hc-sr04",
    "hcsr04",
    "servo",
    "sg90",
    "ultrasonic",
  ],
  rpi_pico: [
    "pico",
    "rp2040",
    "raspberry pi pico",
    "pi pico",
  ],
};

const PERIPHERAL_KEYWORDS: Record<string, string[]> = {
  ssd1306: ["oled", "ssd1306", "display", "screen", "128x64"],
  bme280: ["bme280", "bme", "pressure", "temperature humidity pressure", "weather"],
  dht22: ["dht22", "dht", "temperature humidity", "humidity temperature"],
  hcsr04: ["hc-sr04", "hcsr04", "ultrasonic", "distance sensor", "obstacle"],
  sg90: ["servo", "sg90", "micro servo", "hobby servo"],
  relay_5v_module: ["relay", "5v relay", "relay module"],
  ws2812b_8: ["neopixel", "ws2812", "ws2812b", "addressable led", "rgb led strip"],
  mpu6050: ["mpu6050", "mpu", "imu", "accelerometer", "gyro"],
};

const PRESETS: Record<string, { boardId: string; peripherals: string[]; description: string }> = {
  "ESP32 Weather Station with OLED & BME280": {
    boardId: "esp32_devkit_v1",
    peripherals: ["ssd1306", "bme280"],
    description: "ESP32 DevKit V1 with SSD1306 OLED and BME280 sensor for weather monitoring",
  },
  "Arduino Obstacle Robot with HC-SR04 & Servo": {
    boardId: "arduino_uno_r3",
    peripherals: ["hcsr04", "sg90"],
    description: "Arduino Uno R3 with HC-SR04 ultrasonic sensor and SG90 servo for obstacle avoidance",
  },
  "Deliberate Buggy Circuit Demo": {
    boardId: "esp32_devkit_v1",
    peripherals: ["ssd1306", "relay_5v_module", "ws2812b_8"],
    description: "ESP32 with multiple peripherals demonstrating voltage domain and current budget issues",
  },
};

function scoreBoardForPeripherals(boardId: string, peripheralIds: string[]): number {
  const board = getBoard(boardId);
  if (!board) return -Infinity;

  let score = 0;
  for (const pid of peripheralIds) {
    const peripheral = getPeripheral(pid);
    if (!peripheral) continue;

    for (const req of peripheral.pinRequirements) {
      const hasCompatiblePin = board.pins.some((pin) => {
        if (req.type === "power") return pin.modes.includes("power");
        if (req.type === "gnd") return pin.modes.includes("gnd");
        if (req.type === "i2c-sda") return pin.modes.includes("i2c-sda");
        if (req.type === "i2c-scl") return pin.modes.includes("i2c-scl");
        if (req.type === "pwm") return pin.modes.includes("pwm");
        if (req.type === "analog") return pin.modes.includes("analog");
        if (req.type === "digital-in" || req.type === "digital-out" || req.type === "digital-bidir")
          return pin.modes.includes("gpio");
        if (req.type === "uart-tx" || req.type === "uart-rx") return pin.modes.includes("uart");
        return false;
      });
      if (hasCompatiblePin) score += 10;
      else score -= 50;
    }

    const reqVoltage = Math.max(...peripheral.pinRequirements.filter((p) => p.voltage).map((p) => p.voltage ?? 0));
    if (reqVoltage > board.logicVoltage && !board.logicVoltageTolerant5V) score -= 20;
  }

  return score;
}

function selectBestBoard(peripheralIds: string[], preferBoard?: string): string {
  if (preferBoard && getBoard(preferBoard)) return preferBoard;

  const scores = Object.keys(BOARDS).map((id) => ({
    id,
    score: scoreBoardForPeripherals(id, peripheralIds),
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.id ?? "esp32_devkit_v1";
}

function detectBoardFromPrompt(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [boardId, keywords] of Object.entries(BOARD_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        scores[boardId] = (scores[boardId] ?? 0) + 1;
      }
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

function detectPeripheralsFromPrompt(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const detected: string[] = [];

  for (const [peripheralId, keywords] of Object.entries(PERIPHERAL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        detected.push(peripheralId);
        break;
      }
    }
  }

  return detected;
}

function detectPreset(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  for (const [name] of Object.entries(PRESETS)) {
    const presetKeywords = name.toLowerCase().split(/\s+/);
    let matches = 0;
    for (const kw of presetKeywords) {
      if (kw.length > 2 && lower.includes(kw)) matches++;
    }
    if (matches >= 3) return name;
  }
  return null;
}

function findCompatiblePin(board: Board, req: Peripheral["pinRequirements"][0], usedPins: Set<string>): Pin | null {
  const candidates = board.pins.filter((pin) => {
    if (usedPins.has(pin.id)) return false;
    if (req.type === "power") return pin.modes.includes("power");
    if (req.type === "gnd") return pin.modes.includes("gnd");
    if (req.type === "i2c-sda") return pin.modes.includes("i2c-sda");
    if (req.type === "i2c-scl") return pin.modes.includes("i2c-scl");
    if (req.type === "pwm") return pin.modes.includes("pwm") && !pin.isInputOnly;
    if (req.type === "analog") return pin.modes.includes("analog");
    if (req.type === "digital-in" || req.type === "digital-out" || req.type === "digital-bidir")
      return pin.modes.includes("gpio") && !pin.isInputOnly && !pin.isStrapping && !pin.isFlashConnected;
    if (req.type === "uart-tx" || req.type === "uart-rx") return pin.modes.includes("uart") && !pin.isInputOnly;
    return false;
  });

  if (candidates.length === 0) return null;

  const nonStrapping = candidates.filter((p) => !p.isStrapping && !p.isFlashConnected);
  return nonStrapping.length > 0 ? nonStrapping[0] : candidates[0];
}

function generatePinAssignmentExplanation(
  board: Board,
  assignments: Array<{ peripheral: Peripheral; pin: Pin; req: Peripheral["pinRequirements"][0] }>
): string {
  const lines: string[] = [];
  lines.push(`Board: ${board.name} (${board.logicVoltage}V logic${board.logicVoltageTolerant5V ? ", 5V tolerant" : ", NOT 5V tolerant"})`);
  lines.push("");

  for (const { peripheral, pin, req } of assignments) {
    const reason: string[] = [];
    if (req.type === "power") reason.push(`${req.voltage ? req.voltage + "V" : "power"} supply rail`);
    else if (req.type === "gnd") reason.push("ground reference");
    else if (req.type === "i2c-sda") reason.push(`I²C SDA (address 0x${req.i2cAddress?.toString(16) ?? "?"})`);
    else if (req.type === "i2c-scl") reason.push(`I²C SCL (address 0x${req.i2cAddress?.toString(16) ?? "?"})`);
    else if (req.type === "pwm") reason.push("PWM output for servo/LED control");
    else if (req.type === "analog") reason.push("ADC input for analog sensor");
    else if (["digital-in", "digital-out", "digital-bidir"].includes(req.type))
      reason.push(`GPIO ${req.type.replace("digital-", "")}`);
    else if (req.type === "uart-tx" || req.type === "uart-rx") reason.push(`UART ${req.type === "uart-tx" ? "TX" : "RX"}`);

    const pinDetails = [];
    if (pin.isInputOnly) pinDetails.push("input-only");
    if (pin.isStrapping) pinDetails.push(`strapping (${pin.strappingCondition})`);
    if (pin.isFlashConnected) pinDetails.push("connected to internal flash");
    if (pin.isAdc2) pinDetails.push("ADC2 channel (WiFi conflict possible)");

    const pinInfo = pinDetails.length > 0 ? ` [${pinDetails.join(", ")}]` : "";
    lines.push(`• ${peripheral.name} → ${pin.label}${pinInfo}: ${reason.join(", ")}`);
  }

  return lines.join("\n");
}

function buildCircuitFromAssignments(
  board: Board,
  peripheralIds: string[],
  assignments: Array<{ peripheral: Peripheral; pin: Pin; req: Peripheral["pinRequirements"][0] }>
): CircuitState {
  const boardComponent: ComponentInstance = {
    id: "board_1",
    kind: "board",
    refId: board.id,
    label: board.name,
  };

  const peripheralComponents: ComponentInstance[] = peripheralIds.map((pid, idx) => ({
    id: `peripheral_${idx + 1}`,
    kind: "peripheral",
    refId: pid,
    label: PERIPHERALS[pid]?.name,
  }));

  const wires: Wire[] = [];
  let wireId = 1;

  for (let i = 0; i < peripheralIds.length; i++) {
    const peripheral = PERIPHERALS[peripheralIds[i]];
    if (!peripheral) continue;
    const compId = `peripheral_${i + 1}`;

    for (const req of peripheral.pinRequirements) {
      const assignment = assignments.find(
        (a) => a.peripheral.id === peripheral.id && a.req.name === req.name
      );
      if (!assignment) continue;

      if (req.type === "power") {
        const powerPin = board.pins.find((p) => p.modes.includes("power"));
        if (powerPin) {
          wires.push({
            id: `wire_${wireId++}`,
            from: { componentId: "board_1", pinId: powerPin.id },
            to: { componentId: compId, pinId: req.name },
          });
        }
      } else if (req.type === "gnd") {
        const gndPin = board.pins.find((p) => p.modes.includes("gnd"));
        if (gndPin) {
          wires.push({
            id: `wire_${wireId++}`,
            from: { componentId: "board_1", pinId: gndPin.id },
            to: { componentId: compId, pinId: req.name },
          });
        }
      } else {
        wires.push({
          id: `wire_${wireId++}`,
          from: { componentId: "board_1", pinId: assignment.pin.id },
          to: { componentId: compId, pinId: req.name },
        });
      }
    }
  }

  const pinStates = assignments.map((a) => ({
    componentId: "board_1",
    pinId: a.pin.id,
    direction: (["digital-out", "pwm", "uart-tx", "i2c-sda", "i2c-scl"].includes(a.req.type)
      ? "output"
      : ["digital-in", "i2c-sda", "i2c-scl", "analog", "uart-rx"].includes(a.req.type)
      ? "input"
      : "bidirectional") as "input" | "output" | "bidirectional",
    level: "FLOATING" as const,
  }));

  return {
    components: [boardComponent, ...peripheralComponents],
    wires,
    pinStates,
  };
}

async function tryAIGeneration(
  prompt: string,
  options: GenerationOptions
): Promise<CircuitGenerationResult | null> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  const provider = options.provider ?? (process.env.OPENAI_API_KEY ? "openai" : "gemini");

  if (!apiKey) return null;

  try {
    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a hardware circuit designer. Given a prompt, return a JSON object with:
- boardId: one of ${Object.keys(BOARDS).join(", ")}
- peripherals: array of peripheral IDs from ${Object.keys(PERIPHERALS).join(", ")}
- pinAssignments: array of {peripheralId, pinRequirementName, boardPinId}
- explanation: why these pins were chosen
Return only valid JSON.`,
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

      const data = await response.json();
      const content = JSON.parse(data.choices[0].message.content);

      const board = getBoard(content.boardId);
      if (!board) throw new Error("Invalid board from AI");

      const assignments: PinAssignment[] = content.pinAssignments
        .map((pa: { peripheralId: string; pinRequirementName: string; boardPinId: string }): RawPinAssignment => {
          const peripheral = getPeripheral(pa.peripheralId);
          const req = peripheral?.pinRequirements.find((r) => r.name === pa.pinRequirementName);
          const pin = board.pins.find((p) => p.id === pa.boardPinId);
          return { peripheral, req, pin };
        })
        .filter((a: RawPinAssignment): a is PinAssignment => Boolean(a.peripheral && a.req && a.pin));
      const circuitState = buildCircuitFromAssignments(board, content.peripherals, assignments);
      const diagnostics = lintCircuit(circuitState);
      const healthScore = calculateHealthScore(diagnostics);

      return {
        circuitState,
        boardId: board.id,
        explanation: content.explanation || generatePinAssignmentExplanation(board, assignments),
        diagnostics,
        healthScore,
      };
    } else if (provider === "gemini") {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `You are a hardware circuit designer. Given a prompt, return a JSON object with:
- boardId: one of ${Object.keys(BOARDS).join(", ")}
- peripherals: array of peripheral IDs from ${Object.keys(PERIPHERALS).join(", ")}
- pinAssignments: array of {peripheralId, pinRequirementName, boardPinId}
- explanation: why these pins were chosen
Return only valid JSON.
Prompt: ${prompt}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

      const data = await response.json();
      const content = JSON.parse(data.candidates[0].content.parts[0].text);

      const board = getBoard(content.boardId);
      if (!board) throw new Error("Invalid board from AI");

      const assignments: PinAssignment[] = content.pinAssignments
        .map((pa: { peripheralId: string; pinRequirementName: string; boardPinId: string }): RawPinAssignment => {
          const peripheral = getPeripheral(pa.peripheralId);
          const req = peripheral?.pinRequirements.find((r) => r.name === pa.pinRequirementName);
          const pin = board.pins.find((p) => p.id === pa.boardPinId);
          return { peripheral, req, pin };
        })
        .filter((a: RawPinAssignment): a is PinAssignment => Boolean(a.peripheral && a.req && a.pin));

      const circuitState = buildCircuitFromAssignments(board, content.peripherals, assignments);
      const diagnostics = lintCircuit(circuitState);
      const healthScore = calculateHealthScore(diagnostics);

      return {
        circuitState,
        boardId: board.id,
        explanation: content.explanation || generatePinAssignmentExplanation(board, assignments),
        diagnostics,
        healthScore,
      };
    }
  } catch (error) {
    console.warn("AI generation failed, falling back to deterministic parser:", error);
  }

  return null;
}

function calculateHealthScore(diagnostics: ReturnType<typeof lintCircuit>): number {
  let score = 100;
  for (const d of diagnostics) {
    if (d.severity === "CRITICAL") score -= 25;
    else if (d.severity === "WARNING") score -= 10;
    else if (d.severity === "INFO") score -= 3;
  }
  return Math.max(0, score);
}

export async function generateCircuitFromPrompt(
  prompt: string,
  options: GenerationOptions = {}
): Promise<CircuitGenerationResult> {
  const presetName = detectPreset(prompt);
  let peripheralIds: string[];
  let boardId: string;

  if (presetName) {
    const preset = PRESETS[presetName];
    peripheralIds = preset.peripherals;
    boardId = preset.boardId;
  } else {
    peripheralIds = detectPeripheralsFromPrompt(prompt);
    const detectedBoard = detectBoardFromPrompt(prompt);
    boardId = selectBestBoard(peripheralIds, options.preferBoard ?? detectedBoard ?? undefined);
  }

  if (peripheralIds.length === 0) {
    peripheralIds = ["ssd1306"];
  }

  const board = getBoard(boardId);
  if (!board) {
    throw new Error(`Board ${boardId} not found`);
  }

  const usedPins = new Set<string>();
  const assignments: Array<{ peripheral: Peripheral; pin: Pin; req: Peripheral["pinRequirements"][0] }> = [];

  for (const pid of peripheralIds) {
    const peripheral = getPeripheral(pid);
    if (!peripheral) continue;

    for (const req of peripheral.pinRequirements) {
      const pin = findCompatiblePin(board, req, usedPins);
      if (pin) {
        usedPins.add(pin.id);
        assignments.push({ peripheral, pin, req });
      } else {
        const fallbackPin = board.pins.find((p) => !usedPins.has(p.id) && p.modes.includes("gpio") && !p.isInputOnly && !p.isStrapping && !p.isFlashConnected);
        if (fallbackPin) {
          usedPins.add(fallbackPin.id);
          assignments.push({ peripheral, pin: fallbackPin, req });
        }
      }
    }
  }

  const circuitState = buildCircuitFromAssignments(board, peripheralIds, assignments);
  const diagnostics = lintCircuit(circuitState);
  const healthScore = calculateHealthScore(diagnostics);
  const explanation = generatePinAssignmentExplanation(board, assignments);

  if (options.useAI !== false) {
    const aiResult = await tryAIGeneration(prompt, options);
    if (aiResult) {
      return { ...aiResult, presetUsed: presetName ?? undefined };
    }
  }

  return {
    circuitState,
    boardId,
    explanation,
    diagnostics,
    healthScore,
    presetUsed: presetName ?? undefined,
  };
}

