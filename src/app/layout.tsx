import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTKkviz",
  description: "Magyar korozott szemelyek kvize",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
