/**
 * WebChat — standalone embeddable chat component.
 *
 * Sends messages to POST /api/command using window.__KRYTHOR_TOKEN__.
 * Can be used standalone or embedded in other pages.
 * No full app wrapper, no routing — just a message list + input.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
}

function getToken(): string | undefined {
  const injected = (window as unknown as Record<string, unknown>)['__KRYTHOR_TOKEN__'];
  if (typeof injected === 'string' && injected.length > 0) return injected;
  try {
    const stored = localStorage.getItem('krythor_token');
    if (stored) return stored;
  } catch { /* private browsing */ }
  return undefined;
}

async function sendMessage(input: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/command', {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
  });
  const data = await res.json() as { output?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.output ?? '';
}

export function WebChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const output = await sendMessage(text);
      setMessages(prev => [...prev, { role: 'assistant', content: output, timestamp: Date.now() }]);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Request failed';
      setMessages(prev => [...prev, { role: 'error', content: errorText, timestamp: Date.now() }]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: 'system-ui, sans-serif',
      background: '#18181b',
      color: '#e4e4e7',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #27272a',
        fontSize: 13,
        fontWeight: 600,
        color: '#a1a1aa',
        letterSpacing: '0.05em',
      }}>
        KRYTHOR CHAT
      </div>

      {/* Message list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        {messages.length === 0 && (
          <p style={{ color: '#52525b', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
            Send a message to get started.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
          }}>
            <div style={{
              background: msg.role === 'user'
                ? '#2563eb'
                : msg.role === 'error'
                  ? '#450a0a'
                  : '#27272a',
              color: msg.role === 'error' ? '#fca5a5' : '#f4f4f5',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
            <p style={{ color: '#52525b', fontSize: 10, marginTop: 2,
              textAlign: msg.role === 'user' ? 'right' : 'left' }}>
              {msg.role === 'error' ? 'error' : msg.role} · {new Date(msg.timestamp).toLocaleTimeString()}
            </p>
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{
              background: '#27272a',
              color: '#71717a',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
            }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{
        borderTop: '1px solid #27272a',
        padding: '10px 12px',
        display: 'flex',
        gap: 8,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          disabled={sending}
          style={{
            flex: 1,
            background: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 13,
            color: '#f4f4f5',
            outline: 'none',
            opacity: sending ? 0.6 : 1,
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || !input.trim()}
          style={{
            background: sending || !input.trim() ? '#3f3f46' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '7px 14px',
            fontSize: 13,
            cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
