import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MixpanelProvider } from '@/lib/mixpanel';
import { Auth0Provider } from '@/lib/auth0-provider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Conduit',
  description: 'AI-powered file system assistant',
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml' },
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <MixpanelProvider />
        <Auth0Provider>
          <TooltipProvider>{children}</TooltipProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}