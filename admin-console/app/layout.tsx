import type { Metadata } from "next";
import "./globals.css";

import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Stitch Wish Operator Console",
  description:
    "Publish and manage Official Patterns, Staff Picks, and Catalog Tags for Stitch Wish.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
