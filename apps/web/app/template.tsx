'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function Template({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(containerRef.current, {
        opacity: 0,
        y: 10,
        duration: 0.4,
        ease: 'power2.out',
      });
    });

    return () => ctx.revert();
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
