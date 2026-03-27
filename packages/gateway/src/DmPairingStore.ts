// ─── DmPairingStore ────────────────────────────────────────────────────────────
//
// Manages DM pairing requests and approved sender allowlists for all channels.
//
// Pairing flow:
//   1. Unknown sender messages a channel with dmPolicy: 'pairing'
//   2. DmPairingStore.requestPairing(channel, senderId) → returns an 8-char code
//   3. Bot replies to sender with the code
//   4. Owner calls approvePairing(channel, code) via UI/API
//   5. Sender is added to the allowlist, future messages pass through
//
// Codes: 8 uppercase chars, no ambiguous chars (0 O 1 I)
// Expiry: 1 hour
// Pending cap: 3 per channel (additional requests ignored until one expires/approved)
// State persisted to <dataDir>/pairing/<channel>-pairing.json
// Allowlist persisted to <dataDir>/pairing/<channel>-allowFrom.json
//

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const PENDING_CAP = 3;
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// No ambiguous chars (0, O, 1, I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PendingPairingRequest {
  code: string;
  senderId: string;
  senderName?: string;
  requestedAt: number;
  expiresAt: number;
  channel: string;
}

interface ChannelState {
  pending: PendingPairingRequest[];
  allowlist: string[];
}

export class DmPairingStore {
  private readonly dataDir: string;
  private readonly state = new Map<string, ChannelState>();

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.dataDir = dataDir;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request a pairing code for a sender on a channel.
   * Returns null if the channel is at the pending cap or the sender already
   * has a pending request or is already on the allowlist.
   */
  requestPairing(
    channel: string,
    senderId: string,
    senderName?: string,
  ): { code: string; expiresAt: number } | null {
    this.loadChannel(channel);
    this.purgeExpired(channel);

    const st = this.state.get(channel)!;

    // Already allowed
    if (st.allowlist.includes(senderId)) return null;

    // Already has a pending request
    if (st.pending.some(p => p.senderId === senderId)) return null;

    // At cap
    if (st.pending.length >= PENDING_CAP) return null;

    const code = this.generateCode();
    const now = Date.now();
    const req: PendingPairingRequest = {
      code,
      senderId,
      senderName,
      requestedAt: now,
      expiresAt: now + EXPIRY_MS,
      channel,
    };

    st.pending.push(req);
    this.saveChannel(channel);

    return { code, expiresAt: req.expiresAt };
  }

  /**
   * Approve a pairing code.
   * Moves the sender from pending to the allowlist.
   */
  approvePairing(
    channel: string,
    code: string,
  ): { ok: boolean; senderId?: string; error?: string } {
    this.loadChannel(channel);
    this.purgeExpired(channel);

    const st = this.state.get(channel)!;
    const idx = st.pending.findIndex(p => p.code === code);

    if (idx === -1) {
      return { ok: false, error: 'Pairing code not found or expired' };
    }

    const req = st.pending[idx]!;
    st.pending.splice(idx, 1);

    if (!st.allowlist.includes(req.senderId)) {
      st.allowlist.push(req.senderId);
    }

    this.saveChannel(channel);
    return { ok: true, senderId: req.senderId };
  }

  /**
   * Deny (remove) a pending pairing request by code.
   */
  denyPairing(
    channel: string,
    code: string,
  ): { ok: boolean; error?: string } {
    this.loadChannel(channel);

    const st = this.state.get(channel)!;
    const idx = st.pending.findIndex(p => p.code === code);

    if (idx === -1) {
      return { ok: false, error: 'Pairing code not found' };
    }

    st.pending.splice(idx, 1);
    this.saveChannel(channel);
    return { ok: true };
  }

  /**
   * List all non-expired pending requests for a channel.
   */
  listPending(channel: string): PendingPairingRequest[] {
    this.loadChannel(channel);
    this.purgeExpired(channel);
    return [...this.state.get(channel)!.pending];
  }

  /**
   * Check whether a sender is on the allowlist for a channel.
   */
  isAllowed(channel: string, senderId: string): boolean {
    this.loadChannel(channel);
    return this.state.get(channel)!.allowlist.includes(senderId);
  }

  /**
   * Directly add a sender to the allowlist (for dmPolicy: 'allowlist' pre-configuration).
   */
  addToAllowlist(channel: string, senderId: string): void {
    this.loadChannel(channel);
    const st = this.state.get(channel)!;
    if (!st.allowlist.includes(senderId)) {
      st.allowlist.push(senderId);
      this.saveChannel(channel);
    }
  }

  /**
   * Remove a sender from the allowlist.
   */
  removeFromAllowlist(channel: string, senderId: string): void {
    this.loadChannel(channel);
    const st = this.state.get(channel)!;
    const idx = st.allowlist.indexOf(senderId);
    if (idx !== -1) {
      st.allowlist.splice(idx, 1);
      this.saveChannel(channel);
    }
  }

  /**
   * List all senders on the allowlist for a channel.
   */
  listAllowlist(channel: string): string[] {
    this.loadChannel(channel);
    return [...this.state.get(channel)!.allowlist];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private loadChannel(channel: string): void {
    if (this.state.has(channel)) return;

    const pendingPath = join(this.dataDir, `${channel}-pairing.json`);
    const allowPath   = join(this.dataDir, `${channel}-allowFrom.json`);

    let pending: PendingPairingRequest[] = [];
    let allowlist: string[] = [];

    if (existsSync(pendingPath)) {
      try {
        const raw = readFileSync(pendingPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) pending = parsed as PendingPairingRequest[];
      } catch { /* corrupt file — start fresh */ }
    }

    if (existsSync(allowPath)) {
      try {
        const raw = readFileSync(allowPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allowlist = parsed as string[];
      } catch { /* corrupt file — start fresh */ }
    }

    this.state.set(channel, { pending, allowlist });
  }

  private saveChannel(channel: string): void {
    const st = this.state.get(channel);
    if (!st) return;

    const pendingPath = join(this.dataDir, `${channel}-pairing.json`);
    const allowPath   = join(this.dataDir, `${channel}-allowFrom.json`);

    writeFileSync(pendingPath, JSON.stringify(st.pending, null, 2), 'utf-8');
    writeFileSync(allowPath,   JSON.stringify(st.allowlist, null, 2), 'utf-8');
  }

  private purgeExpired(channel: string): void {
    const st = this.state.get(channel);
    if (!st) return;

    const now = Date.now();
    const before = st.pending.length;
    st.pending = st.pending.filter(p => p.expiresAt > now);

    if (st.pending.length !== before) {
      this.saveChannel(channel);
    }
  }

  private generateCode(): string {
    // Use crypto.randomBytes for secure randomness — not Math.random
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += CODE_CHARS[bytes[i]! % CODE_CHARS.length];
    }
    return code;
  }
}
