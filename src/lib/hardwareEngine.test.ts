import { describe, expect, it } from "vitest";
import {
  BOARDS,
  autoFixCircuit,
  findCompatiblePin,
  lintCircuit,
  normalizeCircuitState,
  parseCircuitState,
  scoreDiagnostics,
  type CircuitState,
} from "./hardwareEngine";

function boardAndPeripheral(): CircuitState {
  return {
    components: [
      { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
      { id: "sensor", kind: "peripheral", refId: "hcsr04" },
    ],
    wires: [
      { id: "w1", from: { componentId: "mcu", pinId: "GPIO16" }, to: { componentId: "sensor", pinId: "ECHO" } },
    ],
  };
}

describe("normalizeCircuitState", () => {
  it("rejects values that cannot represent a circuit", () => {
    expect(normalizeCircuitState(null)).toBeNull();
    expect(normalizeCircuitState([])).toBeNull();
    expect(normalizeCircuitState({})).toBeNull();
    expect(normalizeCircuitState({ components: [] })).toBeNull();
    expect(parseCircuitState("[]")).toBeNull();
    expect(parseCircuitState("not json")).toBeNull();
  });

  it("fills in missing arrays so legacy rows cannot crash the linter", () => {
    const state = normalizeCircuitState({
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
    });
    expect(state).not.toBeNull();
    expect(state?.components).toHaveLength(1);
    expect(state?.wires).toEqual([]);
  });

  it("drops wires that reference unknown components and duplicate ids", () => {
    const state = normalizeCircuitState({
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "mcu", kind: "board", refId: "arduino_uno_r3" },
        { id: "sensor", kind: "peripheral", refId: "dht22" },
      ],
      wires: [
        { id: "dup", from: { componentId: "mcu", pinId: "GPIO4" }, to: { componentId: "sensor", pinId: "DATA" } },
        { id: "dup", from: { componentId: "mcu", pinId: "GPIO5" }, to: { componentId: "sensor", pinId: "DATA" } },
        { id: "gone", from: { componentId: "ghost", pinId: "X" }, to: { componentId: "sensor", pinId: "DATA" } },
        { id: "empty", from: { componentId: "mcu", pinId: "" }, to: { componentId: "sensor", pinId: "DATA" } },
      ],
    });
    expect(state?.components).toHaveLength(2);
    expect(state?.components[0].refId).toBe("esp32_devkit_v1");
    expect(state?.wires).toHaveLength(2);
    expect(new Set(state?.wires.map((wire) => wire.id)).size).toBe(2);
  });

  it("keeps only well-formed faults and pin states", () => {
    const state = normalizeCircuitState({
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [],
      pinStates: [
        { componentId: "mcu", pinId: "GPIO4", direction: "output", level: "HIGH" },
        { componentId: "mcu", pinId: "GPIO4", direction: "input", level: "LOW" },
        { componentId: "ghost", pinId: "GPIO5", direction: "output" },
        { componentId: "mcu", pinId: "GPIO6", direction: "sideways" },
      ],
      faults: [
        { id: "f1", type: "open", componentId: "mcu", pinId: "GPIO4", note: "cut" },
        { id: "f2", type: "nonsense" },
      ],
    });
    expect(state?.pinStates).toEqual([
      { componentId: "mcu", pinId: "GPIO4", direction: "output", level: "HIGH" },
      { componentId: "mcu", pinId: "GPIO6", direction: undefined, level: undefined },
    ]);
    expect(state?.faults).toEqual([
      { id: "f1", type: "open", componentId: "mcu", pinId: "GPIO4", note: "cut" },
    ]);
  });
});

describe("scoreDiagnostics", () => {
  it("weights severities and clamps to 0-100", () => {
    expect(scoreDiagnostics([])).toBe(100);
    expect(scoreDiagnostics([{ severity: "CRITICAL" }])).toBe(75);
    expect(scoreDiagnostics([{ severity: "WARNING" }])).toBe(90);
    expect(scoreDiagnostics([{ severity: "INFO" }])).toBe(97);
    expect(
      scoreDiagnostics(
        Array.from({ length: 10 }, () => ({ severity: "CRITICAL" as const })),
      ),
    ).toBe(0);
  });
});

describe("findCompatiblePin", () => {
  it("avoids the default UART console pins for normal signals", () => {
    const uno = BOARDS.arduino_uno_r3;
    const pin = findCompatiblePin(uno, { name: "IN", type: "digital-out" }, new Set());
    expect(pin).not.toBeNull();
    expect(pin?.id).not.toBe("D0");
    expect(pin?.id).not.toBe("D1");

    const everythingElse = uno.pins
      .filter((candidate) => candidate.id !== "D0" && candidate.id !== "D1")
      .map((candidate) => candidate.id);
    expect(
      findCompatiblePin(uno, { name: "IN", type: "digital-out" }, new Set(everythingElse)),
    ).toBeNull();
  });

  it("avoids ESP32 flash-connected and input-only pins", () => {
    const esp32 = BOARDS.esp32_devkit_v1;
    const pin = findCompatiblePin(esp32, { name: "DIN", type: "digital-out" }, new Set());
    expect(pin).not.toBeNull();
    expect(pin?.isFlashConnected).toBeFalsy();
    expect(pin?.isInputOnly).toBeFalsy();
  });
});

describe("lintCircuit", () => {
  it("flags ESP32 strapping GPIO12 HIGH as CRITICAL boot hazard", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [],
      pinStates: [{ componentId: "mcu", pinId: "GPIO12", direction: "output", level: "HIGH" }],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.severity === "CRITICAL" && d.code === "ESP32_STRAPPING_GPIO12_HIGH")).toBe(true);
  });

  it("flags HC-SR04 ECHO on ESP32 as CRITICAL voltage mismatch", () => {
    const diags = lintCircuit(boardAndPeripheral());
    expect(
      diags.some(
        (d) => d.severity === "CRITICAL" && d.code === "VOLTAGE_DOMAIN_MISMATCH" && /ECHO/i.test(d.message),
      ),
    ).toBe(true);
  });

  it("flags I2C address collision as CRITICAL", () => {
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
    expect(diags.some((d) => d.severity === "CRITICAL" && d.code === "I2C_ADDRESS_COLLISION")).toBe(true);
  });

  it("flags ESP32 input-only pin used as output", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [],
      pinStates: [{ componentId: "mcu", pinId: "GPIO34", direction: "output", level: "HIGH" }],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.severity === "CRITICAL" && d.code === "INPUT_ONLY_PIN_AS_OUTPUT")).toBe(true);
  });

  it("flags current budget exceeded on 3.3V rail as WARNING", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "arduino_uno_r3" },
        { id: "imu", kind: "peripheral", refId: "mpu6050" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
        { id: "dht", kind: "peripheral", refId: "dht22" },
        { id: "relay", kind: "peripheral", refId: "relay_5v_module" },
      ],
      wires: [
        { id: "p1", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "imu", pinId: "VCC" } },
        { id: "p2", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
        { id: "p3", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "dht", pinId: "VCC" } },
        { id: "p4", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "relay", pinId: "VCC" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.severity === "WARNING" && d.code === "CURRENT_BUDGET_EXCEEDED")).toBe(true);
  });

  it("flags a 5V-only module powered from a 3.3V rail", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "relay", kind: "peripheral", refId: "relay_5v_module" },
      ],
      wires: [
        { id: "vcc", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "relay", pinId: "VCC" } },
        { id: "gnd", from: { componentId: "mcu", pinId: "GND1" }, to: { componentId: "relay", pinId: "GND" } },
        { id: "in", from: { componentId: "mcu", pinId: "GPIO4" }, to: { componentId: "relay", pinId: "IN" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.code === "POWER_RAIL_MISMATCH")).toBe(true);
  });

  it("flags wiring a peripheral onto the hardware UART console pin", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "arduino_uno_r3" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
      ],
      wires: [
        { id: "sda", from: { componentId: "mcu", pinId: "D0" }, to: { componentId: "oled", pinId: "SDA" } },
        { id: "scl", from: { componentId: "mcu", pinId: "A5" }, to: { componentId: "oled", pinId: "SCL" } },
        { id: "vcc", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
        { id: "gnd", from: { componentId: "mcu", pinId: "GND1" }, to: { componentId: "oled", pinId: "GND" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.severity === "WARNING" && d.code === "UART_PIN_CONFLICT")).toBe(true);
  });

  it("flags unconnected required peripheral pins", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
      ],
      wires: [],
    };
    const diags = lintCircuit(state);
    expect(diags.filter((d) => d.code === "UNCONNECTED_PERIPHERAL_PIN")).toHaveLength(4);
  });

  it("flags dangling wires instead of crashing", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [
        { id: "bad", from: { componentId: "mcu", pinId: "GPIO999" }, to: { componentId: "ghost", pinId: "X" } },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.filter((d) => d.code === "INVALID_CONNECTION").length).toBeGreaterThanOrEqual(2);
  });

  it("turns injected faults into diagnostics", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
      ],
      wires: [],
      faults: [
        { id: "f1", type: "open", componentId: "oled", pinId: "SDA" },
        { id: "f2", type: "floating", componentId: "oled", pinId: "SCL" },
        { id: "f3", type: "brownout", rail: "3.3V" },
      ],
    };
    const diags = lintCircuit(state);
    expect(diags.some((d) => d.code === "FAULT_OPEN_CIRCUIT")).toBe(true);
    expect(diags.some((d) => d.code === "FAULT_FLOATING_PIN")).toBe(true);
    expect(diags.some((d) => d.code === "FAULT_POWER_BROWNOUT")).toBe(true);
  });
});

describe("autoFixCircuit", () => {
  it("moves a 5V relay off the 3.3V rail", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "relay", kind: "peripheral", refId: "relay_5v_module" },
      ],
      wires: [
        { id: "vcc", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "relay", pinId: "VCC" } },
        { id: "gnd", from: { componentId: "mcu", pinId: "GND1" }, to: { componentId: "relay", pinId: "GND" } },
        { id: "in", from: { componentId: "mcu", pinId: "GPIO4" }, to: { componentId: "relay", pinId: "IN" } },
      ],
    };
    const result = autoFixCircuit(state);
    expect(result.changes.some((change) => change.code === "POWER_RAIL_MISMATCH")).toBe(true);
    const powerWire = result.state.wires.find(
      (wire) =>
        (wire.from.componentId === "relay" && wire.from.pinId === "VCC") ||
        (wire.to.componentId === "relay" && wire.to.pinId === "VCC"),
    );
    expect(powerWire).toBeDefined();
    const boardEnd =
      powerWire!.from.componentId === "mcu" ? powerWire!.from : powerWire!.to;
    expect(boardEnd.pinId).not.toBe("3V3");
    expect(lintCircuit(result.state).some((d) => d.code === "POWER_RAIL_MISMATCH")).toBe(false);
  });

  it("reroutes an input-only pin driven as an output", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "relay", kind: "peripheral", refId: "relay_5v_module" },
      ],
      wires: [
        { id: "vcc", from: { componentId: "mcu", pinId: "VIN" }, to: { componentId: "relay", pinId: "VCC" } },
        { id: "gnd", from: { componentId: "mcu", pinId: "GND1" }, to: { componentId: "relay", pinId: "GND" } },
        { id: "in", from: { componentId: "mcu", pinId: "GPIO34" }, to: { componentId: "relay", pinId: "IN" } },
      ],
      pinStates: [{ componentId: "mcu", pinId: "GPIO34", direction: "output", level: "HIGH" }],
    };
    const result = autoFixCircuit(state);
    expect(result.changes.some((change) => change.code === "INPUT_ONLY_PIN_AS_OUTPUT")).toBe(true);
    expect(lintCircuit(result.state).some((d) => d.code === "INPUT_ONLY_PIN_AS_OUTPUT")).toBe(false);
  });

  it("connects missing required peripheral pins", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
      ],
      wires: [
        { id: "vcc", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
      ],
    };
    const result = autoFixCircuit(state);
    expect(
      result.changes.filter((change) => change.code === "UNCONNECTED_PERIPHERAL_PIN"),
    ).toHaveLength(3);
    expect(lintCircuit(result.state).some((d) => d.code === "UNCONNECTED_PERIPHERAL_PIN")).toBe(false);
  });

  it("removes the external pull-up holding GPIO12 HIGH", () => {
    const state: CircuitState = {
      components: [{ id: "mcu", kind: "board", refId: "esp32_devkit_v1" }],
      wires: [
        { id: "pullup", from: { componentId: "mcu", pinId: "GPIO12" }, to: { componentId: "mcu", pinId: "3V3" } },
      ],
      pinStates: [{ componentId: "mcu", pinId: "GPIO12", direction: "output", level: "HIGH" }],
    };
    const result = autoFixCircuit(state);
    expect(result.changes.some((change) => change.code === "ESP32_STRAPPING_GPIO12_HIGH")).toBe(true);
    expect(
      lintCircuit(result.state).some((d) => d.code === "ESP32_STRAPPING_GPIO12_HIGH"),
    ).toBe(false);
    expect(
      result.state.pinStates?.find((pinState) => pinState.pinId === "GPIO12")?.level,
    ).toBe("LOW");
  });

  it("does nothing to a clean circuit", () => {
    const state: CircuitState = {
      components: [
        { id: "mcu", kind: "board", refId: "esp32_devkit_v1" },
        { id: "oled", kind: "peripheral", refId: "ssd1306" },
      ],
      wires: [
        { id: "vcc", from: { componentId: "mcu", pinId: "3V3" }, to: { componentId: "oled", pinId: "VCC" } },
        { id: "gnd", from: { componentId: "mcu", pinId: "GND1" }, to: { componentId: "oled", pinId: "GND" } },
        { id: "sda", from: { componentId: "mcu", pinId: "GPIO21" }, to: { componentId: "oled", pinId: "SDA" } },
        { id: "scl", from: { componentId: "mcu", pinId: "GPIO22" }, to: { componentId: "oled", pinId: "SCL" } },
      ],
    };
    const result = autoFixCircuit(state);
    expect(result.changes).toHaveLength(0);
    expect(lintCircuit(result.state)).toHaveLength(0);
  });
});
