import { describe, expect, it } from "vitest";
import { buildCircuitFromPlan, generateCircuitFromPrompt } from "./circuitGenerator";
import { generateFirmware } from "./firmwareGenerator";

describe("generateFirmware", () => {
  it("uses the Uno servo library and pulseIn for an Arduino obstacle robot", async () => {
    const result = await generateCircuitFromPrompt("Arduino Obstacle Robot with HC-SR04 & Servo");
    const code = generateFirmware(result.circuitState, result.boardId, "cpp");
    expect(code).toContain("#include <Servo.h>");
    expect(code).not.toContain("#include <ESP32Servo.h>");
    expect(code).toContain("pulseIn");
    expect(code).toContain("readDistanceCm");
  });

  it("uses ESP32Servo on the ESP32", () => {
    const result = buildCircuitFromPlan({
      boardId: "esp32_devkit_v1",
      peripheralIds: ["sg90"],
    });
    const code = generateFirmware(result.circuitState, result.boardId, "cpp");
    expect(code).toContain("#include <ESP32Servo.h>");
  });

  it("emits real MicroPython HC-SR04 timing calls", async () => {
    const result = await generateCircuitFromPrompt("ESP32 with HC-SR04 ultrasonic sensor");
    const code = generateFirmware(result.circuitState, result.boardId, "micropython");
    expect(code).toContain("import machine");
    expect(code).toContain("machine.time_pulse_us");
    expect(code).not.toContain("time_pins_us");
  });

  it("selects an I2C peripheral for the Pico", async () => {
    const result = await generateCircuitFromPrompt("Raspberry Pi Pico with OLED and MPU6050");
    const code = generateFirmware(result.circuitState, result.boardId, "micropython");
    expect(code).toContain("from machine import Pin, I2C, PWM");
    expect(code).toContain("i2c = I2C(");
    expect(code).toContain("freq=400000");
  });

  it("uses a 16-bit duty cycle for MicroPython servos", () => {
    const result = buildCircuitFromPlan({
      boardId: "esp32_devkit_v1",
      peripheralIds: ["sg90"],
    });
    const code = generateFirmware(result.circuitState, result.boardId, "micropython");
    expect(code).toContain("duty_u16(4915)");
  });

  it("prepends linter safety warnings to unsafe firmware", async () => {
    const result = await generateCircuitFromPrompt("Deliberate Buggy Circuit Demo");
    const cpp = generateFirmware(result.circuitState, result.boardId, "cpp");
    const mp = generateFirmware(result.circuitState, result.boardId, "micropython");
    expect(cpp).toContain("PINCHECK SAFETY WARNINGS");
    expect(cpp).toContain("//  [CRITICAL]");
    expect(mp).toContain("#  [CRITICAL]");
  });

  it("leaves safe firmware unheadered", async () => {
    const result = await generateCircuitFromPrompt("ESP32 Weather Station with OLED & BME280");
    const code = generateFirmware(result.circuitState, result.boardId, "cpp");
    expect(code).not.toContain("PINCHECK SAFETY WARNINGS");
  });

  it("falls back cleanly for an unknown board", () => {
    const code = generateFirmware(
      { components: [], wires: [] },
      "unknown_board",
      "cpp",
    );
    expect(code.length).toBeGreaterThan(0);
    expect(code).toContain("unknown_board");
  });
});
