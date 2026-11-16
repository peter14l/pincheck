import { describe, it, expect } from "vitest";
import { lintCircuit, CircuitState } from "./hardwareEngine";

describe("lintCircuit", () => {
  it("flags ESP32 strapping GPIO12 HIGH as CRITICAL boot hazard", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [],
      pinStates: [{ componentId: "mcu", pinId: "GPIO12", direction: "output", level: "HIGH" }],
    };
    const diags = lintCircuit(state);
    expect(diags.some(d => d.severity === "CRITICAL" && d.code === "ESP32_STRAPPING_GPIO12_HIGH")).toBe(true);
  });

  it("flags HC-SR04 ECHO on ESP32 as CRITICAL voltage mismatch", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "sensor", kind: "peripheral", refId: "hcsr04" },
      ],
      wires: [
        { id: "w1", from: { componentId: "mcu", pinId: "GPIO16" }, to: { componentId: "sensor", pinId: "ECHO" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some(d => d.severity === "CRITICAL" && d.code === "VOLTAGE_DOMAIN_MISMATCH" && /ECHO/i.test(d.message))).toBe(true);
  });

  it("flags I2C address collision as CRITICAL/error condition", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "imu1", kind: "peripheral", refId: "mpu6050" },
        { id: "imu2", kind: "peripheral", refId: "mpu6050" },
      ],
      wires: [
        { id: "sda1", from: { componentId: "mcu", pinId: "GPIO21" }, to: { componentId: "imu1", pinId: "SDA" } },
        { id: "scl1", from: { componentId: "mcu", pinId: "GPIO22" }, to: { componentId: "imu1", pinId: "SCL" } },
        { id: "sda2", from: { componentId: "mcu", pinId: "GPIO21" }, to: { componentId: "imu2", pinId: "SDA" } },
        { id: "scl2", from: { componentId: "mcu", pinId: "GPIO22" }, to: { componentId: "imu2", pinId: "SCL" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some(d => d.severity === "CRITICAL" && d.code === "I2C_ADDRESS_COLLISION")).toBe(true);
  });

  it("flags ESP32 input-only pin used as output as ERROR/CRITICAL", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [],
      pinStates: [{ componentId: "mcu", pinId: "GPIO34", direction: "output", level: "HIGH" }],
    };
    const diags = lintCircuit(state);
    expect(diags.some(d => d.severity === "CRITICAL" && d.code === "INPUT_ONLY_PIN_AS_OUTPUT")).toBe(true);
  });

  it("flags current budget exceeded on 3.3V rail as WARNING", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "arduino_uno_r3" }, // 3.3V rail 50mA
        { id: "imu", kind: "peripheral", refId: "mpu6050" }, // 4mA
        { id: "oled", kind: "peripheral", refId: "ssd1306" }, // 20mA
        { id: "dht", kind: "peripheral", refId: "dht22" }, // 2.5mA
        { id: "relay", kind: "peripheral", refId: "relay_5v_module" }, // 70mA drawn from VCC pin
      ],
      wires: [
        { id: "p1", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "imu", pinId: "VCC" } },
        { id: "p2", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
        { id: "p3", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "dht", pinId: "VCC" } },
        { id: "p4", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "relay", pinId: "VCC" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some(d => d.severity === "WARNING" && d.code === "CURRENT_BUDGET_EXCEEDED")).toBe(true);
  });
});
