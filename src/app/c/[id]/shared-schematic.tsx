"use client";

import dynamic from "next/dynamic";
import type { CircuitState, Diagnostic } from "@/lib/hardwareEngine";

const SharedSchematic = dynamic(
  () => import("@/components/SchematicCanvas").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <p className="p-6 text-sm text-zinc-400">Loading schematic...</p>,
  },
);

export function SharedSchematicWrapper({
  circuitState,
  diagnostics,
}: {
  circuitState: CircuitState;
  diagnostics: Diagnostic[];
}) {
  return <SharedSchematic circuitState={circuitState} diagnostics={diagnostics} readOnly />;
}
