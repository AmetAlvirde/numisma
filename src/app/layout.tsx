import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/utils/auth"; // Adjust path if needed
import { NextAuthProvider } from "@/components/providers/session-provider";
import { TrpcProvider } from "@/trpc/Provider";
import { ThemeProvider as NextThemesProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Numisma",
  description: "Your financial management platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextThemesProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TrpcProvider>
            <NextAuthProvider session={session}>{children}</NextAuthProvider>
          </TrpcProvider>
        </NextThemesProvider>
      </body>
    </html>
  );
}
