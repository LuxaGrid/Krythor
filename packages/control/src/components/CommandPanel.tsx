import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  listConversations,
  createConversation,
  deleteConversation,
  updateConversation,
  pinConversation,
  archiveConversation,
  getMessages,
  deleteLastAssistantMessage,
  exportConversation,
  streamCommand,
  listAgents,
  listModels,
  type Conversation,
  type StreamEvent,
  type Health,
  type ModelInfo,
} from '../api.ts';
import { useAppConfig } from '../App.tsx';
import { ModelRecommendationBar, ModelSwitcher } from './ModelRecommendation.tsx';

type Tab = 'command' | 'agents' | 'memory' | 'models' | 'guard' | 'events';

interface Props {
  health: Health | null;
  onTabChange: (tab: Tab) => void;
  newChatRef?: MutableRefObject<(() => void) | null>;
}

// ── Local message type (includes in-progress streaming) ───────────────────

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  modelId?: string | null;
  selectionReason?: string | null;
  fallbackOccurred?: boolean;
  streaming?: boolean;
}

// ── Time grouping for sidebar ─────────────────────────────────────────────

function groupLabel(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const day = 86400000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return 'This Week';
  return 'Older';
}

// ── Copy button ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={copy}
      className="text-zinc-600 hover:text-zinc-400 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// ── Message timestamp ─────────────────────────────────────────────────────

function MessageTime({ ts }: { ts: number }) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const label = isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <span className="text-zinc-600 text-xs">{label}</span>;
}

// ── Message bubble ────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: LocalMessage;
  isLast: boolean;
  onRegenerate?: () => void;
}

function MessageBubble({ msg, isLast, onRegenerate }: MessageBubbleProps) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
      {/* Avatar */}
      {!isUser && (
        <img src="/logo.png" alt="K" className="w-7 h-7 rounded-full object-cover shrink-0 mt-1" />
      )}

      {/* Bubble */}
      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-zinc-700 text-zinc-100 rounded-tr-sm'
              : 'bg-zinc-800 text-zinc-200 rounded-tl-sm'
          }`}
        >
          {msg.streaming && msg.content === '' ? (
            <TypingIndicator />
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className ?? '');
                  const code = String(children).replace(/\n$/, '');
                  if (match) {
                    return (
                      <div className="relative my-2">
                        <div className="flex items-center justify-between bg-zinc-900 rounded-t px-3 py-1">
                          <span className="text-xs text-zinc-500">{match[1]}</span>
                          <CopyButton text={code} />
                        </div>
                        <SyntaxHighlighter
                          style={vscDarkPlus as Record<string, React.CSSProperties>}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ margin: 0, borderRadius: '0 0 4px 4px', fontSize: '0.8rem' }}
                        >
                          {code}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }
                  return (
                    <code
                      className="bg-zinc-900 text-brand-300 rounded px-1.5 py-0.5 text-xs font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p({ children }) {
                  return <p className="mb-2 last:mb-0">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>;
                },
                blockquote({ children }) {
                  return <blockquote className="border-l-2 border-zinc-600 pl-3 text-zinc-400 my-2">{children}</blockquote>;
                },
                h1({ children }) { return <h1 className="text-base font-semibold mb-2 mt-3">{children}</h1>; },
                h2({ children }) { return <h2 className="text-sm font-semibold mb-1.5 mt-2.5">{children}</h2>; },
                h3({ children }) { return <h3 className="text-sm font-medium mb-1 mt-2">{children}</h3>; },
                a({ href, children }) {
                  return <a href={href} className="text-brand-400 underline underline-offset-2 hover:text-brand-300" target="_blank" rel="noreferrer">{children}</a>;
                },
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
          {msg.streaming && msg.content !== '' && (
            <span className="inline-block w-1.5 h-4 bg-brand-500 ml-0.5 animate-pulse align-text-bottom" />
          )}
        </div>

        {/* Meta row */}
        <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <MessageTime ts={msg.createdAt} />
          {msg.modelId && <span className="text-zinc-700 text-xs">[{msg.modelId}]</span>}
          {!isUser && msg.selectionReason && !msg.streaming && (
            <span className="text-zinc-700 text-xs italic" title="Model selection reason">{msg.selectionReason}{msg.fallbackOccurred ? ' [fallback]' : ''}</span>
          )}
          {!isUser && (msg.modelId || msg.selectionReason) && !msg.streaming && (
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify({ model: msg.modelId, selectionReason: msg.selectionReason, fallbackOccurred: msg.fallbackOccurred }, null, 2))}
              className="text-zinc-700 hover:text-zinc-400 text-xs"
              title="Copy model info"
            >
              copy model info
            </button>
          )}
          {!msg.streaming && <CopyButton text={msg.content} />}
          {!isUser && isLast && !msg.streaming && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="text-zinc-600 hover:text-zinc-400 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700 transition-colors"
              title="Regenerate response"
            >
              regen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename, onPin, onArchive, showArchived, onToggleArchived }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);

  const handleExport = async (conv: Conversation, format: 'json' | 'markdown', e: React.MouseEvent) => {
    e.stopPropagation();
    setExportMenuId(null);
    try { await exportConversation(conv.id, format, conv.title); } catch { /* ignore */ }
  };

  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const commitEdit = (id: string) => {
    const title = editValue.trim();
    if (title) onRename(id, title);
    setEditingId(null);
  };

  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm(id);
  };

  const doDelete = (id: string) => {
    onDelete(id);
    setDeleteConfirm(null);
  };

  // Pinned conversations shown first; archived shown only when toggled
  const pinned   = conversations.filter(c => c.pinned && !c.archived);
  const archived = conversations.filter(c => c.archived);
  const unpinned = conversations.filter(c => !c.pinned && !c.archived);

  // Group unpinned (non-archived) by time
  const groups: Record<string, Conversation[]> = {};
  for (const conv of unpinned) {
    const label = groupLabel(conv.updatedAt);
    if (!groups[label]) groups[label] = [];
    groups[label]!.push(conv);
  }
  const groupOrder = ['Today', 'Yesterday', 'This Week', 'Older'];

  return (
    <div className="w-[220px] shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950">
      <div className="p-2 border-b border-zinc-800 flex flex-col gap-1">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
        >
          <span className="text-brand-400 text-sm leading-none">+</span>
          New Chat
        </button>
        <button
          onClick={onToggleArchived}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
            showArchived
              ? 'bg-zinc-700 text-zinc-300'
              : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60'
          }`}
        >
          <span className="text-[10px]">{showArchived ? '▾' : '▸'}</span>
          Archived
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversations.filter(c => !c.archived).length === 0 && !showArchived && (
          <p className="text-zinc-700 text-xs p-3 leading-relaxed">No conversations yet. Start one above.</p>
        )}
        {pinned.length > 0 && (
          <div>
            <p className="text-zinc-600 text-xs px-3 pt-3 pb-1 font-medium uppercase tracking-wide">Pinned</p>
            {pinned.map(conv => (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`group relative px-3 py-2 cursor-pointer flex items-center gap-1.5 text-xs border-l-2 transition-colors
                  ${activeId === conv.id
                    ? 'bg-zinc-800/80 border-brand-500 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
              >
                <span className="flex-1 truncate">{conv.title}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                  <button onClick={e => { e.stopPropagation(); onPin(conv.id, false); }}
                    className="text-amber-600 hover:text-amber-400 p-0.5 rounded" title="Unpin">📌</button>
                  <button onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
                    className="text-zinc-600 hover:text-red-400 p-0.5 rounded" title="Delete">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showArchived && archived.length > 0 && (
          <div>
            <p className="text-zinc-600 text-xs px-3 pt-3 pb-1 font-medium uppercase tracking-wide">Archived</p>
            {archived.map(conv => (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`px-3 py-2 cursor-pointer text-xs border-b border-zinc-800/30 group flex items-center gap-1 relative opacity-60 hover:opacity-100 transition-opacity ${
                  activeId === conv.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 transition-colors'
                }`}
              >
                <span className="flex-1 truncate italic">{conv.title}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); onArchive(conv.id, false); }}
                    className="text-indigo-400 hover:text-indigo-300 p-0.5 rounded text-[10px]"
                    title="Restore from archive"
                  >⊘</button>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
                    className="text-zinc-600 hover:text-red-400 p-0.5 rounded"
                    title="Delete permanently"
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showArchived && archived.length === 0 && (
          <p className="text-zinc-700 text-xs px-3 py-2">No archived conversations.</p>
        )}

        {groupOrder.map(label => {
          const items = groups[label];
          if (!items || items.length === 0) return null;
          return (
            <div key={label}>
              <p className="text-zinc-600 text-xs px-3 pt-3 pb-1 font-medium uppercase tracking-wide">{label}</p>
              {items.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`px-3 py-2 cursor-pointer text-xs border-b border-zinc-800/30 group flex items-center gap-1 relative ${
                    activeId === conv.id
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors'
                  }`}
                >
                  {editingId === conv.id ? (
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                        e.stopPropagation();
                      }}
                      onBlur={() => commitEdit(conv.id)}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                      className="flex-1 bg-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 outline-none text-xs"
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate">{conv.title}</span>
                      {deleteConfirm === conv.id ? (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => doDelete(conv.id)}
                            className="text-red-400 hover:text-red-300 text-xs px-1 py-0.5 rounded bg-red-950/40"
                          >del</button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-zinc-500 hover:text-zinc-300 text-xs"
                          >×</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0 relative">
                          {conv.pinned && (
                            <span className="text-amber-600 text-[9px] mr-0.5" title="Pinned">📌</span>
                          )}
                          <button
                            onClick={e => startEdit(conv, e)}
                            className="text-zinc-600 hover:text-zinc-300 p-0.5 rounded"
                            title="Rename"
                          >✎</button>
                          <button
                            onClick={e => { e.stopPropagation(); onPin(conv.id, !conv.pinned); }}
                            className={`p-0.5 rounded ${conv.pinned ? 'text-amber-600 hover:text-amber-400' : 'text-zinc-600 hover:text-amber-500'}`}
                            title={conv.pinned ? 'Unpin' : 'Pin'}
                          >📌</button>
                          <button
                            onClick={e => { e.stopPropagation(); onArchive(conv.id, !conv.archived); }}
                            className={`p-0.5 rounded text-[10px] ${conv.archived ? 'text-indigo-400 hover:text-indigo-300' : 'text-zinc-600 hover:text-indigo-400'}`}
                            title={conv.archived ? 'Restore from archive' : 'Archive'}
                          >{conv.archived ? '⊘' : '⊡'}</button>
                          <button
                            onClick={e => { e.stopPropagation(); setExportMenuId(id => id === conv.id ? null : conv.id); }}
                            className="text-zinc-600 hover:text-zinc-300 p-0.5 rounded"
                            title="Export"
                          >↓</button>
                          {exportMenuId === conv.id && (
                            <div
                              className="absolute top-full right-0 mt-0.5 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl text-xs min-w-[110px]"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                onClick={e => handleExport(conv, 'markdown', e)}
                                className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
                              >Markdown (.md)</button>
                              <button
                                onClick={e => handleExport(conv, 'json', e)}
                                className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
                              >JSON (.json)</button>
                            </div>
                          )}
                          <button
                            onClick={e => confirmDelete(conv.id, e)}
                            className="text-zinc-600 hover:text-red-400 p-0.5 rounded"
                            title="Delete"
                          >✕</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

// ── First-run welcome banner ──────────────────────────────────────────────

const FIRST_RUN_KEY = 'krythor_first_run_dismissed';

function FirstRunBanner({ onDismiss, onTabChange }: { onDismiss: () => void; onTabChange: (tab: Tab) => void }) {
  return (
    <div className="mx-auto max-w-md w-full bg-zinc-900 border border-zinc-700 rounded-xl p-6 text-center shadow-xl">
      <img src="/logo.png" alt="Krythor" className="w-16 h-16 object-contain mx-auto mb-4 opacity-90 drop-shadow-lg" />
      <h2 className="text-zinc-100 text-lg font-semibold tracking-wide mb-1">Krythor is running</h2>
      <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
        Everything runs locally on your machine.<br />
        No telemetry. No cloud storage. No accounts required.
      </p>
      <div className="flex flex-col gap-2 text-xs text-zinc-500 mb-5 text-left bg-zinc-950 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2"><span className="text-emerald-500">✓</span> Your data stays on your computer</div>
        <div className="flex items-center gap-2"><span className="text-emerald-500">✓</span> You can see which model ran every request</div>
        <div className="flex items-center gap-2"><span className="text-emerald-500">✓</span> Fallbacks and routing decisions are always visible</div>
        <div className="flex items-center gap-2"><span className="text-emerald-500">✓</span> No hidden behavior</div>
      </div>
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => { onTabChange('models'); onDismiss(); }}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors"
        >
          Add a provider
        </button>
        <button
          onClick={onDismiss}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
        >
          Run my first command
        </button>
      </div>
    </div>
  );
}

export function CommandPanel({ health, onTabChange, newChatRef }: Props) {
  const { config } = useAppConfig();

  const [conversations, setConversations]     = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId]       = useState<string | null>(null);
  const [messages, setMessages]               = useState<LocalMessage[]>([]);
  const [input, setInput]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [inputHistory, setInputHistory]       = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]           = useState(-1);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(config.selectedModel);
  const [showFirstRun, setShowFirstRun]       = useState(() => !localStorage.getItem(FIRST_RUN_KEY));
  const [showArchived, setShowArchived]       = useState(false);
  const abortRef                              = useRef<AbortController | null>(null);
  const bottomRef                             = useRef<HTMLDivElement>(null);
  const textareaRef                           = useRef<HTMLTextAreaElement>(null);

  const dismissFirstRun = useCallback(() => {
    localStorage.setItem(FIRST_RUN_KEY, '1');
    setShowFirstRun(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const noProvider = health ? health.models.providerCount === 0 : false;

  // Load available models for recommendation bar + switcher
  useEffect(() => {
    listModels().then(setAvailableModels).catch(() => {});
  }, [health?.models.modelCount]);

  // Load conversations (including archived when the toggle is on)
  const loadConversations = useCallback((includeArchived = showArchived) => {
    listConversations(includeArchived).then(setConversations).catch(() => {});
  }, [showArchived]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    getMessages(activeConvId).then(msgs => {
      setMessages(msgs.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        modelId: m.modelId,
      })));
    }).catch(() => {});
  }, [activeConvId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const handleNew = useCallback(async () => {
    // Validate that the selected agent still exists before wiring the conversation to it.
    let agentId = config.selectedAgentId;
    if (agentId) {
      const agents = await listAgents().catch(() => []);
      if (!agents.find(a => a.id === agentId)) agentId = undefined;
    }
    const conv = await createConversation(agentId);
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [config.selectedAgentId]);

  // Expose handleNew to parent via ref for global keyboard shortcut (Ctrl+N)
  useEffect(() => {
    if (newChatRef) newChatRef.current = handleNew;
    return () => { if (newChatRef) newChatRef.current = null; };
  }, [newChatRef, handleNew]);

  const handleSelect = (id: string) => {
    if (loading) return;
    setActiveConvId(id);
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id).catch(() => {});
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
  };

  const handlePin = async (id: string, pinned: boolean) => {
    try {
      const updated = await pinConversation(id, pinned);
      setConversations(prev => prev.map(c => c.id === id ? { ...c, pinned: updated.pinned } : c));
    } catch { /* non-fatal */ }
  };

  const handleArchive = async (id: string, archived: boolean) => {
    try {
      const updated = await archiveConversation(id, archived);
      setConversations(prev => {
        const next = prev.map(c => c.id === id ? { ...c, archived: updated.archived } : c);
        // If hiding archived and we just archived this one, and it's active — deselect
        if (archived && !showArchived && id === activeConvId) {
          setActiveConvId(null);
          setMessages([]);
        }
        return next;
      });
    } catch { /* non-fatal */ }
  };

  const handleToggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    loadConversations(next);
  };

  const handleRename = async (id: string, title: string) => {
    await updateConversation(id, title).catch(() => {});
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Mark last streaming message as done
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 && m.streaming ? { ...m, streaming: false } : m
    ));
    setLoading(false);
  };

  const submit = async (overrideInput?: string) => {
    const cmd = (overrideInput ?? input).trim();
    if (!cmd || loading) return;
    setInput('');
    setInputHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistoryIdx(-1);

    // Ensure we have an active conversation
    let convId = activeConvId;
    if (!convId) {
      try {
        // Validate selected agent still exists before attaching it to the conversation.
        let agentId = config.selectedAgentId;
        if (agentId) {
          const agents = await listAgents().catch(() => []);
          if (!agents.find(a => a.id === agentId)) agentId = undefined;
        }
        const conv = await createConversation(agentId);
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.id);
        convId = conv.id;
      } catch { /* ignore */ }
    }

    const userMsg: LocalMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: cmd,
      createdAt: Date.now(),
    };
    const assistantMsg: LocalMessage = {
      id: `local-asst-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let resolvedConvId = convId;

      await streamCommand(
        cmd,
        convId ?? undefined,
        config.selectedAgentId,
        selectedModelId ?? config.selectedModel,
        (event: StreamEvent) => {
          if (event.type === 'conversation') {
            resolvedConvId = event.conversationId;
            setActiveConvId(event.conversationId);
            // Update conversation list with new entry
            setConversations(prev => {
              const exists = prev.find(c => c.id === event.conversationId);
              if (!exists) {
                const newConv: Conversation = {
                  id: event.conversationId,
                  title: event.title,
                  agentId: config.selectedAgentId ?? null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                return [newConv, ...prev];
              }
              return prev.map(c => c.id === event.conversationId ? { ...c, title: event.title } : c);
            });
          } else if (event.type === 'done') {
            if (event.conversationId && !resolvedConvId) {
              setActiveConvId(event.conversationId);
            }
            const finalConvId = event.conversationId ?? resolvedConvId;
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 && m.streaming
                ? { ...m, content: event.output, streaming: false, modelId: event.modelUsed ?? null, selectionReason: event.selectionReason ?? null, fallbackOccurred: event.fallbackOccurred ?? false }
                : m
            ));
            // Refresh conversation list to update updatedAt / title
            if (finalConvId) {
              listConversations().then(setConversations).catch(() => {});
            }
          } else if (event.type === 'error') {
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 && m.streaming
                ? { ...m, content: `Error: ${event.message}`, streaming: false }
                : m
            ));
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 && m.streaming
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : 'Request failed'}`, streaming: false }
            : m
        ));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleRegenerate = async () => {
    if (!activeConvId) return;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    // Remove the last assistant message from the DB so the model doesn't see
    // the bad response as part of history on the re-submission.
    await deleteLastAssistantMessage(activeConvId).catch(() => {});
    setMessages(prev => {
      const idx = prev.length - 1;
      if (prev[idx]?.role === 'assistant') return prev.slice(0, idx);
      return prev;
    });
    await submit(lastUser.content);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      if (input === '' || historyIdx >= 0) {
        e.preventDefault();
        const nextIdx = Math.min(historyIdx + 1, inputHistory.length - 1);
        if (nextIdx >= 0) {
          setHistoryIdx(nextIdx);
          setInput(inputHistory[nextIdx] ?? '');
        }
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && historyIdx >= 0) {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      setInput(nextIdx >= 0 ? (inputHistory[nextIdx] ?? '') : '');
    }
  };

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') return i;
    }
    return -1;
  })();

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        onPin={handlePin}
        onArchive={handleArchive}
        showArchived={showArchived}
        onToggleArchived={handleToggleArchived}
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* No-provider banner */}
        {noProvider && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-950/60 border-b border-amber-800/50 text-xs shrink-0">
            <span className="text-amber-400 font-medium">No AI provider configured</span>
            <span className="text-amber-700">—</span>
            <button
              onClick={() => onTabChange('models')}
              className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
            >
              Add a provider in the Models tab
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6 space-y-6">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              {showFirstRun ? (
                <FirstRunBanner onDismiss={dismissFirstRun} onTabChange={onTabChange} />
              ) : (
                <>
                  <img src="/logo.png" alt="Krythor" className="w-20 h-20 object-contain drop-shadow-lg opacity-90" />
                  <p className="text-zinc-400 text-sm">How can I help you today?</p>
                  <p className="text-zinc-600 text-xs">
                    {activeConvId ? 'Continue the conversation below.' : 'Start a new chat or select one from the sidebar.'}
                  </p>
                  {!config.selectedAgentId && (
                    <p className="text-zinc-700 text-xs">
                      Tip:{' '}
                      <button onClick={() => onTabChange('agents')} className="text-zinc-500 underline underline-offset-2 hover:text-zinc-400">
                        select an agent
                      </button>{' '}
                      for memory-aware responses.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isLast={i === lastAssistantIdx}
              onRegenerate={i === lastAssistantIdx ? handleRegenerate : undefined}
            />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-800 px-4 py-3 shrink-0 bg-zinc-950">
          {/* Inline model recommendation bar */}
          {!noProvider && (
            <ModelRecommendationBar
              inputText={input}
              selectedModelId={selectedModelId}
              onAccept={(modelId, _providerId) => setSelectedModelId(modelId)}
              className="mb-2"
            />
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => { setInput(e.target.value); setHistoryIdx(-1); }}
              onKeyDown={onKeyDown}
              disabled={loading && !abortRef.current}
              placeholder={noProvider ? 'Add a provider to start…' : 'Message Krythor… (Enter to send, Shift+Enter for new line)'}
              rows={1}
              className="flex-1 bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-none font-mono leading-relaxed overflow-hidden focus:ring-1 focus:ring-brand-700 transition-all"
              autoFocus
            />
            {loading ? (
              <button
                onClick={stop}
                className="px-3 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-xl shrink-0 transition-colors"
                title="Stop generation"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={!input.trim() || noProvider}
                className="px-3 py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white text-xs rounded-xl shrink-0 transition-colors"
              >
                Send
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mt-1.5 px-1">
            <p className="text-zinc-700 text-xs">Enter to send · Shift+Enter for newline</p>
            {availableModels.length > 1 && (
              <ModelSwitcher
                selectedModelId={selectedModelId}
                models={availableModels}
                onChange={(modelId) => setSelectedModelId(modelId)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
