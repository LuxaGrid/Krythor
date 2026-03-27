// ─── DevicePairingStore ───────────────────────────────────────────────────────
//
// Manages WS device pairing — tracks approved devices and issues device tokens.
//
// Device lifecycle:
//   1. Client connects with {device: {deviceId, platform, deviceFamily, role}}
//   2. Unknown deviceId → status:'pending' → gateway owner approves/denies
//   3. Local loopback connects are auto-approved (same-host UX)
//   4. On approval: gateway issues a deviceToken (persisted in store)
//   5. Subsequent connects include {deviceToken} → re-validated, no re-approval
//   6. Metadata changes (platform/deviceFamily) require re-pairing
//
// Storage: <dataDir>/devices.json
//

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';

export type DeviceApprovalStatus = 'approved' | 'pending' | 'denied';

export interface PairedDevice {
  deviceId: string;
  platform: string;
  deviceFamily: string;
  role: string;
  caps?: string[];
  status: DeviceApprovalStatus;
  deviceToken?: string;     // issued on approval; undefined while pending/denied
  approvedAt?: number;
  deniedAt?: number;
  requestedAt: number;
  lastSeenAt?: number;
  label?: string;           // user-assigned friendly label
}

interface PersistedStore {
  version: 1;
  devices: PairedDevice[];
}

export class DevicePairingStore {
  private readonly filePath: string;
  private devices = new Map<string, PairedDevice>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'devices.json');
    this.load();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Check/register a connecting device.
   * Returns the current device record (status: 'approved'|'pending'|'denied').
   * For new devices, creates a 'pending' record.
   * For approved devices with a valid token, updates lastSeenAt.
   * For approved devices with a stale/missing token, re-issues a token.
   */
  checkDevice(
    deviceId: string,
    identity: { platform: string; deviceFamily: string; role: string; caps?: string[] },
    suppliedToken?: string,
  ): { device: PairedDevice; tokenValid: boolean } {
    let device = this.devices.get(deviceId);

    if (!device) {
      // New device — create pending record
      device = {
        deviceId,
        platform:     identity.platform,
        deviceFamily: identity.deviceFamily,
        role:         identity.role,
        caps:         identity.caps,
        status:       'pending',
        requestedAt:  Date.now(),
      };
      this.devices.set(deviceId, device);
      this.persist();
      return { device, tokenValid: false };
    }

    // Device exists — check for metadata drift (requires re-pairing)
    const metadataChanged =
      device.platform !== identity.platform ||
      device.deviceFamily !== identity.deviceFamily;

    if (metadataChanged && device.status === 'approved') {
      // Revoke and move to pending for re-approval
      const updated: PairedDevice = {
        ...device,
        platform:     identity.platform,
        deviceFamily: identity.deviceFamily,
        role:         identity.role,
        caps:         identity.caps,
        status:       'pending',
        deviceToken:  undefined,
        approvedAt:   undefined,
        requestedAt:  Date.now(),
      };
      this.devices.set(deviceId, updated);
      this.persist();
      return { device: updated, tokenValid: false };
    }

    // Update caps/role (non-pairing fields)
    const refreshed: PairedDevice = {
      ...device,
      role:     identity.role,
      caps:     identity.caps,
      lastSeenAt: Date.now(),
    };

    const tokenValid = device.status === 'approved' &&
      !!device.deviceToken &&
      !!suppliedToken &&
      timingSafeEqual(Buffer.from(device.deviceToken, 'utf8'), Buffer.from(suppliedToken, 'utf8'));

    this.devices.set(deviceId, refreshed);
    this.persist();
    return { device: refreshed, tokenValid };
  }

  /**
   * Auto-approve a device (for loopback/same-host connects).
   * Issues a device token and returns the updated record.
   */
  autoApprove(deviceId: string): PairedDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const token = this.generateToken();
    const updated: PairedDevice = {
      ...device,
      status:      'approved',
      deviceToken:  token,
      approvedAt:   Date.now(),
    };
    this.devices.set(deviceId, updated);
    this.persist();
    return updated;
  }

  /**
   * Approve a pending device by deviceId.
   * Issues a device token and returns the updated record.
   */
  approve(deviceId: string, label?: string): PairedDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const token = this.generateToken();
    const updated: PairedDevice = {
      ...device,
      status:       'approved',
      deviceToken:  token,
      approvedAt:   Date.now(),
      ...(label ? { label } : {}),
    };
    this.devices.set(deviceId, updated);
    this.persist();
    return updated;
  }

  /**
   * Deny a pending device.
   */
  deny(deviceId: string): PairedDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);

    const updated: PairedDevice = {
      ...device,
      status:      'denied',
      deviceToken: undefined,
      deniedAt:    Date.now(),
    };
    this.devices.set(deviceId, updated);
    this.persist();
    return updated;
  }

  /**
   * Remove a device entirely (revoke + forget).
   */
  remove(deviceId: string): void {
    this.devices.delete(deviceId);
    this.persist();
  }

  /**
   * Update the label of an existing device without rotating the device token.
   */
  updateLabel(deviceId: string, label: string): PairedDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    const updated: PairedDevice = { ...device, label: label.trim() || undefined };
    this.devices.set(deviceId, updated);
    this.persist();
    return updated;
  }

  listAll(): PairedDevice[] {
    return Array.from(this.devices.values());
  }

  listPending(): PairedDevice[] {
    return Array.from(this.devices.values()).filter(d => d.status === 'pending');
  }

  get(deviceId: string): PairedDevice | undefined {
    return this.devices.get(deviceId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedStore;
      if (Array.isArray(parsed.devices)) {
        for (const d of parsed.devices) {
          if (d.deviceId) this.devices.set(d.deviceId, d);
        }
      }
    } catch { /* corrupt file — start fresh */ }
  }

  private persist(): void {
    const data: PersistedStore = {
      version: 1,
      devices: Array.from(this.devices.values()),
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
