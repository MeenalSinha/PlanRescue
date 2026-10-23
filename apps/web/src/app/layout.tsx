import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'PlanRescue — your day changed, your assistant has a plan',
  icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232457c5'/%3E%3Ctext x='16' y='23' font-size='20' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'%3EP%3C/text%3E%3C/svg%3E" },
  description: 'Explore schedule disruptions, compare validated recovery plans and verify them, powered by the PlanRescue MCP server.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
