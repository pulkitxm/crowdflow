import type { Metadata } from "next";
import { SimulatorConsole } from "./simulator-console";

export const metadata: Metadata = {
  title: "Race Day Simulator",
};

export default function SimulatorPage() {
  return <SimulatorConsole />;
}
