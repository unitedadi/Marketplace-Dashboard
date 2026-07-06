import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marketplace Dashboard",
  description: "DarDoc marketplace operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
