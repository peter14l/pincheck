export type {
  AutoFixChange,
  AutoFixResult,
  Board,
  BoardRail,
  CircuitFault,
  CircuitFaultType,
  CircuitState,
  ComponentInstance,
  Diagnostic,
  DiagnosticSeverity,
  Peripheral,
  PeripheralPinRequirement,
  Pin,
  PinMode,
  PinState,
  ResolvedPin,
  Wire,
} from "./types";

export { BOARDS, getBoard } from "./boards";
export { PERIPHERALS, getPeripheral } from "./peripherals";
export { normalizeCircuitState, parseCircuitState } from "./normalize";
export { scoreDiagnostics } from "./scoring";
export {
  DEFAULT_UART_PINS,
  derivePinStates,
  directionForRequirement,
  findCompatiblePin,
  pinSupportsRequirement,
  powerPinVoltage,
  selectPowerPinForPeripheral,
} from "./capabilities";
export { lintCircuit } from "./linter";
export { autoFixCircuit } from "./autofix";
