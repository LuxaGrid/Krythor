import { describe, it, expect } from 'vitest';
import { TaskClassifier } from './TaskClassifier.js';

describe('TaskClassifier', () => {
  const clf = new TaskClassifier();

  it('returns general for empty input', () => {
    const result = clf.classify('');
    expect(result.taskType).toBe('general');
    expect(result.confidence).toBe('low');
  });

  it('classifies coding tasks', () => {
    const result = clf.classify('write a TypeScript function that sorts an array');
    expect(result.taskType).toBe('code');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('classifies debug tasks', () => {
    const result = clf.classify('fix this bug in my Python script — it keeps crashing');
    expect(result.taskType).toBe('debug');
  });

  it('classifies summarization', () => {
    const result = clf.classify('summarize this meeting transcript');
    expect(result.taskType).toBe('summarize');
  });

  it('classifies vision tasks with high weight', () => {
    const result = clf.classify('extract text from this screenshot');
    expect(result.taskType).toBe('vision');
  });

  it('classifies planning/architecture', () => {
    const result = clf.classify('help me plan the architecture for a new microservice');
    expect(result.taskType).toBe('plan');
  });

  it('classifies triage', () => {
    const result = clf.classify('triage and prioritize my inbox emails');
    expect(result.taskType).toBe('triage');
  });

  it('prefers higher-weight type when multiple patterns match', () => {
    // 'vision' has weight 100 — should win over 'summarize' (65)
    const result = clf.classify('summarize what is in this image');
    expect(result.taskType).toBe('vision');
  });

  it('returns signals array with matched pattern strings', () => {
    const result = clf.classify('debug this broken function');
    expect(result.signals.length).toBeGreaterThan(0);
  });
});
