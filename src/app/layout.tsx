import type { Metadata } from "next";
import "../../web/styles/app.css";

export const metadata: Metadata = {
  title: "AI Workspace",
  description: "Project and cross-project AI workspace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
