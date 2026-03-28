import { describe, it, expect, vi, afterEach } from 'vitest';
import { MetricsCollector } from './MetricsCollector.js';

describe('MetricsCollector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty series with zero totals when no requests recorded', () => {
    const mc = new MetricsCollector(60);
    const series = mc.getSeries();
    expect(series.samples).toHaveLength(0);
    expect(series.totals.requests).toBe(0);
    expect(series.totals.errors).toBe(0);
    expect(series.totals.avgLatencyMs).toBe(0);
    expect(series.totals.errorRate).toBe(0);
  });

  it('records a request and reflects it in the series', () => {
    const mc = new MetricsCollector(60);
    mc.record(200, 50);
    const series = mc.getSeries();
    expect(series.samples).toHaveLength(1);
    expect(series.totals.requests).toBe(1);
    expect(series.totals.errors).toBe(0);
    expect(series.totals.avgLatencyMs).toBe(50);
    expect(series.totals.errorRate).toBe(0);
  });

  it('counts 5xx responses as errors', () => {
    const mc = new MetricsCollector(60);
    mc.record(200, 10);
    mc.record(500, 20);
    mc.record(503, 30);
    const series = mc.getSeries();
    expect(series.totals.requests).toBe(3);
    expect(series.totals.errors).toBe(2);
    expect(series.totals.errorRate).toBeCloseTo(2 / 3, 5);
  });

  it('aggregates multiple requests into the same minute bucket', () => {
    const mc = new MetricsCollector(60);
    // All recorded in the same real-clock minute bucket
    mc.record(200, 100);
    mc.record(200, 200);
    mc.record(404, 50);
    const series = mc.getSeries();
    // 404 is not a 5xx so errors should still be 0
    expect(series.totals.requests).toBe(3);
    expect(series.totals.errors).toBe(0);
    // samples should be exactly 1 bucket
    expect(series.samples).toHaveLength(1);
    expect(series.totals.avgLatencyMs).toBe(Math.round((100 + 200 + 50) / 3));
  });

  it('evicts old buckets outside the window', () => {
    vi.useFakeTimers();
    const mc = new MetricsCollector(2); // 2-minute window

    const minuteMs = 60_000;

    // Record at t=0
    vi.setSystemTime(0);
    mc.record(200, 10);

    // Advance 3 minutes — bucket at t=0 is now outside a 2-minute window
    vi.setSystemTime(3 * minuteMs);
    mc.record(200, 20);

    const series = mc.getSeries();
    // Only the recent bucket should survive
    expect(series.samples).toHaveLength(1);
    expect(series.totals.requests).toBe(1);
  });

  it('orders samples oldest to newest', () => {
    vi.useFakeTimers();
    const mc = new MetricsCollector(60);

    vi.setSystemTime(0);
    mc.record(200, 10);

    vi.setSystemTime(60_000);
    mc.record(200, 20);

    vi.setSystemTime(120_000);
    mc.record(200, 30);

    const series = mc.getSeries();
    expect(series.samples).toHaveLength(3);
    expect(series.samples[0]!.ts).toBeLessThan(series.samples[1]!.ts);
    expect(series.samples[1]!.ts).toBeLessThan(series.samples[2]!.ts);
  });

  it('reports windowMinutes matching constructor arg', () => {
    const mc = new MetricsCollector(30);
    expect(mc.getSeries().windowMinutes).toBe(30);
  });
});
