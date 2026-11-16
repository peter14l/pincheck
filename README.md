# PinCheck — Pre-Flight Hardware Linter

**Catch wiring mistakes before you solder.** PinCheck turns a plain-English project description into a verified pinout, checks the result against a board-aware rule engine, lets you inject faults, and generates firmware that matches the wiring you see.

![PinCheck home page](./pincheck-home.png)

---

## What it does

1. **Describe the circuit** — for example `ESP32 weather station with OLED and BME280`.
2. **PinCheck selects a board and peripherals**, assigns pins with real capability checks, and draws an interactive SVG schematic.
3. **The linter explains every problem** it finds: wrong voltage domains, unsafe strapping pins, flash pins, input-only pins used as outputs, UART conflicts, power-rail mismatches, missing grounds, I2C address collisions, current-budget overruns, and injected faults.
4. **Auto-fix** deterministically reroutes unsafe signals, chooses the correct supply rail, removes bad GPIO12 pull-ups, and connects missing required pins.
5. **Firmware** is generated in C++ (Arduino/PlatformIO) or MicroPython from the actual wiring.
6. **Save, share, fork, and browse** circuits in the gallery.

AI is optional. When `OPENAI_API_KEY` or `GEMINI_API_KEY` is set, the server asks the model to interpret the prompt into a board + peripheral plan. Pin assignment itself always runs through the deterministic hardware engine, so the model cannot invent pins. Without a key, a local keyword parser is used.

---

## Supported hardware

| Boards | Peripherals |
| --- | --- |
| ESP32 DevKit V1 (30-pin) | SSD1306 OLED (I2C) |
| Arduino Uno R3 | BME280 (I2C) |
| Raspberry Pi Pico (RP2040) | MPU6050 (I2C) |
| | DHT22 |
| | HC-SR04 ultrasonic |
| | SG90 servo |
| | 5V relay module |
| | WS2812B 8-LED strip |

The rule engine models logic voltage, 5V tolerance, input-only pins, strapping pins, flash-connected pins, ADC2/WiFi conflicts, default UART pins, and per-rail current budgets.

---

## Stack

- **Next.js 16.4.6** (App Router, React 19, Turbopack, Cache Components)
- **TypeScript**
- **Tailwind CSS 4**
- **Prisma 7** with the `better-sqlite3` adapter and SQLite
- **Vitest** for unit tests, **Playwright** for browser smoke tests

---

## Getting started

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>.

The runtime database is `dev.db` in the project root (see `.env.example`). `npm run db:seed` is idempotent for the three demo presets and removes rows left behind by incompatible older schemas.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | SQLite URL, defaults to `file:./dev.db` |
| `OPENAI_API_KEY` | no | Enables AI prompt interpretation |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini` |
| `GEMINI_API_KEY` | no | Enables AI prompt interpretation when OpenAI is absent |

Keys are read only in the server route `POST /api/generate`; they are never sent to the browser.

---

## Scripts

| Command | Action |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright browser tests |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed/refresh demo circuits |
| `npm run db:reset` | Reset the SQLite database |

---

## How the engine works

- **`src/lib/hardwareEngine.ts`** — board and peripheral definitions, pin capability rules, the linter, state normalization, health scoring, and the deterministic auto-fixer.
- **`src/lib/circuitGenerator.ts`** — prompt analysis, board selection, shared I2C bus assignment, power-rail selection, preset circuits, and plan-to-circuit construction.
- **`src/lib/firmwareGenerator.ts`** — C++/MicroPython output with real APIs (`machine.time_pulse_us`, `ESP32Servo`, correct 16-bit servo duty) plus safety warnings from the linter.
- **`src/components/SchematicCanvas.tsx`** — click a board pin, then a peripheral pin, to wire them. Select a wire to delete it. Shared pages render read-only.
- **`src/app/api/generate/route.ts`** — optional AI interpretation, always validated against the board/peripheral database.
- **`src/app/api/circuits`** — saves normalized state and recomputes health server-side; client health scores are ignored.

### Health score

Each `CRITICAL` diagnostic subtracts 25 points, each `WARNING` subtracts 10, and each `INFO` subtracts 3, clamped to 0–100. The score is always recomputed from the current linter, including on share pages and in the gallery.

---

## API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/generate` | `{ prompt }` → circuit, diagnostics, health, `usedAI` |
| `GET` | `/api/circuits` | List saved circuits with recomputed health |
| `POST` | `/api/circuits` | Save `{ title, description?, boardId, stateJson }` |
| `GET` | `/api/circuits/:id` | Load one circuit with recomputed health |
| `PUT` | `/api/circuits/:id` | Update title/description/state |
| `DELETE` | `/api/circuits/:id` | Delete a circuit |

Invalid or legacy `stateJson` is rejected on write and normalized (never trusted) on read.

---

## Verification

The project has been verified with:

```bash
npm run lint
npm run build
npm test
npm run db:migrate
npm run db:seed
npm run test:e2e
```

The unit suite covers state normalization, linter rules, generator behavior, auto-fix changes, and firmware output.

---

## License

MIT — see [LICENSE](./LICENSE).
