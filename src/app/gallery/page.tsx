import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getBoard,
  lintCircuit,
  parseCircuitState,
  scoreDiagnostics,
} from "@/lib/hardwareEngine";

export const metadata = {
  title: "Circuit Gallery \u00B7 PinCheck",
  description: "Browse circuits saved and shared with PinCheck.",
};

function scoreClasses(score: number): string {
  if (score >= 90) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}

export default function GalleryPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <nav className="mb-8 flex items-center justify-between gap-4 text-sm">
        <Link href="/" className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400">
          PinCheck
        </Link>
        <Link href="/" className="text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
          New circuit
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Circuit Gallery</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Every saved circuit, with its health score recomputed from the current linter.
      </p>

      <Suspense fallback={<p className="mt-8 text-sm text-zinc-500">Loading circuits...</p>}>
        <GalleryList />
      </Suspense>
    </main>
  );
}

async function GalleryList() {
  let circuits: Array<{
    id: string;
    title: string;
    description: string | null;
    boardId: string;
    stateJson: string;
    createdAt: Date;
  }> = [];
  let failed = false;
  try {
    circuits = await prisma.circuit.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        boardId: true,
        stateJson: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
  } catch (error) {
    console.error("Failed to load circuit gallery:", error);
    failed = true;
  }

  if (failed) {
    return (
      <p className="mt-8 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        The gallery could not load. Check the database configuration and try again.
      </p>
    );
  }

  if (circuits.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        <p className="text-zinc-600 dark:text-zinc-400">No circuits saved yet.</p>
        <Link
          href="/"
          className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#04110C] hover:bg-emerald-400"
        >
          Design the first one
        </Link>
      </div>
    );
  }

  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2">
      {circuits.map((circuit) => {
        const state = parseCircuitState(circuit.stateJson);
        const diagnostics = state ? lintCircuit(state) : [];
        const healthScore = state ? scoreDiagnostics(diagnostics) : 0;
        const boardName = getBoard(circuit.boardId)?.name ?? circuit.boardId;
        const peripheralCount = state
          ? state.components.filter((component) => component.kind === "peripheral").length
          : 0;
        const criticalCount = diagnostics.filter(
          (diagnostic) => diagnostic.severity === "CRITICAL",
        ).length;

        return (
          <li
            key={circuit.id}
            className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/c/${circuit.id}`}
                className="text-base font-semibold text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
              >
                {circuit.title}
              </Link>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${scoreClasses(healthScore)}`}>
                {healthScore}
              </span>
            </div>
            {circuit.description && (
              <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                {circuit.description}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-zinc-500">Board</dt>
                <dd className="truncate font-mono text-zinc-800 dark:text-zinc-200">{boardName}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Peripherals</dt>
                <dd className="font-mono text-zinc-800 dark:text-zinc-200">{peripheralCount}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Critical</dt>
                <dd className={`font-mono ${criticalCount > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200"}`}>
                  {state ? criticalCount : "invalid"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-[11px] text-zinc-500">
              Saved {circuit.createdAt.toISOString().slice(0, 10)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
