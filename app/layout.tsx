import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// Leaflet's base stylesheet is required for pane positioning and tile transforms.
// It must be imported here (module-scope CSS) — not inside the dynamic import in
// LeafletGameMap.tsx, since that module only loads in the browser after hydration.
// It is imported unconditionally so the keyless fallback provider is styled even
// when Google Maps is the one actually rendering.
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Providers, SecureContextBanner } from "@/components/Providers";
import { TopNav } from "@/components/TopNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FaithQuest — Web",
  description:
    "A location-based scripture scavenger hunt. Explore real landmarks, solve ancient puzzles, and grow in the faith.",
};

// Viewport must be a separate export: Next ignores `viewport` inside
// `metadata` and warns about it (the app's mobile layout width and scaling
// then depend on the browser fallback — ~980px on mobile Safari).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <div className="appShell">
            <TopNav />
            <SecureContextBanner />
            <main className="appMain">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
