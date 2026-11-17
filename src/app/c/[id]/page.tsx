import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getBoard,
  lintCircuit,
  parseCircuitState,
  scoreDiagnostics,
  type CircuitState,
} from "@/lib/hardwareEngine";
import { ForkButton } from "./fork-button";
import { SharedSchematicWrapper } from "./shared-schematic";

type Circuit = NonNullable<Awaited<ReturnType<typeof prisma.circuit.findUnique>>>;

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  try {
    const circuit = await prisma.circuit.findUnique({
      where: { id },
      select: { title: true, description: true, boardId: true },
    });
    if (!circuit) {
      return { title: "Circuit not found" };
    }
    const boardName = getBoard(circuit.boardId)?.name ?? circuit.boardId;
    const description =
      circuit.description?.trim() ||
      `A ${boardName} circuit shared from PinCheck, with verified pinout and health score.`;
    return {
      title: circuit.title,
      description,
      openGraph: {
        title: `${circuit.title} \u00B7 PinCheck`,
        description,
        type: "article",
      },
      twitter: {
        card: "summary",
        title: `${circuit.title} \u00B7 PinCheck`,
        description,
      },
    };
  } catch {
    return { title: "Shared circuit \u00B7 PinCheck" };
  }
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-6 py-12">
          <p className="text-zinc-500 dark:text-zinc-400">Loading circuit...</p>
        </main>
      }
    >
      <CircuitContent params={props.params} />
    </Suspense>
  );
}

function healthScoreClasses(healthScore: number): string {
  if (healthScore >= 90) {
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (healthScore >= 60) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  }
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}

const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL: "text-red-700 dark:text-red-400",
  WARNING: "text-amber-700 dark:text-amber-400",
  INFO: "text-emerald-700 dark:text-emerald-400",
};

async function CircuitContent(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  let circuit: Circuit | null = null;
  let failed = false;
  try {
    circuit = await prisma.circuit.findUnique({ where: { id } });
  } catch (error) {
    console.error(`Failed to load circuit "${id}":`, error);
    failed = true;
  }

  if (failed) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Circuit unavailable</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Something went wrong while loading this circuit. Please try again later.
        </p>
      </main>
    );
  }

  if (!circuit) {
    notFound();
  }

  const parsed = parseCircuitState(circuit.stateJson);
  const circuitState: CircuitState = parsed ?? { components: [], wires: [] };
  const diagnostics = parsed ? lintCircuit(circuitState) : [];
  const healthScore = parsed ? scoreDiagnostics(diagnostics) : 0;
  const boardName = getBoard(circuit.boardId)?.name ?? circuit.boardId;
  const peripheralCount = circuitState.components.filter(
    (component) => component.kind === "peripheral",
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <nav className="mb-6 flex items-center justify-between gap-4 text-sm">
        <Link href="/" className="font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
          PinCheck
        </Link>
        <Link href="/gallery" className="text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
          Gallery
        </Link>
      </nav>

      <h1 className="text-3xl font-semibold tracking-tight">{circuit.title}</h1>
      {circuit.description && (
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">{circuit.description}</p>
      )}

      <dl className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Board</dt>
          <dd className="font-mono font-medium">{boardName}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Peripherals</dt>
          <dd className="font-mono font-medium">{peripheralCount}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Health score</dt>
          <dd>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${healthScoreClasses(healthScore)}`}
            >
              {healthScore}
            </span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Created</dt>
          <dd>{circuit.createdAt.toISOString()}</dd>
        </div>
      </dl>

      {!parsed && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This circuit was saved in an older or invalid format, so the schematic cannot be
          reconstructed. The title and metadata are still available.
        </p>
      )}

      <div className="mt-8">
        <ForkButton
          title={circuit.title}
          description={circuit.description}
          boardId={circuit.boardId}
          stateJson={JSON.stringify(circuitState)}
        />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Schematic</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-300 bg-[#0B0F17] dark:border-zinc-700">
          <SharedSchematicWrapper circuitState={circuitState} diagnostics={diagnostics} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">
          Diagnostics <span className="text-sm font-normal text-zinc-500">({diagnostics.length})</span>
        </h2>
        {!parsed ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            No diagnostics can be computed for invalid circuit data.
          </p>
        ) : diagnostics.length === 0 ? (
          <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            No issues detected. This wiring passes every modeled check.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {diagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${index}`}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-mono text-xs font-semibold ${SEVERITY_CLASSES[diagnostic.severity]}`}>
                    {diagnostic.severity}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">{diagnostic.code}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">{diagnostic.message}</p>
                {diagnostic.fix && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="font-semibold">Fix:</span> {diagnostic.fix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="mt-10">
        <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Raw circuit JSON
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-100 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {JSON.stringify(circuitState, null, 2)}
        </pre>
      </details>

      <div className="mt-10">
        <Suspense
          fallback={
            <p className="text-zinc-500 dark:text-zinc-400">Loading saved circuits...</p>
          }
        >
          <SavedCircuits currentId={circuit.id} />
        </Suspense>
      </div>
    </main>
  );
}

async function SavedCircuits({ currentId }: { currentId: string }) {
  let circuits: Array<{ id: string; title: string; healthScore: number }> = [];
  let failed = false;
  try {
    circuits = await prisma.circuit.findMany({
      select: { id: true, title: true, healthScore: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
  } catch (error) {
    console.error("Failed to load saved circuits:", error);
    failed = true;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Saved Circuits</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Circuits you save and fork appear in this list.
      </p>
      {failed ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Failed to load saved circuits.
        </p>
      ) : circuits.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No saved circuits yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {circuits.map((saved) => (
            <li key={saved.id} className="flex items-center justify-between gap-4 py-3">
              <Link
                href={`/c/${saved.id}`}
                className="truncate font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
              >
                {saved.title}
                {saved.id === currentId && (
                  <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    viewing
                  </span>
                )}
              </Link>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${healthScoreClasses(saved.healthScore)}`}
              >
                {saved.healthScore}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
