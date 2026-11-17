import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const databaseUrl = "file:./test.db";
const databaseFile = path.join(projectRoot, "test.db");
const env = { ...process.env, DATABASE_URL: databaseUrl };
// Invoke the local CLIs directly so no shell or PATH lookup is needed on Windows or Linux.
const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

// Always start from an empty database so seeded presets are the only rows.
for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  rmSync(`${databaseFile}${suffix}`, { force: true });
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(" ")}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [prismaCli, "migrate", "deploy"]);
run(process.execPath, [tsxCli, "prisma/seed.ts"]);
