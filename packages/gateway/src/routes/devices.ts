// ─── Device pairing routes ────────────────────────────────────────────────────
//
// GET    /api/devices            — list all paired devices
// GET    /api/devices/pending    — list pending (awaiting approval) devices
// GET    /api/devices/:id        — get a single device
// POST   /api/devices/:id/approve — approve a device (issues a device token)
// POST   /api/devices/:id/deny   — deny a device
// DELETE /api/devices/:id        — remove/forget a device
// PATCH  /api/devices/:id        — update device label (does NOT rotate token)
//
// When a device is approved or denied, a device:approved / device:denied event
// is broadcast to all connected WS clients so the UI can update immediately.
//

import type { FastifyInstance } from 'fastify';
import type { DevicePairingStore } from '../ws/DevicePairingStore.js';

export function registerDeviceRoutes(
  app: FastifyInstance,
  store: DevicePairingStore,
  broadcast?: (msg: unknown) => void,
): void {

  // GET /api/devices
  app.get('/api/devices', async (_req, reply) => {
    const all = store.listAll();
    const safe = all.map(({ deviceToken: _, ...d }) => d);
    return reply.send({ devices: safe });
  });

  // GET /api/devices/pending
  app.get('/api/devices/pending', async (_req, reply) => {
    const pending = store.listPending();
    const safe = pending.map(({ deviceToken: _, ...d }) => d);
    return reply.send({ devices: safe });
  });

  // GET /api/devices/:id
  app.get<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const { id } = req.params;
    const device = store.get(id);
    if (!device) {
      return reply.code(404).send({ ok: false, error: `Device not found: ${id}` });
    }
    const { deviceToken: _tok, ...safe } = device;
    return reply.send({ ok: true, device: safe });
  });

  // POST /api/devices/:id/approve
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/devices/:id/approve', async (req, reply) => {
    const { id } = req.params;
    const label = (req.body as { label?: string })?.label;
    try {
      const device = store.approve(id, label);
      // Never expose the deviceToken over the API — only the WS client receives it
      const { deviceToken: _tok, ...safe } = device;
      broadcast?.({ type: 'device:approved', payload: { deviceId: id, device: safe } });
      return reply.send({ ok: true, device: safe });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/devices/:id/deny
  app.post<{ Params: { id: string } }>('/api/devices/:id/deny', async (req, reply) => {
    const { id } = req.params;
    try {
      const device = store.deny(id);
      const { deviceToken: _tok, ...safe } = device;
      broadcast?.({ type: 'device:denied', payload: { deviceId: id, device: safe } });
      return reply.send({ ok: true, device: safe });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/devices/:id
  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      store.remove(id);
      broadcast?.({ type: 'device:removed', payload: { deviceId: id } });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/devices/:id — update label only; never rotates the device token
  app.patch<{ Params: { id: string }; Body: { label?: string } }>('/api/devices/:id', async (req, reply) => {
    const { id } = req.params;
    const { label } = (req.body ?? {}) as { label?: string };
    try {
      const updated = store.updateLabel(id, label ?? '');
      const { deviceToken: _tok, ...safe } = updated;
      return reply.send({ ok: true, device: safe });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
