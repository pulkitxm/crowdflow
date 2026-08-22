import type { ReactNode } from "react";
import "../../src/tokens.css";
import "../../src/style.css";

export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="console-shell min-h-screen">{children}</div>;
}
