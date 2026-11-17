export type DiagnosticSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  explanation: string;
  fix: string;
  componentIds?: string[];
  pinIds?: string[];
}

export type PinMode =
  | "gpio"
  | "input-only"
  | "power"
  | "gnd"
  | "analog"
  | "pwm"
  | "uart"
  | "i2c-sda"
  | "i2c-scl"
  | "spi"
  | "reserved";

export interface Pin {
  id: string;
  label: string;
  modes: PinMode[];
  isInputOnly?: boolean;
  isStrapping?: boolean;
  strappingCondition?: string;
  isFlashConnected?: boolean;
  isAdc2?: boolean;
  notes?: string;
}

export interface BoardRail {
  voltage: number;
  maxCurrentMa: number;
}

export interface Board {
  id: string;
  name: string;
  logicVoltage: number;
  logicVoltageTolerant5V: boolean;
  pins: Pin[];
  rails: {
    v3v3?: BoardRail;
    v5?: BoardRail;
  };
}

export interface PeripheralPinRequirement {
  name: string;
  type:
    | "power"
    | "gnd"
    | "digital-in"
    | "digital-out"
    | "digital-bidir"
    | "pwm"
    | "i2c-sda"
    | "i2c-scl"
    | "analog"
    | "uart-tx"
    | "uart-rx";
  voltage?: number;
  i2cAddress?: number;
  notes?: string;
}

export interface Peripheral {
  id: string;
  name: string;
  description: string;
  supplyVoltage: number;
  supplyVoltageMin?: number;
  supplyVoltageMax?: number;
  currentDrawMa: number;
  pinRequirements: PeripheralPinRequirement[];
  notes?: string;
}

export interface ComponentInstance {
  id: string;
  kind: "board" | "peripheral";
  refId: string;
  label?: string;
}

export interface Wire {
  id: string;
  from: { componentId: string; pinId: string };
  to: { componentId: string; pinId: string };
}

export interface PinState {
  componentId: string;
  pinId: string;
  direction?: "input" | "output" | "bidirectional";
  level?: "HIGH" | "LOW" | "FLOATING";
}

export type CircuitFaultType = "open" | "floating" | "brownout";

export interface CircuitFault {
  id: string;
  type: CircuitFaultType;
  componentId?: string;
  pinId?: string;
  rail?: "3.3V" | "5V";
  note?: string;
}

export interface CircuitState {
  components: ComponentInstance[];
  wires: Wire[];
  pinStates?: PinState[];
  faults?: CircuitFault[];
}

export interface AutoFixChange {
  code: string;
  description: string;
}

export interface AutoFixResult {
  state: CircuitState;
  changes: AutoFixChange[];
}

export interface ResolvedPin {
  component: ComponentInstance;
  board?: Board;
  pin?: Pin;
  peripheral?: Peripheral;
  perReq?: PeripheralPinRequirement;
}
