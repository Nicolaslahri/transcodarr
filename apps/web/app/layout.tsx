import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { ToastProvider } from '@/hooks/useToast';
import { SocketProvider } from '@/hooks/useTranscodarrSocket';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Transcodarr',
  description: 'Zero-config intelligent media transcoding platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-background text-text min-h-screen flex selection:bg-primary/30">
        <ToastProvider>
          <SocketProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </SocketProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
