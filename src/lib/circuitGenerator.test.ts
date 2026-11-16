import { describe, expect, it } from "vitest";
import {
  analyzePrompt,
  buildCircuitFromPlan,
  detectBoardFromPrompt,
  generateCircuitFromPrompt,
  getPresetNames,
} from "./circuitGenerator";
import { BOARDS, getPeripheral, lintCircuit, powerPinVoltage } from "./hardwareEngine";

function boardPinIdFor(
  state: { components: Array<{ id: string; kind: string }>; wires: Array<{ from: { componentId: string; pinId: string }; to: { componentId: string; pinId: string } }> },
  boardComponentId: string,
  peripheralComponentId: string,
  peripheralPin: string,
): string | undefined {
  const wire = state.wires.find(
    (entry) =>
      (entry.from.componentId === peripheralComponentId && entry.from.pinId === peripheralPin) ||
      (entry.to.componentId === peripheralComponentId && entry.to.pinId === peripheralPin),
  );
  if (!wire) return undefined;
  return wire.from.componentId === boardComponentId ? wire.from.pinId : wire.to.pinId;
}

describe("board detection", () => {
  it("honours an explicit board mention over peripheral keywords", () => {
    expect(detectBoardFromPrompt("ESP32 with HC-SR04 ultrasonic sensor")).toBe("esp32_devkit_v1");
    expect(detectBoardFromPrompt("Raspberry Pi Pico with OLED and MPU6050")).toBe("rpi_pico");
    expect(detectBoardFromPrompt("Arduino Uno with a servo")).toBe("arduino_uno_r3");
  });

  it("keeps the requested board even when a peripheral would fit elsewhere", () => {
    const analysis = analyzePrompt("Arduino Uno with OLED and MPU6050");
    expect(analysis.boardId).toBe("arduino_uno_r3");
    expect(analysis.peripheralIds).toEqual(["ssd1306", "mpu6050"]);
  });
});

describe("analyzePrompt", () => {
  it("recognises model names before generic words", () => {
    const analysis = analyzePrompt("ESP32 weather station with OLED and BME280");
    expect(analysis.boardId).toBe("esp32_devkit_v1");
    expect(analysis.peripheralIds).toEqual(expect.arrayContaining(["ssd1306", "bme280"]));
  });

  it("falls back to one display when no peripheral is recognised", () => {
    const analysis = analyzePrompt("ESP32");
    expect(analysis.peripheralIds).toEqual(["ssd1306"]);
  });
});

describe("buildCircuitFromPlan", () => {
  it("rejects unknown boards and unknown peripherals", () => {
    expect(() =>
      buildCircuitFromPlan({ boardId: "not-a-board", peripheralIds: ["ssd1306"] }),
    ).toThrow(/Unknown board/);
    expect(() =>
      buildCircuitFromPlan({ boardId: "esp32_devkit_v1", peripheralIds: ["not-a-peripheral"] }),
    ).toThrow(/at least one known peripheral/);
  });

  it("shares one I2C bus between multiple devices", () => {
    const result = buildCircuitFromPlan({
      boardId: "esp32_devkit_v1",
      peripheralIds: ["ssd1306", "bme280"],
    });
    const oled = result.circuitState.components.find((component) => component.refId === "ssd1306")!;
    const bme = result.circuitState.components.find((component) => component.refId === "bme280")!;
    const board = result.circuitState.components.find((component) => component.kind === "board")!;

    const oledSda = boardPinIdFor(result.circuitState, board.id, oled.id, "SDA");
    const bmeSda = boardPinIdFor(result.circuitState, board.id, bme.id, "SDA");
    const oledScl = boardPinIdFor(result.circuitState, board.id, oled.id, "SCL");
    const bmeScl = boardPinIdFor(result.circuitState, board.id, bme.id, "SCL");

    expect(oledSda).toBeDefined();
    expect(oledSda).toBe(bmeSda);
    expect(oledScl).toBeDefined();
    expect(oledScl).toBe(bmeScl);
    expect(oledSda).not.toBe(oledScl);
    expect(
      lintCircuit(result.circuitState).some((d) => d.code === "I2C_ADDRESS_COLLISION"),
    ).toBe(false);
  });

  it("powers 5V peripherals from the 5V rail", () => {
    const result = buildCircuitFromPlan({
      boardId: "arduino_uno_r3",
      peripheralIds: ["hcsr04", "sg90"],
    });
    const boardComponent = result.circuitState.components.find(
      (component) => component.kind === "board",
    )!;
    const board = BOARDS[boardComponent.refId];

    for (const peripheralId of ["hcsr04", "sg90"]) {
      const peripheralComponent = result.circuitState.components.find(
        (component) => component.refId === peripheralId,
      )!;
      const vccPinId = boardPinIdFor(
        result.circuitState,
        boardComponent.id,
        peripheralComponent.id,
        "VCC",
      );
      expect(vccPinId).toBeDefined();
      const pin = board.pins.find((candidate) => candidate.id === vccPinId);
      expect(pin).toBeDefined();
      expect(powerPinVoltage(board, pin!)).toBe(5);
      expect(getPeripheral(peripheralId)?.supplyVoltage).toBe(5);
    }
  });

  it("keeps signal wiring off the hardware UART console pins", () => {
    const result = buildCircuitFromPlan({
      boardId: "arduino_uno_r3",
      peripheralIds: ["hcsr04", "sg90"],
    });
    const boardComponent = result.circuitState.components.find(
      (component) => component.kind === "board",
    )!;
    const boardPins = result.circuitState.wires
      .filter((wire) => wire.from.componentId === boardComponent.id || wire.to.componentId === boardComponent.id)
      .map((wire) => (wire.from.componentId === boardComponent.id ? wire.from.pinId : wire.to.pinId));
    expect(boardPins).not.toContain("D0");
    expect(boardPins).not.toContain("D1");
  });

  it("applies plan overrides and pin levels", () => {
    const result = buildCircuitFromPlan({
      boardId: "esp32_devkit_v1",
      peripheralIds: ["relay_5v_module"],
      overrides: { "relay_5v_module:IN": "GPIO34" },
      pinLevels: [{ pinId: "GPIO34", level: "HIGH" }],
    });
    expect(
      result.circuitState.wires.some(
        (wire) => wire.from.pinId === "GPIO34" || wire.to.pinId === "GPIO34",
      ),
    ).toBe(true);
    expect(
      result.circuitState.pinStates?.some(
        (pinState) => pinState.pinId === "GPIO34" && pinState.level === "HIGH",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === "INPUT_ONLY_PIN_AS_OUTPUT"),
    ).toBe(true);
  });
});

describe("presets", () => {
  it("exposes the three demo presets", () => {
    expect(getPresetNames()).toEqual([
      "ESP32 Weather Station with OLED & BME280",
      "Arduino Obstacle Robot with HC-SR04 & Servo",
      "Deliberate Buggy Circuit Demo",
    ]);
  });

  it("generates a healthy ESP32 weather station", async () => {
    const result = await generateCircuitFromPrompt("ESP32 Weather Station with OLED & BME280");
    expect(result.presetUsed).toBe("ESP32 Weather Station with OLED & BME280");
    expect(result.boardId).toBe("esp32_devkit_v1");
    expect(
      result.circuitState.components.filter((component) => component.kind === "peripheral"),
    ).toHaveLength(2);
    expect(result.healthScore).toBe(100);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("generates a deliberately unsafe circuit for fault demos", async () => {
    const result = await generateCircuitFromPrompt("Deliberate Buggy Circuit Demo");
    expect(result.presetUsed).toBe("Deliberate Buggy Circuit Demo");
    expect(result.healthScore).toBeLessThanOrEqual(10);
    const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));
    expect(codes.has("INPUT_ONLY_PIN_AS_OUTPUT")).toBe(true);
    expect(codes.has("ESP32_FLASH_PIN_USED")).toBe(true);
    expect(codes.has("POWER_RAIL_MISMATCH")).toBe(true);
    expect(codes.has("FAULT_OPEN_CIRCUIT")).toBe(true);
    expect(codes.has("FAULT_POWER_BROWNOUT")).toBe(true);
    expect(codes.has("FAULT_FLOATING_PIN")).toBe(true);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "CRITICAL").length).toBeGreaterThanOrEqual(3);
  });
});
