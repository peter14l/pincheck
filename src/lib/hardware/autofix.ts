import { BOARDS } from "./boards";
import {
  derivePinStates,
  findCompatiblePin,
  powerPinVoltage,
  selectPowerPinForPeripheral,
} from "./capabilities";
import { lintCircuit } from "./linter";
import { normalizeCircuitState } from "./normalize";
import { PERIPHERALS } from "./peripherals";
import type { AutoFixChange, AutoFixResult, CircuitState, Wire } from "./types";

/**
 * Deterministically repair the circuit issues that can be fixed by rewiring:
 * unsafe GPIO assignments, pin collisions, disconnected required pins and
 * power rails outside a peripheral's input range.
 */
export function autoFixCircuit(input: CircuitState): AutoFixResult {
  const normalized = normalizeCircuitState(input);
  if (!normalized) return { state: { components: [], wires: [] }, changes: [] };

  const state: CircuitState = {
    components: normalized.components.map((component) => ({ ...component })),
    wires: normalized.wires.map((wire) => ({
      id: wire.id,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    pinStates: (normalized.pinStates ?? []).map((pinState) => ({ ...pinState })),
    faults: (normalized.faults ?? []).map((fault) => ({ ...fault })),
  };
  const changes: AutoFixChange[] = [];
  const componentById = () => new Map(state.components.map((component) => [component.id, component]));
  const boardComponents = () => state.components.filter((component) => component.kind === "board");
  const boardFor = (componentId: string) => {
    const component = componentById().get(componentId);
    return component?.kind === "board" ? BOARDS[component.refId] : undefined;
  };
  const otherEnd = (wire: Wire, componentId: string) =>
    wire.from.componentId === componentId ? wire.to : wire.from;

  const usedBoardPins = (excludeWireId?: string) => {
    const used = new Set<string>();
    for (const wire of state.wires) {
      if (wire.id === excludeWireId) continue;
      for (const end of [wire.from, wire.to]) {
        if (componentById().get(end.componentId)?.kind === "board") {
          used.add(end.pinId);
        }
      }
    }
    return used;
  };

  // 1) Move power wires to a rail inside the peripheral's supply range.
  for (const component of state.components) {
    if (component.kind !== "peripheral") continue;
    const peripheral = PERIPHERALS[component.refId];
    if (!peripheral) continue;
    const powerReq = peripheral.pinRequirements.find((req) => req.type === "power");
    if (!powerReq) continue;
    const wire = state.wires.find(
      (entry) =>
        (entry.from.componentId === component.id && entry.from.pinId === powerReq.name) ||
        (entry.to.componentId === component.id && entry.to.pinId === powerReq.name),
    );
    if (!wire) continue;
    const boardEnd = otherEnd(wire, component.id);
    const board = boardFor(boardEnd.componentId);
    if (!board) continue;
    const currentPin = board.pins.find((candidate) => candidate.id === boardEnd.pinId);
    if (!currentPin) continue;
    const currentVoltage = powerPinVoltage(board, currentPin);
    if (currentVoltage === null) continue;
    const min = peripheral.supplyVoltageMin ?? peripheral.supplyVoltage;
    const max = peripheral.supplyVoltageMax ?? peripheral.supplyVoltage;
    if (currentVoltage >= min - 0.01 && currentVoltage <= max + 0.01) continue;

    const replacement = selectPowerPinForPeripheral(board, peripheral);
    if (!replacement || replacement.pin.id === currentPin.id) continue;
    if (
      replacement.voltage < min - 0.01 ||
      replacement.voltage > max + 0.01
    ) {
      continue;
    }
    boardEnd.pinId = replacement.pin.id;
    changes.push({
      code: "POWER_RAIL_MISMATCH",
      description: `Moved ${peripheral.name} VCC from ${currentPin.label} to ${replacement.pin.label}`,
    });
  }

  // 2) Reroute unsafe signal pins to a compatible free pin.
  const diagnostics = lintCircuit(state);
  const reroutable = new Set([
    "INPUT_ONLY_PIN_AS_OUTPUT",
    "ESP32_FLASH_PIN_USED",
    "ESP32_STRAPPING_PIN_DRIVEN",
    "PIN_COLLISION",
  ]);
  for (const diagnostic of diagnostics) {
    if (!reroutable.has(diagnostic.code)) continue;
    for (const pinId of diagnostic.pinIds ?? []) {
      const boardComponent = boardComponents().find((component) =>
        BOARDS[component.refId]?.pins.some((candidate) => candidate.id === pinId),
      );
      if (!boardComponent) continue;
      const board = BOARDS[boardComponent.refId];
      if (!board) continue;

      for (const wire of state.wires) {
        const boardEnd =
          wire.from.componentId === boardComponent.id && wire.from.pinId === pinId
            ? wire.from
            : wire.to.componentId === boardComponent.id && wire.to.pinId === pinId
              ? wire.to
              : null;
        if (!boardEnd) continue;
        const perEnd = otherEnd(wire, boardComponent.id);
        const perComponent = componentById().get(perEnd.componentId);
        if (perComponent?.kind !== "peripheral") continue;
        const peripheral = PERIPHERALS[perComponent.refId];
        const req = peripheral?.pinRequirements.find((entry) => entry.name === perEnd.pinId);
        if (!peripheral || !req || req.type === "power" || req.type === "gnd") continue;

        const replacement = findCompatiblePin(board, req, usedBoardPins(wire.id));
        if (!replacement || replacement.id === pinId) continue;
        boardEnd.pinId = replacement.id;
        state.pinStates = (state.pinStates ?? []).filter(
          (pinState) =>
            !(pinState.componentId === boardComponent.id && pinState.pinId === pinId),
        );
        changes.push({
          code: diagnostic.code,
          description: `Moved ${peripheral.name} ${req.name} from ${pinId} to ${replacement.label}`,
        });
      }
    }
  }

  // 3) Remove external pulls that hold GPIO12 HIGH at boot and lower its state.
  const strapping = diagnostics.find((diagnostic) => diagnostic.code === "ESP32_STRAPPING_GPIO12_HIGH");
  if (strapping) {
    const boardComponent = boardComponents().find((component) => BOARDS[component.refId]?.pins.some((candidate) => candidate.id === "GPIO12"));
    if (boardComponent) {
      const before = state.wires.length;
      state.wires = state.wires.filter((wire) => {
        const involvesGpio12 =
          (wire.from.componentId === boardComponent.id && wire.from.pinId === "GPIO12") ||
          (wire.to.componentId === boardComponent.id && wire.to.pinId === "GPIO12");
        if (!involvesGpio12) return true;
        const other = otherEnd(wire, boardComponent.id);
        const otherPin = boardFor(other.componentId)?.pins.find((candidate) => candidate.id === other.pinId);
        return !(otherPin && (otherPin.modes.includes("power") || otherPin.modes.includes("gnd")));
      });
      const removed = before - state.wires.length;
      const pinState = state.pinStates?.find(
        (entry) => entry.componentId === boardComponent.id && entry.pinId === "GPIO12",
      );
      if (pinState) pinState.level = "LOW";
      else {
        state.pinStates = [
          ...(state.pinStates ?? []),
          { componentId: boardComponent.id, pinId: "GPIO12", direction: "output", level: "LOW" },
        ];
      }
      changes.push({
        code: "ESP32_STRAPPING_GPIO12_HIGH",
        description: `Removed ${removed} external pull-up wire(s) from GPIO12 and set it LOW at boot`,
      });
    }
  }

  // 4) Wire up required peripheral pins that are still disconnected.
  for (const component of state.components) {
    if (component.kind !== "peripheral") continue;
    const peripheral = PERIPHERALS[component.refId];
    if (!peripheral) continue;
    const boardComponent = boardComponents()[0];
    const board = boardComponent ? BOARDS[boardComponent.refId] : undefined;
    if (!boardComponent || !board) continue;

    for (const req of peripheral.pinRequirements) {
      const connected = state.wires.some(
        (wire) =>
          (wire.from.componentId === component.id && wire.from.pinId === req.name) ||
          (wire.to.componentId === component.id && wire.to.pinId === req.name),
      );
      if (connected) continue;

      const pin =
        req.type === "power"
          ? selectPowerPinForPeripheral(board, peripheral)?.pin
          : req.type === "gnd"
            ? board.pins.find((candidate) => candidate.modes.includes("gnd"))
            : findCompatiblePin(board, req, usedBoardPins());
      if (!pin) continue;

      const wire: Wire = {
        id: `fix_${state.wires.length + 1}_${req.name}`,
        from: { componentId: boardComponent.id, pinId: pin.id },
        to: { componentId: component.id, pinId: req.name },
      };
      while (state.wires.some((entry) => entry.id === wire.id)) wire.id = `${wire.id}_x`;
      state.wires.push(wire);
      changes.push({
        code: "UNCONNECTED_PERIPHERAL_PIN",
        description: `Connected ${peripheral.name} ${req.name} to ${pin.label}`,
      });
    }
  }

  state.pinStates = derivePinStates(state);
  return { state, changes };
}
