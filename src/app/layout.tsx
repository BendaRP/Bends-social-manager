import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מנהל הסושיאל",
  description: "ניהול, תזמון וניתוח ביצועים לאינסטגרם, פייסבוק וטיקטוק",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // dir="rtl" on the root makes every Tailwind logical utility mirror.
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router
            has no pages/_document; this link in the root layout is the correct place. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
