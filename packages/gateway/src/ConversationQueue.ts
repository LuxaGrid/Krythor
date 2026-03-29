// ─── ConversationQueue ───────────────────────────────────────────────────────
//
// Per-conversation message queue with configurable processing modes.
//
// Queue modes:
//   steer       — (default) New message interrupts current run and steers it.
//                 The queued item replaces any pending item. Only one item waits.
//   followup    — New messages enqueue behind the active run (FIFO).
//                 All messages are processed in order.
//   collect     — Like steer, but accumulates all incoming text while a run is
//                 active and flushes the combined text as a single followup.
//   interrupt   — New message aborts the active run immediately and starts fresh.
//                 Useful for urgent override messages.
//
// Each conversation has an independent queue. The queue calls an async handler
// for each item, serialising runs within a conversation while allowing
// different conversations to run concurrently.
//

export type QueueMode = 'steer' | 'followup' | 'collect' | 'interrupt';

export interface QueueItem {
  conversationId: string;
  text: string;
  agentId?: string;
  /** Timestamp when this item was enqueued. */
  enqueuedAt: number;
}

export type QueueHandler = (item: QueueItem, signal: AbortSignal) => Promise<void>;

interface ConversationState {
  mode: QueueMode;
  /** Currently-running item, if any */
  running: boolean;
  /** AbortController for the active run */
  activeAbort: AbortController | null;
  /** Queue for 'followup' mode */
  queue: QueueItem[];
  /** Pending steering message (replaces previous pending) for 'steer' mode */
  pending: QueueItem | null;
  /** Accumulated text buffer for 'collect' mode */
  collectBuffer: string[];
}

export class ConversationQueue {
  private readonly states = new Map<string, ConversationState>();
  private readonly handler: QueueHandler;
  private readonly defaultMode: QueueMode;

  constructor(handler: QueueHandler, defaultMode: QueueMode = 'steer') {
    this.handler = handler;
    this.defaultMode = defaultMode;
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  setMode(conversationId: string, mode: QueueMode): void {
    const state = this.getOrCreate(conversationId);
    state.mode = mode;
  }

  getMode(conversationId: string): QueueMode {
    return this.states.get(conversationId)?.mode ?? this.defaultMode;
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────

  enqueue(item: QueueItem): void {
    const state = this.getOrCreate(item.conversationId);

    switch (state.mode) {
      case 'steer':
        this.enqueueSteer(state, item);
        break;
      case 'followup':
        this.enqueueFollowup(state, item);
        break;
      case 'collect':
        this.enqueueCollect(state, item);
        break;
      case 'interrupt':
        this.enqueueInterrupt(state, item);
        break;
    }
  }

  // ── Drain ────────────────────────────────────────────────────────────────

  /** Number of pending (not-yet-started) items for a conversation. */
  pendingCount(conversationId: string): number {
    const state = this.states.get(conversationId);
    if (!state) return 0;
    return state.queue.length + (state.pending ? 1 : 0) + state.collectBuffer.length;
  }

  /** Whether a run is currently active for a conversation. */
  isRunning(conversationId: string): boolean {
    return this.states.get(conversationId)?.running ?? false;
  }

  /** Cancel all pending items for a conversation without aborting the active run. */
  clearPending(conversationId: string): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    state.queue.length = 0;
    state.pending = null;
    state.collectBuffer.length = 0;
  }

  /** Abort the active run and clear pending items. */
  abortAll(conversationId: string): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    state.activeAbort?.abort();
    this.clearPending(conversationId);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private getOrCreate(conversationId: string): ConversationState {
    let state = this.states.get(conversationId);
    if (!state) {
      state = {
        mode:          this.defaultMode,
        running:       false,
        activeAbort:   null,
        queue:         [],
        pending:       null,
        collectBuffer: [],
      };
      this.states.set(conversationId, state);
    }
    return state;
  }

  private enqueueSteer(state: ConversationState, item: QueueItem): void {
    // Replace any pending item — only the latest matters
    state.pending = item;
    if (!state.running) this.drain(item.conversationId, state);
  }

  private enqueueFollowup(state: ConversationState, item: QueueItem): void {
    state.queue.push(item);
    if (!state.running) this.drain(item.conversationId, state);
  }

  private enqueueCollect(state: ConversationState, item: QueueItem): void {
    if (state.running) {
      // Accumulate while a run is active
      state.collectBuffer.push(item.text);
    } else {
      state.queue.push(item);
      this.drain(item.conversationId, state);
    }
  }

  private enqueueInterrupt(state: ConversationState, item: QueueItem): void {
    if (state.running) {
      // Abort active run, replace pending
      state.activeAbort?.abort();
      state.queue.length = 0;
    }
    state.pending = item;
    if (!state.running) this.drain(item.conversationId, state);
  }

  private drain(conversationId: string, state: ConversationState): void {
    if (state.running) return;

    let next: QueueItem | null = null;

    if (state.mode === 'steer' || state.mode === 'interrupt') {
      next = state.pending;
      state.pending = null;
    } else if (state.mode === 'followup' || state.mode === 'collect') {
      next = state.queue.shift() ?? null;
    }

    if (!next) return;

    state.running = true;
    state.activeAbort = new AbortController();

    void this.handler(next, state.activeAbort.signal).finally(() => {
      state.running = false;
      state.activeAbort = null;

      // In collect mode, if we accumulated text during this run, create a followup
      if (state.mode === 'collect' && state.collectBuffer.length > 0) {
        const combined = state.collectBuffer.join('\n');
        state.collectBuffer.length = 0;
        state.queue.push({
          conversationId,
          text: combined,
          enqueuedAt: Date.now(),
        });
      }

      this.drain(conversationId, state);
    });
  }
}
