import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI as Workspace",
  description: "A unified workspace for Agent, OpenCode, and Pi runtimes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
