import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ToastProvider } from '@/hooks/useToast';
import { SocketProvider } from '@/hooks/useTranscodarrSocket';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: {
    default:  'Transcodarr',
    template: '%s | Transcodarr',
  },
  description: 'Zero-config intelligent media transcoding platform',
  icons: {
    icon:    '/favicon.svg',
    shortcut: '/favicon.svg',
    apple:   '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-background text-text min-h-screen flex selection:bg-primary/30">
        <ToastProvider>
          <SocketProvider>
            <AppShell>{children}</AppShell>
          </SocketProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
