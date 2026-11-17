import type { CircuitFault } from "../hardware/index";

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

export { PRESETS };
