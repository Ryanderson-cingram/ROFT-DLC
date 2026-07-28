import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROFT-DLC · 诸神降临 4.1",
  description: "UNO + 自制技能 DLC 的私房多人对局",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
