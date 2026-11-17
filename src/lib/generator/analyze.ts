import {
  BOARDS,
  getBoard,
  getPeripheral,
  pinSupportsRequirement,
  selectPowerPinForPeripheral,
} from "../hardware/index";
import { PRESETS, detectPreset } from "./presets";

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
