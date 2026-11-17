import { BOARDS } from "./boards";
import { powerPinVoltage } from "./capabilities";
import { PERIPHERALS } from "./peripherals";
import type {
  Board,
  CircuitState,
  ComponentInstance,
  Diagnostic,
  DiagnosticSeverity,
  Peripheral,
  PeripheralPinRequirement,
  Pin,
  ResolvedPin,
} from "./types";

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
