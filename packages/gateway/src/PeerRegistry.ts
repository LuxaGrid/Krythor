import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createSocket } from 'dgram';
import { logger } from './logger.js';

// ─── Peer types ───────────────────────────────────────────────────────────────

export interface Peer {
  id: string;
  /** User-assigned friendly name */
  name: string;
  /** Base URL of the remote gateway, e.g. http://192.168.1.10:47200 */
  url: string;
  /** Remote gateway's stable UUID (from /api/gateway/info) */
  gatewayId?: string;
  /** Remote Krythor version */
  version?: string;
  /** Remote platform */
  platform?: string;
  /** Remote capabilities */
  capabilities?: string[];
  /** How this peer was added */
  source: 'manual' | 'mdns' | 'auto';
  /** Auth token for the remote gateway (optional — stored unencrypted for now) */
  authToken?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastHealthAt?: string;
  healthy?: boolean;
  latencyMs?: number;
}

// ─── mDNS constants ───────────────────────────────────────────────────────────
// Simple UDP multicast announcement — not full DNS-SD, but sufficient for LAN
// discovery without any external dependencies.

const MDNS_MULTICAST_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const ANNOUNCE_INTERVAL_MS = 30_000;  // announce every 30 seconds
const HEALTH_CHECK_INTERVAL_MS = 60_000; // health check every 60 seconds
const PEER_STALE_MS = 5 * 60_000; // remove auto-discovered peers not seen in 5 minutes

// ─── PeerRegistry ─────────────────────────────────────────────────────────────

export class PeerRegistry {
  private configPath: string;
  private peers: Map<string, Peer> = new Map();
  private gatewayId: string;
  private gatewayPort: number;
  private gatewayVersion: string;

  private announceSocket: ReturnType<typeof createSocket> | null = null;
  private listenSocket: ReturnType<typeof createSocket> | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(configDir: string, gatewayId: string, gatewayPort: number, gatewayVersion: string) {
    this.configPath = join(configDir, 'peers.json');
    this.gatewayId = gatewayId;
    this.gatewayPort = gatewayPort;
    this.gatewayVersion = gatewayVersion;
    this.load();
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  list(): Peer[] {
    return Array.from(this.peers.values());
  }

  get(id: string): Peer | undefined {
    return this.peers.get(id);
  }

  add(input: { name: string; url: string; authToken?: string }): Peer {
    // Validate URL
    const parsed = new URL(input.url); // throws if invalid
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Peer URL must use http or https');
    }

    const peer: Peer = {
      id:        randomUUID(),
      name:      input.name,
      url:       input.url.replace(/\/+$/, ''), // strip trailing slash
      authToken: input.authToken,
      source:    'manual',
      isEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.peers.set(peer.id, peer);
    this.save();

    // Probe the new peer immediately
    void this.probePeer(peer);

    return peer;
  }

  update(id: string, patch: Partial<Pick<Peer, 'name' | 'url' | 'authToken' | 'isEnabled'>>): Peer {
    const existing = this.peers.get(id);
    if (!existing) throw new Error(`Peer not found: ${id}`);
    const updated: Peer = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.peers.set(id, updated);
    this.save();
    return updated;
  }

  remove(id: string): void {
    if (!this.peers.has(id)) throw new Error(`Peer not found: ${id}`);
    this.peers.delete(id);
    this.save();
  }

  // ── Health check ──────────────────────────────────────────────────────────────

  async probe(id: string): Promise<{ healthy: boolean; latencyMs: number; info?: Record<string, unknown> }> {
    const peer = this.peers.get(id);
    if (!peer) throw new Error(`Peer not found: ${id}`);
    return this.probePeer(peer);
  }

  private async probePeer(peer: Peer): Promise<{ healthy: boolean; latencyMs: number; info?: Record<string, unknown> }> {
    const start = Date.now();
    const headers: Record<string, string> = { 'User-Agent': 'Krythor-PeerRegistry/1.0' };
    if (peer.authToken) headers['Authorization'] = `Bearer ${peer.authToken}`;

    try {
      const resp = await fetch(`${peer.url}/api/gateway/info`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      const latencyMs = Date.now() - start;
      if (!resp.ok) {
        this.updatePeerHealth(peer.id, false, latencyMs);
        return { healthy: false, latencyMs };
      }

      const info = await resp.json() as Record<string, unknown>;
      this.peers.set(peer.id, {
        ...peer,
        gatewayId:    String(info['gatewayId'] ?? peer.gatewayId ?? ''),
        version:      String(info['version'] ?? ''),
        platform:     String(info['platform'] ?? ''),
        capabilities: Array.isArray(info['capabilities']) ? info['capabilities'] as string[] : [],
        lastSeenAt:   new Date().toISOString(),
        lastHealthAt: new Date().toISOString(),
        healthy:      true,
        latencyMs,
        updatedAt:    new Date().toISOString(),
      });
      this.save();
      return { healthy: true, latencyMs, info };
    } catch {
      const latencyMs = Date.now() - start;
      this.updatePeerHealth(peer.id, false, latencyMs);
      return { healthy: false, latencyMs };
    }
  }

  private updatePeerHealth(id: string, healthy: boolean, latencyMs: number): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.set(id, { ...peer, healthy, latencyMs, lastHealthAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    this.save();
  }

  // ── mDNS LAN discovery ────────────────────────────────────────────────────────
  //
  // We use a simple proprietary UDP multicast protocol — not full DNS-SD.
  // Announcement message: JSON on port 5353 multicast group 224.0.0.251.
  // Format: { type: 'krythor-announce', gatewayId, port, version }
  //
  // Any gateway that hears an announce from a *different* gatewayId will probe
  // that peer's HTTP endpoint and register it as a 'mdns' source peer.
  //

  startDiscovery(bindAddress = '0.0.0.0'): void {
    if (process.env['NODE_ENV'] === 'test') return; // no UDP sockets in tests

    this.startAnnouncing(bindAddress);
    this.startListening(bindAddress);
    this.startHealthChecks();
  }

  stopDiscovery(): void {
    if (this.announceTimer) { clearInterval(this.announceTimer); this.announceTimer = null; }
    if (this.healthTimer)   { clearInterval(this.healthTimer);   this.healthTimer = null;   }
    try { this.announceSocket?.close(); } catch {}
    try { this.listenSocket?.close();   } catch {}
    this.announceSocket = null;
    this.listenSocket   = null;
  }

  private buildAnnounceMessage(): Buffer {
    return Buffer.from(JSON.stringify({
      type:      'krythor-announce',
      gatewayId: this.gatewayId,
      port:      this.gatewayPort,
      version:   this.gatewayVersion,
    }));
  }

  private startAnnouncing(bindAddress: string): void {
    try {
      const sock = createSocket({ type: 'udp4', reuseAddr: true });
      sock.bind(0, bindAddress, () => {
        sock.setMulticastTTL(128);
        const msg = this.buildAnnounceMessage();
        const send = () => sock.send(msg, 0, msg.length, MDNS_PORT, MDNS_MULTICAST_ADDR);
        send();
        this.announceTimer = setInterval(send, ANNOUNCE_INTERVAL_MS);
      });
      sock.on('error', err => logger.warn('mDNS announce socket error', { error: String(err) }));
      this.announceSocket = sock;
    } catch (err) {
      logger.warn('mDNS announce start failed', { error: String(err) });
    }
  }

  private startListening(bindAddress: string): void {
    try {
      const sock = createSocket({ type: 'udp4', reuseAddr: true });
      sock.bind(MDNS_PORT, bindAddress, () => {
        try { sock.addMembership(MDNS_MULTICAST_ADDR); } catch {}
      });

      sock.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString()) as Record<string, unknown>;
          if (data['type'] !== 'krythor-announce') return;
          if (data['gatewayId'] === this.gatewayId) return; // ourselves

          const remoteGatewayId = String(data['gatewayId'] ?? '');
          const remotePort = Number(data['port'] ?? this.gatewayPort);
          const remoteUrl = `http://${rinfo.address}:${remotePort}`;

          // Check if we already have this peer (by gatewayId or URL)
          const existing = Array.from(this.peers.values()).find(
            p => p.gatewayId === remoteGatewayId || p.url === remoteUrl,
          );

          if (existing) {
            // Update lastSeenAt
            this.peers.set(existing.id, { ...existing, lastSeenAt: new Date().toISOString() });
            this.save();
          } else {
            // New peer discovered — auto-register and probe
            const peer: Peer = {
              id:        randomUUID(),
              name:      `Gateway ${rinfo.address}:${remotePort}`,
              url:       remoteUrl,
              gatewayId: remoteGatewayId,
              source:    'mdns',
              isEnabled: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
            };
            this.peers.set(peer.id, peer);
            this.save();
            logger.info('mDNS peer discovered', { gatewayId: remoteGatewayId, url: remoteUrl });
            void this.probePeer(peer);
          }
        } catch { /* malformed announce — ignore */ }
      });

      sock.on('error', err => logger.warn('mDNS listen socket error', { error: String(err) }));
      this.listenSocket = sock;
    } catch (err) {
      logger.warn('mDNS listen start failed', { error: String(err) });
    }
  }

  private startHealthChecks(): void {
    this.healthTimer = setInterval(() => {
      const now = Date.now();
      for (const peer of this.peers.values()) {
        if (!peer.isEnabled) continue;

        // Remove stale auto-discovered peers not seen recently
        if (peer.source === 'mdns' && peer.lastSeenAt) {
          const age = now - new Date(peer.lastSeenAt).getTime();
          if (age > PEER_STALE_MS) {
            logger.info('mDNS peer expired', { id: peer.id, url: peer.url });
            this.peers.delete(peer.id);
            this.save();
            continue;
          }
        }

        void this.probePeer(peer);
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8')) as Peer[];
      if (Array.isArray(raw)) {
        for (const peer of raw) {
          // Only restore manual peers — mdns peers are re-discovered at runtime
          if (peer.id && peer.source !== 'mdns') {
            this.peers.set(peer.id, peer);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load peers.json', { error: String(err) });
    }
  }

  private save(): void {
    try {
      mkdirSync(join(this.configPath, '..'), { recursive: true });
      // Only persist manual peers — mdns peers are ephemeral
      const toSave = Array.from(this.peers.values()).filter(p => p.source !== 'mdns');
      writeFileSync(this.configPath, JSON.stringify(toSave, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to save peers.json', { error: String(err) });
    }
  }
}
