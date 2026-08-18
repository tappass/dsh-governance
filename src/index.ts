/**
 * TapPass governance for DeepSeek Harness.
 *
 * The authority layer for agentic AI, as a dsh plugin. It intercepts every
 * tool call at `tools/pre-execute`, asks the TapPass policy decision point
 * (`POST /v1/govern`) whether the agent is allowed to do it under your
 * business rules, and then allows, denies, or escalates for human approval.
 *
 * Everything is a plugin. This is the one that decides what your agents are
 * allowed to do.
 *
 * @module @tappass/dsh-governance
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

import { Config } from './config.js'
import { governToolCall, GovernError } from './govern.js'
import type { GovernDecision, ToolCallBehavior } from './govern.js'

/** Cordis plugin name, used by loader diagnostics. */
export const name = 'tappass-governance'

/** Hold until the tool runtime exists; credentials are read optionally. */
export const inject = ['tools']

export { Config }
export type { Config as TapPassConfig } from './config.js'
export { governToolCall, GovernError } from './govern.js'
export type { GovernDecision, GovernOutcome, ToolCallBehavior } from './govern.js'

/**
 * Pure mapping from a TapPass Decision to a dsh PreToolDecision. Exported so the
 * behavior can be unit tested without a live harness or PDP. `null` means the
 * caller should return `next()` (let the tool run).
 */
export function mapVerdict(
  decision: Pick<GovernDecision, 'outcome' | 'reason' | 'details'>,
  mode: Config['mode'],
): PreToolDecision | null {
  if (mode === 'observe') return null
  switch (decision.outcome) {
    case 'block':
      return { kind: 'deny', reason: decision.reason || `blocked by TapPass policy${blockingStep(decision)}` }
    case 'needs_approval':
      return { kind: 'ask', reason: decision.reason || 'TapPass requires human approval' }
    case 'modify':
      return {
        kind: 'deny',
        reason: decision.reason || 'TapPass requires this request to be modified before it can run',
      }
    default:
      return null
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolveToken = async (): Promise<string | undefined> => {
    const ref = credentialRef(config.apiKeyEnv)
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(ref)
      if (resolved?.value) return resolved.value
    }
    const ambient = process.env[config.apiKeyEnv]
    return ambient && ambient.length > 0 ? ambient : undefined
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const token = await resolveToken()
    if (token === undefined) {
      ctx.logger.warn(`[tappass] no developer key in $${config.apiKeyEnv}; tool calls are not being governed`)
      return failOpenOrClosed(config, next, 'TapPass credential missing')
    }

    const behavior = toolCallBehavior(config, exec)

    let decision
    try {
      decision = await governToolCall(
        { baseURL: config.baseURL, token, timeoutMs: config.timeoutMs },
        behavior,
        exec.signal,
      )
    } catch (err) {
      const message = err instanceof GovernError ? err.message : String(err)
      ctx.logger.warn(`[tappass] verdict unavailable for ${exec.name}: ${message}`)
      return failOpenOrClosed(config, next, message)
    }

    // Observe mode watches first: record the verdict, never block.
    if (config.mode === 'observe' && (decision.outcome === 'block' || decision.outcome === 'needs_approval')) {
      ctx.logger.info(
        `[tappass] observe: would ${decision.outcome} ${exec.name} (${decision.reason || 'policy'})`,
      )
    }

    return mapVerdict(decision, config.mode) ?? next()
  })
}

function failOpenOrClosed(
  config: Config,
  next: () => Promise<PreToolDecision>,
  reason: string,
): Promise<PreToolDecision> | PreToolDecision {
  if (config.mode === 'enforce' && config.onError === 'deny') {
    return { kind: 'deny', reason: `TapPass unavailable: ${reason}` }
  }
  return next()
}

/** Build the TOOL_CALL Behavior for a tool execution. Pure, so it is testable. */
export function toolCallBehavior(config: Config, exec: ToolExecution): ToolCallBehavior {
  return {
    type: 'TOOL_CALL',
    agent_id: config.agentId ?? agentIdOf(exec) ?? 'deepseek-harness',
    session_id: sessionIdOf(exec) ?? 'dsh',
    payload: { tool: exec.name, args: normalizeArgs(exec.arguments), server: null },
    enforcement: { mode: config.mode },
    ...(config.orgId !== undefined ? { org_id: config.orgId } : {}),
  }
}

/** TapPass expects `args` to be a JSON object; wrap anything else as `{ input }`. */
function normalizeArgs(args: unknown): Record<string, unknown> {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  return { input: args }
}

function agentIdOf(exec: ToolExecution): string | undefined {
  return exec.agent !== undefined ? String(exec.agent.id) : undefined
}

function sessionIdOf(exec: ToolExecution): string | undefined {
  return exec.agent !== undefined ? String(exec.agent.session.id) : undefined
}

function blockingStep(decision: { details?: Record<string, unknown> }): string {
  const step = decision.details?.['blocking_step']
  return typeof step === 'string' && step.length > 0 ? `: ${step}` : ''
}
