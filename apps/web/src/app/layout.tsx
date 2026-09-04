import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from './Header.js';

export const metadata: Metadata = {
  title: 'Forge',
  description: 'Build real backend apps and get graded automatically.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
