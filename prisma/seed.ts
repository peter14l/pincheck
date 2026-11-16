import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { generateCircuitFromPrompt } from "../src/lib/circuitGenerator";
import { BOARDS, parseCircuitState } from "../src/lib/hardwareEngine";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

const PRESET_PROMPTS = [
  "ESP32 Weather Station with OLED & BME280",
  "Arduino Obstacle Robot with HC-SR04 & Servo",
  "Deliberate Buggy Circuit Demo",
] as const;

async function main() {
  const existing = await prisma.circuit.findMany({
    select: { id: true, title: true, boardId: true, stateJson: true },
  });

  // Remove rows left behind by older schemas so every share link renders.
  const staleIds = existing
    .filter((circuit) => !BOARDS[circuit.boardId] || !parseCircuitState(circuit.stateJson))
    .map((circuit) => circuit.id);
  if (staleIds.length > 0) {
    await prisma.circuit.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`Removed ${staleIds.length} stale circuit(s).`);
  }

  for (const prompt of PRESET_PROMPTS) {
    const result = await generateCircuitFromPrompt(prompt);
    const stateJson = JSON.stringify(result.circuitState);
    const matching = existing.find(
      (circuit) => circuit.title === prompt && !staleIds.includes(circuit.id),
    );

    if (matching) {
      await prisma.circuit.update({
        where: { id: matching.id },
        data: {
          boardId: result.boardId,
          stateJson,
          healthScore: result.healthScore,
          description: result.explanation,
        },
      });
      console.log(`Updated "${prompt}" (health ${result.healthScore}).`);
    } else {
      await prisma.circuit.create({
        data: {
          title: prompt,
          description: result.explanation,
          boardId: result.boardId,
          stateJson,
          healthScore: result.healthScore,
        },
      });
      console.log(`Created "${prompt}" (health ${result.healthScore}).`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
