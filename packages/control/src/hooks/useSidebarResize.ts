import { useState, useRef, useCallback } from 'react';

const STORAGE_PREFIX = 'krythor_sidebar_w_';

export function useSidebarResize(panelId: string, defaultWidth: number, min = 140, max = 520) {
  const stored = (() => {
    try {
      const v = localStorage.getItem(STORAGE_PREFIX + panelId);
      if (v) {
        const n = parseInt(v, 10);
        if (n >= min && n <= max) return n;
      }
    } catch { /* ignore */ }
    return defaultWidth;
  })();

  const [width, setWidth] = useState(stored);
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      setWidth(w => {
        const next = Math.min(max, Math.max(min, w + delta));
        try { localStorage.setItem(STORAGE_PREFIX + panelId, String(next)); } catch { /* ignore */ }
        return next;
      });
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelId, min, max]);

  return { width, onMouseDown };
}
