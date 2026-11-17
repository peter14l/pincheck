"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteCircuitButtonProps {
  id: string;
  title: string;
}

export function DeleteCircuitButton({ id, title }: DeleteCircuitButtonProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (pending) return;
    dialogRef.current?.close();
  }

  async function handleDelete() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/circuits/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      // A 404 means the circuit is already gone, which is the desired state.
      if (!response.ok && response.status !== 404) {
        throw new Error(
          response.status === 500
            ? "The circuit could not be deleted. Please try again."
            : `Delete failed with status ${response.status}.`,
        );
      }

      dialogRef.current?.close();
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The circuit could not be deleted.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`Delete ${title}`}
        className="inline-flex items-center rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:text-red-300 dark:focus-visible:ring-offset-zinc-950"
      >
        Delete
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          setError(null);
          setPending(false);
        }}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[min(92vw,28rem)] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="text-lg font-semibold">
              Delete circuit?
            </h2>
            <p
              id={descriptionId}
              className="text-sm text-zinc-600 dark:text-zinc-400"
            >
              &ldquo;{title}&rdquo; will be permanently removed. This cannot be
              undone.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              disabled={pending}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-zinc-950"
            >
              {pending ? "Deleting\u2026" : "Delete circuit"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
