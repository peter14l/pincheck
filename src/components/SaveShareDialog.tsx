"use client";

import { useRef, useState } from "react";
import type { CircuitState } from "@/lib/hardwareEngine";

interface SaveShareDialogProps {
  boardId: string;
  circuitState: CircuitState;
  healthScore: number;
  suggestedTitle: string;
}

export default function SaveShareDialog({
  boardId,
  circuitState,
  healthScore,
  suggestedTitle,
}: SaveShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = () => {
    setTitle((current) => current || suggestedTitle);
    setError(null);
    setSharePath(null);
    setCopied(false);
    dialogRef.current?.showModal();
  };

  const close = () => dialogRef.current?.close();

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the circuit a title before saving.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/circuits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          description: description.trim() || null,
          boardId,
          stateJson: JSON.stringify(circuitState),
          healthScore,
        }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? `Save failed with status ${response.status}`);
      }
      setSharePath(`/c/${payload.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!sharePath) return;
    const url = `${window.location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/20"
      >
        Save &amp; share
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="save-share-title"
        className="w-[min(92vw,30rem)] rounded-xl border border-[#273042] bg-[#0B0F17] p-0 text-slate-200 backdrop:bg-black/70"
        onClose={() => setPending(false)}
      >
        <div className="flex items-center justify-between border-b border-[#273042] px-5 py-3">
          <h2 id="save-share-title" className="font-mono text-sm font-semibold">
            Save &amp; share circuit
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close save dialog"
            className="rounded px-2 py-1 font-mono text-xs text-slate-400 hover:bg-white/5 hover:text-white"
          >
            close
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Title
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              className="rounded-lg border border-[#273042] bg-[#111928]/60 px-3 py-2 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={3}
              className="resize-y rounded-lg border border-[#273042] bg-[#111928]/60 px-3 py-2 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </label>

          {error && (
            <p role="alert" className="font-mono text-xs text-red-400">
              {error}
            </p>
          )}

          {sharePath ? (
            <div className="flex flex-col gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                Share link ready
              </span>
              <code className="break-all font-mono text-xs text-slate-200">{sharePath}</code>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 font-mono text-xs font-semibold text-[#04110C] hover:bg-emerald-400"
                >
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <a
                  href={sharePath}
                  className="rounded-lg border border-[#273042] px-3 py-1.5 font-mono text-xs text-slate-300 hover:border-emerald-400/50 hover:text-white"
                >
                  Open share page
                </a>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-[#273042] px-3 py-2 font-mono text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-lg bg-emerald-500 px-4 py-2 font-mono text-xs font-semibold text-[#04110C] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Saving\u2026" : "Save circuit"}
              </button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
