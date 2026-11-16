"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ForkButtonProps {
  title: string;
  description: string | null;
  boardId: string;
  stateJson: string;
}

export function ForkButton({ title, description, boardId, stateJson }: ForkButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFork() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/circuits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${title} (fork)`,
          description,
          boardId,
          stateJson,
        }),
      });
      if (!response.ok) {
        throw new Error(`Fork failed with status ${response.status}`);
      }
      const created = (await response.json()) as { id: string };
      router.push(`/c/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fork circuit");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleFork}
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Forking..." : "Fork this circuit"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
