import * as React from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="text-sm font-semibold tracking-tight">Your App</div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-neutral-500">
          Built with Next.js + Firebase Hosting
        </div>
      </footer>
    </div>
  );
}
