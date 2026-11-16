import PinCheckApp from "./PinCheckApp";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  let initialCircuitCount: number | null = null;
  try {
    // Optional initial data load to demonstrate prisma integration on the server page.
    initialCircuitCount = await prisma.circuit.count();
  } catch {
    // Database may not be initialized in all environments; app remains fully functional.
    initialCircuitCount = null;
  }

  return <PinCheckApp initialCircuitCount={initialCircuitCount} />;
}
