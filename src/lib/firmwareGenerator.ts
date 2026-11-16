import {
  Board,
  CircuitState,
  ComponentInstance,
  Peripheral,
  PeripheralPinRequirement,
  Pin,
  getBoard,
  getPeripheral,
} from "./hardwareEngine";

export type FirmwareLanguage = "cpp" | "micropython";

interface PinUsage {
  boardPinId: string;
  boardPin: Pin;
  peripheralId: string;
  peripheralName: string;
  perPinName: string;
  perPinType: PeripheralPinRequirement["type"];
  value: string;
  macro: string;
  pyVar: string;
}

interface I2cDevice {
  id: string;
  name: string;
  address: number;
}

const PERIPHERAL_PREFIX: Record<string, string> = {
  ssd1306: "oled",
  hcsr04: "ultrasonic",
  dht22: "dht",
  relay_5v_module: "relay",
  sg90: "servo",
  mpu6050: "imu",
  bme280: "bme",
  ws2812b_8: "led",
};

const PY_KEYWORDS = new Set<string>([
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "false",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "none",
  "not",
  "or",
  "pass",
  "print",
  "raise",
  "return",
  "true",
  "try",
  "while",
  "with",
  "yield",
  "self",
]);

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "PIN";
}

function uniqueMacro(base: string, used: Set<string>): string {
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}_${i}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function buildPyVar(prefix: string, perPinName: string, used: Set<string>): string {
  let base = `${prefix}_${perPinName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base.length === 0) base = "pin";
  if (/^[0-9]/.test(base)) base = `p_${base}`;
  if (PY_KEYWORDS.has(base)) base = `${base}_pin`;
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}_${i}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function resolvePinValue(boardId: string, pin: Pin): string {
  const id = pin.id;
  if (boardId === "arduino_uno_r3") {
    if (/^A\d+$/.test(id)) return id;
    const d = /^D(\d+)$/.exec(id);
    if (d) return d[1];
    return id;
  }
  if (boardId === "rpi_pico") {
    const gp = /GP(\d+)/i.exec(id);
    if (gp) return gp[1];
    return id;
  }
  if (boardId === "esp32_devkit_v1") {
    const gpio = /GPIO(\d+)/i.exec(id);
    if (gpio) return gpio[1];
    return id;
  }
  const any = /(\d+)/.exec(id);
  return any ? any[1] : id;
}

function pinConstraintComment(pin: Pin): string | null {
  const notes: string[] = [];
  if (pin.isStrapping) {
    let text = "strapping pin";
    if (pin.strappingCondition) text += ` - ${pin.strappingCondition}`;
    notes.push(text);
  }
  if (pin.isInputOnly) notes.push("input-only - cannot be driven as an output");
  if (pin.isAdc2) notes.push("ADC2 - unusable while WiFi is active");
  if (pin.isFlashConnected) notes.push("connected to internal SPI flash - do not use");
  if (notes.length === 0) return null;
  return notes.join("; ");
}

function collectI2cDevices(peripherals: Peripheral[]): I2cDevice[] {
  const devices: I2cDevice[] = [];
  const seen = new Set<string>();
  for (const peripheral of peripherals) {
    if (seen.has(peripheral.id)) continue;
    const req = peripheral.pinRequirements.find(
      (r) => typeof r.i2cAddress === "number",
    );
    if (req && typeof req.i2cAddress === "number") {
      seen.add(peripheral.id);
      devices.push({
        id: peripheral.id,
        name: peripheral.name,
        address: req.i2cAddress,
      });
    }
  }
  return devices;
}

function collectPinUsages(
  state: CircuitState,
  board: Board,
  boardComp: ComponentInstance,
): PinUsage[] {
  const compById = new Map<string, ComponentInstance>();
  for (const comp of state.components) compById.set(comp.id, comp);

  const byPin = new Map<string, PinUsage>();
  const usedMacros = new Set<string>();
  const usedPyVars = new Set<string>();

  for (const wire of state.wires) {
    const fromIsBoard = wire.from.componentId === boardComp.id;
    const toIsBoard = wire.to.componentId === boardComp.id;
    if (!fromIsBoard && !toIsBoard) continue;
    const boardEnd = fromIsBoard ? wire.from : wire.to;
    const perEnd = fromIsBoard ? wire.to : wire.from;

    const perComp = compById.get(perEnd.componentId);
    if (!perComp || perComp.kind !== "peripheral") continue;
    const peripheral = getPeripheral(perComp.refId);
    if (!peripheral) continue;

    const perReq = peripheral.pinRequirements.find((r) => r.name === perEnd.pinId);
    if (!perReq) continue;
    if (perReq.type === "power" || perReq.type === "gnd") continue;

    const boardPin = board.pins.find((p) => p.id === boardEnd.pinId);
    if (!boardPin) continue;
    if (boardPin.modes.every((m) => m === "reserved")) continue;
    if (boardPin.isFlashConnected) continue;
    if (byPin.has(boardPin.id)) continue;

    const prefix =
      PERIPHERAL_PREFIX[peripheral.id] ??
      sanitizeIdentifier(peripheral.id).toLowerCase();
    const macro = uniqueMacro(`PIN_${sanitizeIdentifier(perReq.name)}`, usedMacros);
    const pyVar = buildPyVar(prefix, perReq.name, usedPyVars);

    byPin.set(boardPin.id, {
      boardPinId: boardPin.id,
      boardPin,
      peripheralId: peripheral.id,
      peripheralName: peripheral.name,
      perPinName: perReq.name,
      perPinType: perReq.type,
      value: resolvePinValue(board.id, boardPin),
      macro,
      pyVar,
    });
  }

  return Array.from(byPin.values());
}

function generateCpp(
  board: Board,
  usages: PinUsage[],
  peripherals: Peripheral[],
): string {
  const has = (id: string) => peripherals.some((p) => p.id === id);
  const usageFor = (id: string) => usages.find((u) => u.peripheralId === id);
  const i2cDevices = collectI2cDevices(peripherals);

  const sdaUsage = usages.find((u) => u.perPinType === "i2c-sda");
  const sclUsage = usages.find((u) => u.perPinType === "i2c-scl");
  const hasI2c = Boolean(sdaUsage || sclUsage) || i2cDevices.length > 0;

  const servoUsage = usageFor("sg90");
  const dhtUsage = usageFor("dht22");
  const ledUsage = usageFor("ws2812b_8");
  const relayUsage = usageFor("relay_5v_module");
  const trigUsage = usages.find(
    (u) => u.peripheralId === "hcsr04" && /trig/i.test(u.perPinName),
  );
  const echoUsage = usages.find(
    (u) => u.peripheralId === "hcsr04" && /echo/i.test(u.perPinName),
  );

  const out: string[] = [];

  out.push("/**");
  out.push(" * ============================================================");
  out.push(" *  PinCheck auto-generated firmware");
  out.push(" * ============================================================");
  out.push(` *  Board   : ${board.name}`);
  out.push(` *  Logic   : ${board.logicVoltage}V`);
  out.push(" *  Target  : C++ (Arduino / PlatformIO)");
  out.push(" *");
  out.push(" *  Pin mapping:");
  if (usages.length === 0) {
    out.push(" *    (no peripherals wired)");
  } else {
    for (const u of usages) {
      const note = pinConstraintComment(u.boardPin);
      const suffix = note ? `  [${note}]` : "";
      out.push(
        ` *    ${u.boardPin.label} -> ${u.peripheralName} ${u.perPinName}${suffix}`,
      );
    }
  }
  out.push(" *");
  out.push(" *  This file is self-contained. The pins.h block below can be");
  out.push(" *  split into its own pins.h if you prefer a multi-file project.");
  out.push(" * ============================================================");
  out.push(" */");
  out.push("");

  out.push("// ============================== pins.h ==============================");
  out.push("#ifndef PINS_H");
  out.push("#define PINS_H");
  out.push("");
  if (usages.length === 0) {
    out.push("// No pins assigned yet.");
  } else {
    for (const u of usages) {
      const note = pinConstraintComment(u.boardPin);
      if (note) out.push(`// ${u.boardPin.label}: ${note}`);
      out.push(
        `#define ${u.macro} ${u.value}   // ${u.boardPin.label} -> ${u.peripheralName} ${u.perPinName}`,
      );
    }
  }
  if (i2cDevices.length > 0) {
    out.push("");
    out.push("// I2C device addresses (7-bit)");
    for (const d of i2cDevices) {
      out.push(
        `#define ADDR_${sanitizeIdentifier(d.id)} 0x${d.address.toString(16).toUpperCase()}`,
      );
    }
  }
  out.push("");
  out.push("#endif // PINS_H");
  out.push("// ====================================================================");
  out.push("");

  out.push("#include <Arduino.h>");
  if (hasI2c) out.push("#include <Wire.h>");
  if (has("sg90")) out.push("#include <Servo.h>");
  if (has("ssd1306")) {
    out.push("#include <Adafruit_GFX.h>");
    out.push("#include <Adafruit_SSD1306.h>");
  }
  if (has("dht22")) out.push("#include <DHT.h>");
  if (has("bme280")) out.push("#include <Adafruit_BME280.h>");
  if (has("ws2812b_8")) out.push("#include <Adafruit_NeoPixel.h>");
  out.push("");

  const libs: string[] = [];
  if (has("sg90")) libs.push("Servo (or ESP32Servo on ESP32)");
  if (has("ssd1306")) libs.push("Adafruit GFX", "Adafruit SSD1306");
  if (has("dht22")) libs.push("DHT sensor library (adafruit/DHT)");
  if (has("bme280")) libs.push("Adafruit BME280");
  if (has("ws2812b_8")) libs.push("Adafruit NeoPixel");
  if (hasI2c) libs.push("Wire (built-in)");
  if (libs.length > 0) {
    out.push("// Required libraries (PlatformIO lib_deps):");
    for (const lib of libs) out.push(`//   - ${lib}`);
    out.push("");
  }

  if (servoUsage) out.push(`Servo ${servoUsage.pyVar};`);
  if (dhtUsage) out.push(`DHT ${dhtUsage.pyVar}(${dhtUsage.macro}, DHT22);`);
  if (has("ssd1306")) out.push("Adafruit_SSD1306 display(128, 64, &Wire, -1);");
  if (has("bme280")) out.push("Adafruit_BME280 bme;");
  if (ledUsage) {
    out.push(
      `Adafruit_NeoPixel strip(8, ${ledUsage.macro}, NEO_GRB + NEO_KHZ800);`,
    );
  }
  out.push("");

  if (trigUsage && echoUsage) {
    out.push("long readDistanceCm(int trigPin, int echoPin) {");
    out.push("  digitalWrite(trigPin, LOW);");
    out.push("  delayMicroseconds(2);");
    out.push("  digitalWrite(trigPin, HIGH);");
    out.push("  delayMicroseconds(10);");
    out.push("  digitalWrite(trigPin, LOW);");
    out.push("  long duration = pulseIn(echoPin, HIGH, 30000);");
    out.push("  return duration / 58;");
    out.push("}");
    out.push("");
  }

  out.push("void setup() {");
  out.push("  Serial.begin(115200);");
  if (hasI2c && sdaUsage && sclUsage) {
    if (board.id === "esp32_devkit_v1") {
      out.push(`  Wire.begin(${sdaUsage.macro}, ${sclUsage.macro});`);
    } else if (board.id === "rpi_pico") {
      out.push(`  Wire.setSDA(${sdaUsage.macro});`);
      out.push(`  Wire.setSCL(${sclUsage.macro});`);
      out.push("  Wire.begin();");
    } else {
      out.push("  Wire.begin();");
    }
  } else if (hasI2c) {
    out.push("  Wire.begin();");
  }

  for (const u of usages) {
    if (u.perPinType === "i2c-sda" || u.perPinType === "i2c-scl") continue;
    if (u.perPinType === "power" || u.perPinType === "gnd") continue;
    const note = pinConstraintComment(u.boardPin);
    if (note) out.push(`  // ${u.boardPin.label}: ${note}`);
    switch (u.perPinType) {
      case "digital-out":
        out.push(`  pinMode(${u.macro}, OUTPUT);`);
        out.push(`  digitalWrite(${u.macro}, LOW);`);
        break;
      case "pwm":
        out.push(`  pinMode(${u.macro}, OUTPUT);`);
        break;
      case "digital-in":
        out.push(`  pinMode(${u.macro}, INPUT);`);
        break;
      case "digital-bidir":
        out.push(`  pinMode(${u.macro}, INPUT_PULLUP);`);
        break;
      case "analog":
        out.push(`  // ${u.macro}: analog input (use analogRead(${u.macro}))`);
        break;
      default:
        break;
    }
  }

  if (has("ssd1306")) {
    out.push("  if (!display.begin(SSD1306_SWITCHCAPVCC, ADDR_SSD1306)) {");
    out.push('    Serial.println("SSD1306 init failed");');
    out.push("  }");
  }
  if (dhtUsage) out.push(`  ${dhtUsage.pyVar}.begin();`);
  if (has("bme280")) {
    out.push("  if (!bme.begin(ADDR_BME280)) {");
    out.push('    Serial.println("BME280 init failed");');
    out.push("  }");
  }
  if (ledUsage) {
    out.push("  strip.begin();");
    out.push("  strip.show();");
  }
  if (servoUsage) out.push(`  ${servoUsage.pyVar}.attach(${servoUsage.macro});`);
  out.push("}");
  out.push("");

  out.push("void loop() {");
  out.push("  // --- Example reads (adapt as needed) ---");
  if (has("ssd1306")) {
    out.push(
      '  // display.clearDisplay(); display.setTextSize(1); display.setCursor(0, 0); display.println("PinCheck"); display.display();',
    );
  }
  if (trigUsage && echoUsage) {
    out.push(
      `  // long distanceCm = readDistanceCm(${trigUsage.macro}, ${echoUsage.macro});`,
    );
  }
  if (dhtUsage) {
    out.push(`  // float t = ${dhtUsage.pyVar}.readTemperature();`);
    out.push(`  // float h = ${dhtUsage.pyVar}.readHumidity();`);
  }
  if (has("bme280")) {
    out.push("  // float t = bme.readTemperature();");
    out.push("  // float p = bme.readPressure() / 100.0F;");
  }
  if (has("mpu6050")) {
    out.push(
      "  // Wire.beginTransmission(ADDR_MPU6050); /* ... */ Wire.endTransmission();",
    );
  }
  if (relayUsage) {
    out.push(
      `  // digitalWrite(${relayUsage.macro}, HIGH); // or LOW depending on module`,
    );
  }
  if (servoUsage) {
    out.push(`  // ${servoUsage.pyVar}.write(90);`);
  }
  if (ledUsage) {
    out.push("  // strip.setPixelColor(0, strip.Color(255, 0, 0)); strip.show();");
  }
  for (const u of usages) {
    if (u.perPinType === "analog") {
      out.push(`  // int ${u.macro.toLowerCase()}_raw = analogRead(${u.macro});`);
    }
  }
  out.push("  delay(200);");
  out.push("}");
  out.push("");

  return out.join("\n");
}

function generateMicroPython(
  board: Board,
  usages: PinUsage[],
  peripherals: Peripheral[],
): string {
  const has = (id: string) => peripherals.some((p) => p.id === id);
  const usageFor = (id: string) => usages.find((u) => u.peripheralId === id);
  const i2cDevices = collectI2cDevices(peripherals);

  const sdaUsage = usages.find((u) => u.perPinType === "i2c-sda");
  const sclUsage = usages.find((u) => u.perPinType === "i2c-scl");
  const servoUsage = usageFor("sg90");
  const dhtUsage = usageFor("dht22");
  const ledUsage = usageFor("ws2812b_8");
  const relayUsage = usageFor("relay_5v_module");
  const trigUsage = usages.find(
    (u) => u.peripheralId === "hcsr04" && /trig/i.test(u.perPinName),
  );
  const echoUsage = usages.find(
    (u) => u.peripheralId === "hcsr04" && /echo/i.test(u.perPinName),
  );

  const out: string[] = [];

  out.push("# ============================================================");
  out.push("#  PinCheck auto-generated firmware");
  out.push("# ============================================================");
  out.push(`#  Board   : ${board.name}`);
  out.push(`#  Logic   : ${board.logicVoltage}V`);
  out.push("#  Target  : MicroPython");
  out.push("#");
  out.push("#  Pin mapping:");
  if (usages.length === 0) {
    out.push("#    (no peripherals wired)");
  } else {
    for (const u of usages) {
      const note = pinConstraintComment(u.boardPin);
      const suffix = note ? `  [${note}]` : "";
      out.push(
        `#    ${u.boardPin.label} -> ${u.peripheralName} ${u.perPinName}${suffix}`,
      );
    }
  }
  out.push("# ============================================================");
  out.push("");

  out.push("import time");
  out.push("from machine import Pin, I2C, PWM");
  if (usages.some((u) => u.perPinType === "analog")) {
    out.push("from machine import ADC");
  }
  if (has("hcsr04")) out.push("from machine import time_pins_us");
  if (has("dht22")) out.push("import dht");
  if (has("ssd1306")) out.push("import ssd1306");
  if (has("ws2812b_8")) out.push("import neopixel");
  if (has("bme280")) out.push("import bme280");
  out.push("");

  if (sdaUsage && sclUsage) {
    out.push("# --- I2C bus ---");
    out.push(
      `i2c = I2C(0, scl=Pin(${sclUsage.value}), sda=Pin(${sdaUsage.value}))`,
    );
    out.push("");
  }

  out.push("# --- Pin objects ---");
  for (const u of usages) {
    if (u.perPinType === "i2c-sda" || u.perPinType === "i2c-scl") continue;
    if (u.perPinType === "power" || u.perPinType === "gnd") continue;
    const note = pinConstraintComment(u.boardPin);
    if (note) out.push(`# ${u.boardPin.label}: ${note}`);
    switch (u.perPinType) {
      case "pwm":
        out.push(`${u.pyVar} = PWM(Pin(${u.value}), freq=50)`);
        break;
      case "digital-out":
        out.push(`${u.pyVar} = Pin(${u.value}, Pin.OUT)`);
        break;
      case "digital-in":
        out.push(`${u.pyVar} = Pin(${u.value}, Pin.IN)`);
        break;
      case "digital-bidir":
        out.push(`${u.pyVar} = Pin(${u.value}, Pin.IN, Pin.PULL_UP)`);
        break;
      case "analog":
        out.push(`${u.pyVar} = ADC(Pin(${u.value}))`);
        break;
      default:
        break;
    }
  }
  out.push("");

  if (i2cDevices.length > 0) {
    out.push("# I2C device addresses (7-bit)");
    for (const d of i2cDevices) {
      out.push(
        `ADDR_${sanitizeIdentifier(d.id)} = 0x${d.address.toString(16).toUpperCase()}`,
      );
    }
    out.push("");
  }

  if (has("ssd1306")) {
    out.push("# --- SSD1306 OLED ---");
    out.push("display = ssd1306.SSD1306_I2C(128, 64, i2c)");
    out.push("");
  }
  if (dhtUsage) {
    out.push("# --- DHT22 ---");
    out.push(`sensor = dht.DHT22(${dhtUsage.pyVar})`);
    out.push("");
  }
  if (ledUsage) {
    out.push("# --- WS2812B NeoPixel ---");
    out.push(`np = neopixel.NeoPixel(${ledUsage.pyVar}, 8)`);
    out.push("");
  }
  if (has("bme280")) {
    out.push("# --- BME280 (adapt import to your driver module) ---");
    out.push("# bme = bme280.BME280_I2C(i2c=i2c)");
    out.push("");
  }

  if (trigUsage && echoUsage) {
    out.push("# --- HC-SR04 distance helper ---");
    out.push("def read_distance_cm(trig, echo):");
    out.push("    trig.value(0)");
    out.push("    time.sleep_us(2)");
    out.push("    trig.value(1)");
    out.push("    time.sleep_us(10)");
    out.push("    trig.value(0)");
    out.push("    duration = time_pins_us(echo, 1, 30000)");
    out.push("    if duration < 0:");
    out.push("        return -1.0");
    out.push("    return duration / 58.0");
    out.push("");
  }

  out.push("def initialize():");
  out.push("    # Drive outputs to a safe default level");
  let initCount = 0;
  for (const u of usages) {
    if (u.perPinType === "digital-out") {
      out.push(`    ${u.pyVar}.value(0)`);
      initCount += 1;
    }
  }
  if (initCount === 0) out.push("    pass");
  out.push("");

  out.push("def main():");
  out.push("    while True:");
  out.push("        # --- Example reads (adapt as needed) ---");
  if (trigUsage && echoUsage) {
    out.push(
      `        print(read_distance_cm(${trigUsage.pyVar}, ${echoUsage.pyVar}))`,
    );
  }
  if (dhtUsage) {
    out.push("        sensor.measure();");
    out.push("        print(sensor.temperature(), sensor.humidity())");
  }
  if (has("ssd1306")) {
    out.push(
      '        display.fill(0); display.text("PinCheck", 0, 0); display.show()',
    );
  }
  if (ledUsage) {
    out.push("        np[0] = (255, 0, 0); np.write()");
  }
  if (has("bme280")) {
    out.push("        # print(bme.temperature)");
  }
  if (has("mpu6050")) {
    out.push("        # TODO: read MPU6050 over i2c");
  }
  if (relayUsage) {
    out.push(`        ${relayUsage.pyVar}.value(1)  # energize relay`);
  }
  if (servoUsage) {
    out.push(`        ${servoUsage.pyVar}.duty(26)  # ~90 deg at 50 Hz`);
  }
  out.push("        time.sleep(0.2)");
  out.push("");
  out.push('if __name__ == "__main__":');
  out.push("    initialize();");
  out.push("    main()");
  out.push("");

  return out.join("\n");
}

function generateFallback(boardId: string, language: FirmwareLanguage): string {
  if (language === "micropython") {
    return [
      "# PinCheck firmware generator",
      `# No board found for boardId: ${boardId}`,
      "# Provide a valid board and wire peripherals before generating firmware.",
      "",
    ].join("\n");
  }
  return [
    "/*",
    " * PinCheck firmware generator",
    ` * No board found for boardId: ${boardId}`,
    " * Provide a valid board and wire peripherals before generating firmware.",
    " */",
    "",
    "#include <Arduino.h>",
    "",
    "void setup() {",
    "  Serial.begin(115200);",
    "}",
    "",
    "void loop() {",
    "}",
    "",
  ].join("\n");
}

export function generateFirmware(
  circuitState: CircuitState,
  boardId: string,
  language: FirmwareLanguage,
): string {
  const boardComp =
    circuitState.components.find(
      (c) => c.kind === "board" && c.refId === boardId,
    ) ?? circuitState.components.find((c) => c.kind === "board");

  const board =
    (boardComp ? getBoard(boardComp.refId) : undefined) ?? getBoard(boardId);

  if (!board || !boardComp) {
    return generateFallback(boardId, language);
  }

  const usages = collectPinUsages(circuitState, board, boardComp);
  const peripherals: Peripheral[] = [];
  const seenPeripherals = new Set<string>();
  for (const comp of circuitState.components) {
    if (comp.kind !== "peripheral") continue;
    if (seenPeripherals.has(comp.refId)) continue;
    const peripheral = getPeripheral(comp.refId);
    if (!peripheral) continue;
    seenPeripherals.add(comp.refId);
    peripherals.push(peripheral);
  }

  return language === "micropython"
    ? generateMicroPython(board, usages, peripherals)
    : generateCpp(board, usages, peripherals);
}
