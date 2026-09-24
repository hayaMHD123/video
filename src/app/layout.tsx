import type { Metadata } from "next";
import "@fontsource-variable/cairo/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "حكايا | استوديو الفيديو التعليمي",
  description: "خطط لحلقتك التعليمية، أنشئ برومبتات الصور، وركّب فيديو جاهزاً للنشر.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
