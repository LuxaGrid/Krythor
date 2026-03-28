/**
 * NotificationFeed — bell icon with dropdown showing real-time notifications.
 *
 * Listens for notification:* WS events:
 *   - notification:agent_run_failed
 *   - notification:circuit_open
 *   - notification:job_failed
 *
 * Shows a badge with unread count; clicking the bell opens a dropdown with
 * the last 50 notifications. Click any item or the "clear all" button to
 * dismiss.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGatewayContext } from '../GatewayContext.tsx';

export interface AppNotification {
  id: string;
  ts: number;
  type: 'agent_run_failed' | 'circuit_open' | 'job_failed';
  title: string;
  detail: string;
  read: boolean;
}

const MAX_NOTIFICATIONS = 50;

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function notificationFromEvent(type: string, payload: Record<string, unknown>): AppNotification | null {
  const id = (payload['id'] as string | undefined) ?? `nf_${Date.now()}`;
  const ts  = (payload['ts'] as number | undefined) ?? Date.now();

  switch (type) {
    case 'notification:agent_run_failed': {
      const agentName = (payload['agentName'] as string | undefined) ?? (payload['agentId'] as string | undefined) ?? 'Agent';
      const error     = (payload['error'] as string | undefined) ?? 'unknown error';
      return {
        id, ts,
        type: 'agent_run_failed',
        title: `Agent run failed — ${agentName}`,
        detail: error,
        read: false,
      };
    }
    case 'notification:circuit_open': {
      const providerId = (payload['providerId'] as string | undefined) ?? 'unknown';
      const failures   = (payload['failures'] as number | undefined) ?? 0;
      return {
        id, ts,
        type: 'circuit_open',
        title: `Circuit open — ${providerId}`,
        detail: `${failures} consecutive failure${failures !== 1 ? 's' : ''}`,
        read: false,
      };
    }
    case 'notification:job_failed': {
      const jobId = (payload['jobId'] as string | undefined) ?? 'unknown';
      const error = (payload['error'] as string | undefined) ?? 'unknown error';
      return {
        id, ts,
        type: 'job_failed',
        title: 'Job failed',
        detail: `${jobId.slice(0, 8)} — ${error}`,
        read: false,
      };
    }
    default:
      return null;
  }
}

function NotificationIcon({ type }: { type: AppNotification['type'] }) {
  switch (type) {
    case 'agent_run_failed': return <span className="text-red-400 shrink-0">!</span>;
    case 'circuit_open':     return <span className="text-amber-400 shrink-0">~</span>;
    case 'job_failed':       return <span className="text-orange-400 shrink-0">x</span>;
  }
}

export function NotificationFeed() {
  const { events } = useGatewayContext();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Track the last processed event id to avoid re-processing on re-renders
  const lastEventId = useRef<number>(-1);

  useEffect(() => {
    const latest = events[0];
    if (!latest || latest.id <= lastEventId.current) return;
    lastEventId.current = latest.id;

    if (!latest.type.startsWith('notification:')) return;
    const payload = (latest.payload ?? {}) as Record<string, unknown>;
    const notif = notificationFromEvent(latest.type, payload);
    if (!notif || seenIds.current.has(notif.id)) return;
    seenIds.current.add(notif.id);

    setNotifications(prev => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, [events]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    seenIds.current.clear();
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(o => {
      if (!o) {
        // Mark all read when opening
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
      return !o;
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        title="Notifications"
        className={`relative flex items-center justify-center w-7 h-7 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-brand-600/50
          ${open ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-500 hover:text-zinc-300'}`}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
      >
        {/* Bell icon (SVG) */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path d="M7 1a4 4 0 0 0-4 4v2.5L2 9h10l-1-1.5V5a4 4 0 0 0-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          <path d="M5.5 9v.5a1.5 1.5 0 0 0 3 0V9" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        </svg>
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-[3px] leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-1 z-[200] w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Notifications</span>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      mark read
                    </button>
                  )}
                  <button
                    onClick={clearAll}
                    className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    clear all
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-zinc-600 text-xs">
                No notifications
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-3 py-2.5 border-b border-zinc-800/60 last:border-0 flex gap-2.5 items-start ${n.read ? '' : 'bg-zinc-800/30'}`}
                >
                  <div className="mt-0.5 w-4 text-center text-xs font-bold font-mono">
                    <NotificationIcon type={n.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${n.read ? 'text-zinc-400' : 'text-zinc-200'}`}>
                      {n.title}
                    </p>
                    <p className="text-[10px] text-zinc-600 truncate mt-0.5">{n.detail}</p>
                  </div>
                  <span className="text-[10px] text-zinc-700 shrink-0 mt-0.5">{formatRelativeTime(n.ts)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
