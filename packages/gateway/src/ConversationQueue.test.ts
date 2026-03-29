import { describe, it, expect, vi } from 'vitest';
import { ConversationQueue } from './ConversationQueue.js';
import type { QueueItem } from './ConversationQueue.js';

function makeItem(conversationId: string, text: string, agentId?: string): QueueItem {
  return { conversationId, text, agentId, enqueuedAt: Date.now() };
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('ConversationQueue', () => {

  it('processes items sequentially in followup mode', async () => {
    const order: string[] = [];
    const gate1 = defer();

    const queue = new ConversationQueue(async (item) => {
      if (item.text === 'first') await gate1.promise;
      order.push(item.text);
    }, 'followup');

    queue.enqueue(makeItem('c', 'first'));
    queue.enqueue(makeItem('c', 'second'));

    expect(order).toEqual([]); // nothing done yet
    gate1.resolve();

    // Wait for microtasks to drain
    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['first', 'second']);
  });

  it('steer mode replaces pending with latest', async () => {
    const processed: string[] = [];
    const gate = defer();

    const queue = new ConversationQueue(async (item) => {
      if (item.text === 'first') await gate.promise;
      processed.push(item.text);
    }, 'steer');

    queue.enqueue(makeItem('c', 'first'));
    // While 'first' is running, enqueue two more — only the last should run
    queue.enqueue(makeItem('c', 'second'));
    queue.enqueue(makeItem('c', 'third'));

    gate.resolve();
    await new Promise(r => setTimeout(r, 10));
    expect(processed).toEqual(['first', 'third']);
  });

  it('interrupt mode aborts active run', async () => {
    const processed: string[] = [];
    let aborted = false;
    const gate = defer();

    const queue = new ConversationQueue(async (item, signal) => {
      if (item.text === 'first') {
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { aborted = true; resolve(); });
          gate.promise.then(resolve);
        });
      }
      processed.push(item.text);
    }, 'interrupt');

    queue.enqueue(makeItem('c', 'first'));
    await new Promise(r => setTimeout(r, 1)); // let first start
    queue.enqueue(makeItem('c', 'override'));

    await new Promise(r => setTimeout(r, 20));
    expect(aborted).toBe(true);
    expect(processed).toContain('override');
  });

  it('collect mode merges messages sent during active run', async () => {
    const processed: string[] = [];
    const gate = defer();

    const queue = new ConversationQueue(async (item) => {
      if (item.text === 'first') await gate.promise;
      processed.push(item.text);
    }, 'collect');

    queue.enqueue(makeItem('c', 'first'));
    await new Promise(r => setTimeout(r, 1)); // let first start
    // These should be collected into a combined followup
    queue.enqueue(makeItem('c', 'a'));
    queue.enqueue(makeItem('c', 'b'));

    gate.resolve();
    await new Promise(r => setTimeout(r, 20));
    expect(processed[0]).toBe('first');
    expect(processed[1]).toBe('a\nb');
  });

  it('isolates different conversations', async () => {
    const processed: Array<{ id: string; text: string }> = [];

    const queue = new ConversationQueue(async (item) => {
      processed.push({ id: item.conversationId, text: item.text });
    }, 'followup');

    queue.enqueue(makeItem('conv-1', 'msg-1'));
    queue.enqueue(makeItem('conv-2', 'msg-2'));

    await new Promise(r => setTimeout(r, 10));
    expect(processed.map(p => p.id)).toContain('conv-1');
    expect(processed.map(p => p.id)).toContain('conv-2');
  });

  it('setMode changes mode for a conversation', () => {
    const queue = new ConversationQueue(async () => {}, 'steer');
    queue.setMode('c', 'followup');
    expect(queue.getMode('c')).toBe('followup');
  });

  it('pendingCount returns 0 when nothing queued', () => {
    const queue = new ConversationQueue(async () => {});
    expect(queue.pendingCount('unknown')).toBe(0);
  });

  it('clearPending removes queued items without aborting active run', async () => {
    const gate = defer();
    const processed: string[] = [];

    const queue = new ConversationQueue(async (item) => {
      if (item.text === 'first') await gate.promise;
      processed.push(item.text);
    }, 'followup');

    queue.enqueue(makeItem('c', 'first'));
    queue.enqueue(makeItem('c', 'second'));
    queue.enqueue(makeItem('c', 'third'));

    queue.clearPending('c');
    gate.resolve();
    await new Promise(r => setTimeout(r, 10));
    // 'first' was already running, 'second' and 'third' were cleared
    expect(processed).toEqual(['first']);
  });

  it('abortAll aborts active and clears pending', async () => {
    let aborted = false;
    const gate = defer();

    const queue = new ConversationQueue(async (item, signal) => {
      if (item.text === 'first') {
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { aborted = true; resolve(); });
          gate.promise.then(resolve);
        });
      }
    }, 'followup');

    queue.enqueue(makeItem('c', 'first'));
    queue.enqueue(makeItem('c', 'second'));
    await new Promise(r => setTimeout(r, 1));
    queue.abortAll('c');
    await new Promise(r => setTimeout(r, 10));
    expect(aborted).toBe(true);
    expect(queue.pendingCount('c')).toBe(0);
  });
});
