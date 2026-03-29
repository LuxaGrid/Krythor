import { describe, it, expect, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { WorkflowEngine } from './WorkflowEngine.js'
import type { AgentOrchestrator } from '@krythor/core'
import type { AgentRun } from '@krythor/core'

/** Minimal orchestrator stub for testing. Handler may throw to simulate failures. */
function makeOrchestrator(handler: (agentId: string, input: string) => string): AgentOrchestrator {
  return {
    runAgent: async (agentId: string, opts: { input: string }) => {
      const output = handler(agentId, opts.input)
      return { output, agentId, runId: 'r1' } as unknown as AgentRun
    },
  } as unknown as AgentOrchestrator
}

function makeEngine(orchestrator: AgentOrchestrator): WorkflowEngine {
  const dir = mkdtempSync(join(tmpdir(), 'wfe-test-'))
  return new WorkflowEngine(dir, orchestrator)
}

describe('WorkflowEngine — serial execution', () => {
  it('chains steps sequentially', async () => {
    const calls: string[] = []
    const engine = makeEngine(makeOrchestrator((agentId, input) => {
      calls.push(`${agentId}:${input}`)
      return `${agentId}-output`
    }))

    engine.upsert({
      id: 'chain',
      name: 'Chain',
      steps: [
        { agentId: 'a1' },
        { agentId: 'a2' },
        { agentId: 'a3' },
      ],
    })

    const result = await engine.run('chain', 'start')
    expect(result.status).toBe('completed')
    expect(calls[0]).toBe('a1:start')
    expect(calls[1]).toBe('a2:a1-output')
    expect(calls[2]).toBe('a3:a2-output')
    expect(result.finalOutput).toBe('a3-output')
  })

  it('respects inputMode=initial', async () => {
    const inputs: string[] = []
    const engine = makeEngine(makeOrchestrator((_id, input) => {
      inputs.push(input)
      return 'out'
    }))

    engine.upsert({
      id: 'always-initial',
      name: 'Always initial',
      steps: [
        { agentId: 'a1', inputMode: 'initial' },
        { agentId: 'a2', inputMode: 'initial' },
      ],
    })

    await engine.run('always-initial', 'seed')
    expect(inputs[0]).toBe('seed')
    expect(inputs[1]).toBe('seed')
  })

  it('skips steps whose condition does not match', async () => {
    const called: string[] = []
    const engine = makeEngine(makeOrchestrator((agentId) => {
      called.push(agentId)
      return 'no-match'
    }))

    engine.upsert({
      id: 'conditional',
      name: 'Conditional',
      steps: [
        { agentId: 'a1' },
        { agentId: 'a2', condition: 'NEVER_MATCHES' },
        { agentId: 'a3' },
      ],
    })

    const result = await engine.run('conditional', 'start')
    expect(called).toContain('a1')
    expect(called).not.toContain('a2')
    expect(called).toContain('a3')
    expect(result.steps[1]?.skipped).toBe(true)
  })

  it('aborts on step failure when stopOnFailure=true', async () => {
    const engine = makeEngine(makeOrchestrator((agentId) => {
      if (agentId === 'fail') throw new Error('oops')
      return 'ok'
    }))

    engine.upsert({
      id: 'abort-on-fail',
      name: 'Abort',
      steps: [
        { agentId: 'ok1' },
        { agentId: 'fail', stopOnFailure: true },
        { agentId: 'ok2' },
      ],
    })

    const result = await engine.run('abort-on-fail', 'go')
    expect(result.status).toBe('failed')
    const agentIds = result.steps.map(s => s.agentId)
    expect(agentIds).not.toContain('ok2')
  })

  it('continues on step failure when stopOnFailure=false', async () => {
    const called: string[] = []
    const engine = makeEngine(makeOrchestrator((agentId) => {
      called.push(agentId)
      if (agentId === 'fail') throw new Error('oops')
      return 'ok'
    }))

    engine.upsert({
      id: 'continue-on-fail',
      name: 'Continue',
      steps: [
        { agentId: 'ok1' },
        { agentId: 'fail', stopOnFailure: false },
        { agentId: 'ok2' },
      ],
    })

    const result = await engine.run('continue-on-fail', 'go')
    expect(result.status).toBe('partial')
    expect(called).toContain('ok2')
  })
})

describe('WorkflowEngine — parallel execution', () => {
  it('runs parallel group steps concurrently and joins outputs', async () => {
    const startTimes: Record<string, number> = {}
    const engine = makeEngine(makeOrchestrator((agentId, input) => {
      startTimes[agentId] = Date.now()
      return `${agentId}-result(${input})`
    }))

    engine.upsert({
      id: 'parallel-test',
      name: 'Parallel',
      steps: [
        { agentId: 'p1', parallel: 'grp1' },
        { agentId: 'p2', parallel: 'grp1' },
        { agentId: 'p3', parallel: 'grp1' },
        { agentId: 'final' },
      ],
    })

    const result = await engine.run('parallel-test', 'initial')
    expect(result.status).toBe('completed')

    // All three parallel steps should have run
    const parallelSteps = result.steps.filter(s => s.parallel === 'grp1')
    expect(parallelSteps).toHaveLength(3)
    expect(parallelSteps.every(s => !s.skipped)).toBe(true)

    // Final step input should be the joined outputs of the parallel group
    const finalStep = result.steps.find(s => s.agentId === 'final')
    expect(finalStep?.output).toBeDefined()
    expect(finalStep?.output).toContain('p1-result')
    expect(finalStep?.output).toContain('p2-result')
    expect(finalStep?.output).toContain('p3-result')
  })

  it('all parallel steps receive the same input (preceding output)', async () => {
    const inputs: Record<string, string> = {}
    const engine = makeEngine(makeOrchestrator((agentId, input) => {
      inputs[agentId] = input
      return `${agentId}-out`
    }))

    engine.upsert({
      id: 'parallel-input',
      name: 'Parallel input check',
      steps: [
        { agentId: 'serial-first' },
        { agentId: 'par1', parallel: 'g' },
        { agentId: 'par2', parallel: 'g' },
      ],
    })

    await engine.run('parallel-input', 'seed')
    expect(inputs['par1']).toBe('serial-first-out')
    expect(inputs['par2']).toBe('serial-first-out')
  })

  it('marks workflow partial when a parallel step fails with stopOnFailure=false', async () => {
    const engine = makeEngine(makeOrchestrator((agentId) => {
      if (agentId === 'bad') throw new Error('fail')
      return 'ok'
    }))

    engine.upsert({
      id: 'parallel-partial',
      name: 'Parallel partial',
      steps: [
        { agentId: 'good1', parallel: 'g', stopOnFailure: false },
        { agentId: 'bad', parallel: 'g', stopOnFailure: false },
        { agentId: 'good2', parallel: 'g', stopOnFailure: false },
      ],
    })

    const result = await engine.run('parallel-partial', 'go')
    expect(result.status).toBe('partial')
    const failedStep = result.steps.find(s => s.agentId === 'bad')
    expect(failedStep?.error).toBeDefined()
  })

  it('serial steps after a parallel group see the joined output', async () => {
    let finalInput = ''
    const engine = makeEngine(makeOrchestrator((agentId, input) => {
      if (agentId === 'collector') finalInput = input
      return `${agentId}:${input.slice(0, 5)}`
    }))

    engine.upsert({
      id: 'parallel-serial-mix',
      name: 'Mix',
      steps: [
        { agentId: 'pa', parallel: 'grp' },
        { agentId: 'pb', parallel: 'grp' },
        { agentId: 'collector' },
      ],
    })

    await engine.run('parallel-serial-mix', 'x')
    // The collector should have received the joined parallel outputs
    expect(finalInput).toContain('---')
  })

  it('multiple distinct parallel groups execute in order', async () => {
    const callOrder: string[] = []
    let group2Input = ''
    const engine = makeEngine(makeOrchestrator((agentId, input) => {
      callOrder.push(agentId)
      if (agentId.startsWith('g2')) group2Input = input
      return `${agentId}-out`
    }))

    engine.upsert({
      id: 'two-groups',
      name: 'Two groups',
      steps: [
        { agentId: 'g1a', parallel: 'grp1' },
        { agentId: 'g1b', parallel: 'grp1' },
        { agentId: 'g2a', parallel: 'grp2' },
        { agentId: 'g2b', parallel: 'grp2' },
      ],
    })

    const result = await engine.run('two-groups', 'start')
    expect(result.status).toBe('completed')
    // Group 2 sees the joined output of group 1
    expect(group2Input).toContain('g1a-out')
    expect(group2Input).toContain('g1b-out')
  })
})
