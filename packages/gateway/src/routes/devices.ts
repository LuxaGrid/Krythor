// ─── Device pairing routes ────────────────────────────────────────────────────
//
// GET  /api/devices           — list all paired devices
// GET  /api/devices/pending   — list pending (awaiting approval) devices
// POST /api/devices/:id/approve — approve a device (issues a device token)
// POST /api/devices/:id/deny    — deny a device
// DELETE /api/devices/:id       — remove/forget a device
// PATCH /api/devices/:id        — update device label
//

import type { FastifyInstance } from 'fastify';
import type { DevicePairingStore } from '../ws/DevicePairingStore.js';

export function registerDeviceRoutes(app: FastifyInstance, store: DevicePairingStore): void {

  // GET /api/devices
  app.get('/api/devices', async (_req, reply) => {
    return reply.send({ devices: store.listAll() });
  });

  // GET /api/devices/pending
  app.get('/api/devices/pending', async (_req, reply) => {
    return reply.send({ devices: store.listPending() });
  });

  // POST /api/devices/:id/approve
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/devices/:id/approve', async (req, reply) => {
    const { id } = req.params;
    const label = (req.body as { label?: string })?.label;
    try {
      const device = store.approve(id, label);
      // Never expose the deviceToken over the API — only the WS client receives it
      const { deviceToken: _tok, ...safe } = device;
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
      return reply.send({ ok: true, device });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/devices/:id
  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      store.remove(id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/devices/:id
  app.patch<{ Params: { id: string }; Body: { label: string } }>('/api/devices/:id', async (req, reply) => {
    const { id } = req.params;
    const { label } = req.body as { label?: string };
    const device = store.get(id);
    if (!device) {
      return reply.code(404).send({ ok: false, error: `Device not found: ${id}` });
    }
    // Re-approve to update label (only if already approved)
    if (device.status === 'approved') {
      const updated = store.approve(id, label);
      const { deviceToken: _tok, ...safe } = updated;
      return reply.send({ ok: true, device: safe });
    }
    return reply.send({ ok: true, device });
  });
}
