import { PERIPHERALS } from "./peripherals";
import type {
  Board,
  BoardRail,
  CircuitState,
  Peripheral,
  PeripheralPinRequirement,
  Pin,
  PinState,
} from "./types";

const INPUT_REQUIREMENTS: ReadonlySet<PeripheralPinRequirement["type"]> = new Set([
  "digital-in",
  "analog",
  "uart-rx",
]);

const OUTPUT_REQUIREMENTS: ReadonlySet<PeripheralPinRequirement["type"]> = new Set([
  "digital-out",
  "pwm",
  "uart-tx",
]);

export function directionForRequirement(
  type: PeripheralPinRequirement["type"],
): "input" | "output" | "bidirectional" {
  if (INPUT_REQUIREMENTS.has(type)) return "input";
  if (OUTPUT_REQUIREMENTS.has(type)) return "output";
  return "bidirectional";
}

export function pinSupportsRequirement(pin: Pin, req: PeripheralPinRequirement): boolean {
  switch (req.type) {
    case "power":
      return pin.modes.includes("power");
    case "gnd":
      return pin.modes.includes("gnd");
    case "i2c-sda":
      return pin.modes.includes("i2c-sda") || pin.modes.includes("gpio");
    case "i2c-scl":
      return pin.modes.includes("i2c-scl") || pin.modes.includes("gpio");
    case "pwm":
      return pin.modes.includes("pwm") && !pin.isInputOnly;
    case "analog":
      return pin.modes.includes("analog");
    case "digital-in":
      return (
        (pin.modes.includes("gpio") ||
          pin.modes.includes("analog") ||
          pin.modes.includes("input-only")) &&
        !pin.isFlashConnected
      );
    case "digital-out":
    case "digital-bidir":
      return pin.modes.includes("gpio") && !pin.isInputOnly && !pin.isFlashConnected;
    case "uart-tx":
    case "uart-rx":
      return pin.modes.includes("uart") && !pin.isInputOnly && !pin.isFlashConnected;
    default:
      return false;
  }
}

/** Pins reserved for the hardware serial console / bootloader. */
export const DEFAULT_UART_PINS: Record<string, readonly string[]> = {
  arduino_uno_r3: ["D0", "D1"],
  esp32_devkit_v1: ["GPIO1", "GPIO3"],
};

export function findCompatiblePin(
  board: Board,
  req: PeripheralPinRequirement,
  usedPins: ReadonlySet<string>,
  options: { allowStrapping?: boolean } = {},
): Pin | null {
  const uartReserved = DEFAULT_UART_PINS[board.id] ?? [];
  const isUartRequirement = req.type === "uart-tx" || req.type === "uart-rx";
  const candidates = board.pins.filter((candidate) => {
    if (usedPins.has(candidate.id)) return false;
    if (!pinSupportsRequirement(candidate, req)) return false;
    if (candidate.isFlashConnected) return false;
    if (uartReserved.includes(candidate.id) && !isUartRequirement) return false;
    if (
      candidate.isStrapping &&
      !options.allowStrapping &&
      req.type !== "power" &&
      req.type !== "gnd"
    ) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;

  const nonAdc2 = candidates.filter((candidate) => !candidate.isAdc2);
  const pool = nonAdc2.length > 0 ? nonAdc2 : candidates;
  return pool.find((candidate) => !candidate.isInputOnly) ?? pool[0];
}

export function powerPinVoltage(board: Board, pin: Pin): number | null {
  if (!pin.modes.includes("power")) return null;
  if (/3V3|3\.3V/i.test(pin.id)) return board.rails.v3v3?.voltage ?? board.logicVoltage;
  if (/5V|VIN|VSYS|VBUS/i.test(pin.id)) return board.rails.v5?.voltage ?? 5;
  return board.logicVoltage;
}

/**
 * Pick a supply pin that can actually power the peripheral. Prefers an exact
 * voltage match, then the rail with the most headroom. Falls back to the
 * closest rail when the board cannot satisfy the peripheral (the linter will
 * then explain the mismatch).
 */
export function selectPowerPinForPeripheral(
  board: Board,
  peripheral: Peripheral,
): { pin: Pin; voltage: number } | null {
  const min = peripheral.supplyVoltageMin ?? peripheral.supplyVoltage;
  const max = peripheral.supplyVoltageMax ?? peripheral.supplyVoltage;
  const target = Math.min(Math.max(peripheral.supplyVoltage, min), max);

  const candidates = board.pins
    .filter((candidate) => candidate.modes.includes("power"))
    .map((candidate) => ({
      pin: candidate,
      voltage: powerPinVoltage(board, candidate),
      rail: candidate.id === "3V3" || candidate.id === "3.3V"
        ? board.rails.v3v3
        : board.rails.v5,
    }))
    .filter((entry): entry is { pin: Pin; voltage: number; rail: BoardRail | undefined } =>
      typeof entry.voltage === "number",
    );

  if (candidates.length === 0) return null;

  const inRange = candidates.filter(
    (entry) => entry.voltage >= min - 0.01 && entry.voltage <= max + 0.01,
  );
  const pool = inRange.length > 0 ? inRange : candidates;
  pool.sort((a, b) => {
    const exactA = Math.abs(a.voltage - target);
    const exactB = Math.abs(b.voltage - target);
    if (exactA !== exactB) return exactA - exactB;
    return (b.rail?.maxCurrentMa ?? 0) - (a.rail?.maxCurrentMa ?? 0);
  });

  const best = pool[0];
  return { pin: best.pin, voltage: best.voltage };
}

export function derivePinStates(state: CircuitState): PinState[] {
  const componentsById = new Map(state.components.map((component) => [component.id, component]));
  const boardPinState = new Map<string, PinState>();

  const add = (
    componentId: string,
    pinId: string,
    direction: "input" | "output" | "bidirectional",
  ) => {
    const key = `${componentId}:${pinId}`;
    const existing = boardPinState.get(key);
    if (!existing) {
      boardPinState.set(key, { componentId, pinId, direction });
      return;
    }
    if (existing.direction !== direction) existing.direction = "bidirectional";
  };

  for (const wire of state.wires) {
    const from = componentsById.get(wire.from.componentId);
    const to = componentsById.get(wire.to.componentId);
    if (!from || !to) continue;

    for (const [boardEnd, peripheralEnd, boardComponent] of [
      [wire.from, wire.to, from] as const,
      [wire.to, wire.from, to] as const,
    ]) {
      if (boardComponent.kind !== "board") continue;
      const otherComponent = componentsById.get(peripheralEnd.componentId);
      if (!otherComponent) continue;

      if (otherComponent.kind === "peripheral") {
        const peripheral = PERIPHERALS[otherComponent.refId];
        const req = peripheral?.pinRequirements.find((entry) => entry.name === peripheralEnd.pinId);
        if (req && req.type !== "power" && req.type !== "gnd") {
          add(boardEnd.componentId, boardEnd.pinId, directionForRequirement(req.type));
        }
      } else if (boardComponent.id === wire.from.componentId) {
        add(boardEnd.componentId, boardEnd.pinId, "output");
      } else {
        add(boardEnd.componentId, boardEnd.pinId, "input");
      }
    }
  }

  for (const existing of state.pinStates ?? []) {
    const key = `${existing.componentId}:${existing.pinId}`;
    const derived = boardPinState.get(key);
    if (derived) {
      if (existing.level) derived.level = existing.level;
    } else {
      boardPinState.set(key, { ...existing });
    }
  }

  return Array.from(boardPinState.values());
}
