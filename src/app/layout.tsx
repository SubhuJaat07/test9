import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Verify Scanner',
  description: 'Automated number verification scanner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
