import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getBoard,
  lintCircuit,
  parseCircuitState,
  scoreDiagnostics,
} from "@/lib/hardwareEngine";
import { DeleteCircuitButton } from "./delete-circuit-button";
import {
  GALLERY_PAGE_SIZE,
  GALLERY_QUERY_MAX_LENGTH,
  clampGalleryPage,
  galleryHref,
  galleryPageCount,
  normalizeGalleryQuery,
  parseGalleryPage,
  type GallerySearchParams,
} from "./gallery-utils";

export const metadata = {
  title: "Circuit Gallery \u00B7 PinCheck",
  description: "Browse circuits saved and shared with PinCheck.",
};

type GalleryCircuit = {
  id: string;
  title: string;
  description: string | null;
  boardId: string;
  stateJson: string;
  createdAt: Date;
};

function scoreClasses(score: number): string {
  if (score >= 90) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}

function searchFilter(query: string) {
  if (!query) return undefined;
  // SQLite has no `mode: "insensitive"`. Prisma's `contains` compiles to a
  // LIKE query, which SQLite already matches case-insensitively for ASCII.
  return {
    OR: [
      { title: { contains: query } },
      { description: { contains: query } },
    ],
  };
}

export default function GalleryPage(props: {
  searchParams: Promise<GallerySearchParams>;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <nav className="mb-8 flex items-center justify-between gap-4 text-sm">
        <Link href="/" className="font-medium text-emerald-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:text-emerald-400 dark:focus-visible:ring-offset-zinc-950">
          PinCheck
        </Link>
        <Link href="/" className="text-zinc-500 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:text-zinc-400 dark:focus-visible:ring-offset-zinc-950">
          New circuit
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Circuit Gallery</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Every saved circuit, with its health score recomputed from the current linter.
      </p>

      <Suspense fallback={<p className="mt-8 text-sm text-zinc-500">Loading circuits...</p>}>
        <GalleryContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function GalleryContent({
  searchParams,
}: {
  searchParams: Promise<GallerySearchParams>;
}) {
  const params = await searchParams;
  const query = normalizeGalleryQuery(params.q);
  const requestedPage = parseGalleryPage(params.page);

  let circuits: GalleryCircuit[] = [];
  let totalCount = 0;
  let page = 1;
  let failed = false;

  try {
    totalCount = await prisma.circuit.count({ where: searchFilter(query) });
    page = clampGalleryPage(requestedPage, totalCount);

    if (totalCount > 0) {
      circuits = await prisma.circuit.findMany({
        select: {
          id: true,
          title: true,
          description: true,
          boardId: true,
          stateJson: true,
          createdAt: true,
        },
        where: searchFilter(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * GALLERY_PAGE_SIZE,
        take: GALLERY_PAGE_SIZE,
      });
    }
  } catch (error) {
    console.error("Failed to load circuit gallery:", error);
    failed = true;
  }

  if (failed) {
    return (
      <p
        role="alert"
        className="mt-8 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        The gallery could not load. Check the database configuration and try again.
      </p>
    );
  }

  const totalPages = galleryPageCount(totalCount);

  return (
    <>
      <GallerySearchForm query={query} totalCount={totalCount} />

      {totalCount === 0 ? (
        <GalleryEmptyState query={query} />
      ) : (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {circuits.map((circuit) => (
              <CircuitCard key={circuit.id} circuit={circuit} />
            ))}
          </ul>
          <GalleryPagination page={page} totalPages={totalPages} query={query} />
        </>
      )}
    </>
  );
}

function GallerySearchForm({
  query,
  totalCount,
}: {
  query: string;
  totalCount: number;
}) {
  return (
    <div className="mt-8">
      <Form
        action="/gallery"
        role="search"
        aria-label="Search saved circuits"
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-end dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="flex-1">
          <label
            htmlFor="gallery-search"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Search circuits
          </label>
          <input
            key={query}
            id="gallery-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={GALLERY_QUERY_MAX_LENGTH}
            placeholder="Search titles and descriptions"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#04110C] transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
          >
            Search
          </button>
          {query && (
            <Link
              href="/gallery"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950"
            >
              Clear
            </Link>
          )}
        </div>
      </Form>

      {query && totalCount > 0 && (
        <p
          role="status"
          className="mt-3 break-words text-sm text-zinc-600 dark:text-zinc-400"
        >
          {totalCount} {totalCount === 1 ? "circuit matches" : "circuits match"}{" "}
          &ldquo;{query}&rdquo;.
        </p>
      )}
    </div>
  );
}

function GalleryEmptyState({ query }: { query: string }) {
  if (!query) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        <p className="text-zinc-600 dark:text-zinc-400">No circuits saved yet.</p>
        <Link
          href="/"
          className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#04110C] hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
        >
          Design the first one
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
      <p className="break-words text-zinc-600 dark:text-zinc-400">
        No circuits match &ldquo;{query}&rdquo;.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/gallery"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#04110C] hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
        >
          Clear search
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950"
        >
          Design a new circuit
        </Link>
      </div>
    </div>
  );
}

function GalleryPagination({
  page,
  totalPages,
  query,
}: {
  page: number;
  totalPages: number;
  query: string;
}) {
  const linkClasses =
    "inline-flex items-center rounded-full border border-zinc-300 px-4 py-1.5 font-medium text-zinc-700 transition-colors hover:border-emerald-400 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:text-emerald-300 dark:focus-visible:ring-offset-zinc-950";
  const disabledClasses =
    "inline-flex cursor-not-allowed items-center rounded-full border border-zinc-200 px-4 py-1.5 text-zinc-400 opacity-60 dark:border-zinc-800 dark:text-zinc-600";

  return (
    <nav
      aria-label="Gallery pagination"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800"
    >
      <p className="text-zinc-500 dark:text-zinc-400">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={galleryHref({ page: page - 1, query })}
            rel="prev"
            className={linkClasses}
          >
            &larr; Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClasses}>
            &larr; Previous
          </span>
        )}
        {page < totalPages ? (
          <Link
            href={galleryHref({ page: page + 1, query })}
            rel="next"
            className={linkClasses}
          >
            Next &rarr;
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClasses}>
            Next &rarr;
          </span>
        )}
      </div>
    </nav>
  );
}

function CircuitCard({ circuit }: { circuit: GalleryCircuit }) {
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
    <li className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/c/${circuit.id}`}
          className="text-base font-semibold text-zinc-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:text-zinc-50 dark:focus-visible:ring-offset-zinc-950"
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
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-500">
          Saved {circuit.createdAt.toISOString().slice(0, 10)}
        </p>
        <DeleteCircuitButton id={circuit.id} title={circuit.title} />
      </div>
    </li>
  );
}
