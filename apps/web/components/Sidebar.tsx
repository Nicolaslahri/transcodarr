'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListVideo, Cpu, FolderOpen, Settings, Activity } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ITEMS = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Queue', href: '/queue', icon: ListVideo },
  { name: 'Workers', href: '/workers', icon: Cpu },
  { name: 'Library', href: '/library', icon: FolderOpen },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-border bg-background flex flex-col">
      <div className="h-20 flex items-center px-8 gap-3">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,217,255,0.3)]">
          <Activity className="text-background w-5 h-5" />
        </div>
        <span className="font-bold text-lg tracking-wide text-white">Transcodarr</span>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group font-medium",
                isActive 
                  ? "bg-surface text-primary" 
                  : "text-textMuted hover:bg-surfaceHover hover:text-white"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors", 
                isActive ? "text-primary" : "text-textMuted group-hover:text-white"
              )} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-8">
        <div className="bg-surface rounded-xl p-4 border border-border/50">
          <div className="text-xs uppercase tracking-wider text-textMuted font-semibold mb-2">Engine Status</div>
          <div className="flex items-center gap-2 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Online
          </div>
        </div>
      </div>
    </aside>
  );
}
