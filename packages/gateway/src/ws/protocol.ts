// ─── Gateway WebSocket Protocol ───────────────────────────────────────────────
//
// Typed frame definitions for the Gateway WS API.
//
// Wire format:
//   Requests:  { type: "req", id: string, method: string, params?: unknown }
//   Responses: { type: "res", id: string, ok: boolean, payload?: unknown, error?: string }
//   Events:    { type: "event", event: string, payload?: unknown, seq?: number, stateVersion?: number }
//
// First frame must be a req:connect frame. All other frames before the
// connect handshake completes are dropped with an error response.
//
// Connect handshake:
//   Client → { type:"req", id, method:"connect", params:{
//     auth?: { token: string },
//     device?: { deviceId: string, platform: string, deviceFamily: string, role?: "node"|"client" },
//     deviceToken?: string,       // previously-issued device token
//   }}
//   Server → { type:"res", id, ok:true, payload:{
//     hello: "ok",
//     gatewayId: string,
//     version: string,
//     deviceStatus: "approved"|"pending"|"auto_approved",
//     deviceToken?: string,       // issued when newly approved/auto-approved
//   }}
//   Server → (snapshot events: presence, health)
//
// After connect:
//   Standard req/res for methods: health, status, agent.run, agent.wait, send, etc.
//   Server pushes events: agent:event, heartbeat:event, etc.
//

import { randomBytes } from 'crypto';

// ── Frame types ──────────────────────────────────────────────────────────────

export interface ReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
}

export type WsFrame = ReqFrame | ResFrame | EventFrame;

// ── Device identity ──────────────────────────────────────────────────────────

export type DeviceRole = 'client' | 'node';

export interface DeviceIdentity {
  deviceId: string;
  platform: string;          // 'darwin' | 'win32' | 'linux' | 'ios' | 'android' | 'web'
  deviceFamily: string;      // 'desktop' | 'mobile' | 'headless' | 'browser'
  role: DeviceRole;
  caps?: string[];           // for role:node — capabilities like 'canvas.*', 'camera.*'
  commands?: string[];       // for role:node — commands the node can handle
}

// ── Connect params ────────────────────────────────────────────────────────────

export interface ConnectParams {
  auth?: { token: string };
  device?: DeviceIdentity;
  deviceToken?: string;
  /** Signature of the challenge nonce provided by the server in hello */
  challengeSignature?: string;
}

// ── Connect response payload ──────────────────────────────────────────────────

export type DeviceStatus = 'approved' | 'pending' | 'auto_approved' | 'no_device';

export interface ConnectPayload {
  hello: 'ok';
  gatewayId: string;
  version: string;
  deviceStatus: DeviceStatus;
  deviceToken?: string;
}

// ── Frame parsing helpers ─────────────────────────────────────────────────────

export function parseFrame(raw: string): ReqFrame | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed['type'] === 'req' && typeof parsed['id'] === 'string' && typeof parsed['method'] === 'string') {
      return { type: 'req', id: parsed['id'], method: parsed['method'], params: parsed['params'] };
    }
    // Client should not send res/event frames — but parse them anyway for logging
    return null;
  } catch {
    return null;
  }
}

export function makeRes(id: string, ok: boolean, payload?: unknown, error?: string): ResFrame {
  return { type: 'res', id, ok, ...(ok ? { payload } : { error }) };
}

export function makeEvent(event: string, payload?: unknown, seq?: number): EventFrame {
  return { type: 'event', event, payload, ...(seq !== undefined ? { seq } : {}) };
}

/** Generate a random nonce for the connect challenge. */
export function generateChallenge(): string {
  return randomBytes(16).toString('hex');
}
