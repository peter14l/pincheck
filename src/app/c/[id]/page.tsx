import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ForkButton } from "./fork-button";

type Circuit = NonNullable<Awaited<ReturnType<typeof prisma.circuit.findUnique>>>;

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl px-6 py-12">
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

function stateJsonPreview(stateJson: string): string {
  try {
    return JSON.stringify(JSON.parse(stateJson), null, 2);
  } catch {
    return stateJson;
  }
}

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
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Circuit unavailable</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Something went wrong while loading this circuit. Please try again
          later.
        </p>
      </main>
    );
  }

  if (!circuit) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{circuit.title}</h1>
      {circuit.description && (
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          {circuit.description}
        </p>
      )}

      <dl className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Board</dt>
          <dd className="font-mono font-medium">{circuit.boardId}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Health score</dt>
          <dd>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${healthScoreClasses(
                circuit.healthScore,
              )}`}
            >
              {circuit.healthScore}
            </span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Created</dt>
          <dd>{circuit.createdAt.toISOString()}</dd>
        </div>
      </dl>

      <div className="mt-8">
        <ForkButton
          title={circuit.title}
          description={circuit.description}
          boardId={circuit.boardId}
          stateJson={circuit.stateJson}
          healthScore={circuit.healthScore}
        />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Schematic</h2>
        <div className="mt-3 rounded-xl border-2 border-dashed border-zinc-300 p-6 dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Schematic viewer loads here
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-100 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            {stateJsonPreview(circuit.stateJson)}
          </pre>
        </div>
      </section>

      <div className="mt-10">
        <Suspense
          fallback={
            <p className="text-zinc-500 dark:text-zinc-400">
              Loading saved circuits...
            </p>
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
    });
  } catch (error) {
    console.error("Failed to load saved circuits:", error);
    failed = true;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Saved Circuits</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Pre-seeded demo circuits live here — circuits you save and fork will
        appear in this list.
      </p>
      {failed ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Failed to load saved circuits.
        </p>
      ) : circuits.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          No saved circuits yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {circuits.map((saved) => (
            <li
              key={saved.id}
              className="flex items-center justify-between gap-4 py-3"
            >
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
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${healthScoreClasses(
                  saved.healthScore,
                )}`}
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
