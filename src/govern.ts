/**
 * Minimal client for the TapPass `/v1/govern` verdict API.
 *
 * TapPass is a policy decision point: you POST a Behavior describing what the
 * agent is about to do, and you get back a Decision. This module speaks only
 * the TOOL_CALL behavior, which is what a harness needs at the tool boundary.
 *
 * @module
 */

/** The verdict TapPass returns. `allow`, `block`, `needs_approval` are live today. */
export type GovernOutcome =
  | 'allow'
  | 'block'
  | 'needs_approval'
  | 'modify'
  | 'escalate'
  | 'dispatch_to_sandbox'

export interface GovernApproval {
  request_id: string
  tier?: string
  expires_at?: string | null
  matched_rule?: string | null
}

/** The `/v1/govern` response envelope. */
export interface GovernDecision {
  outcome: GovernOutcome
  reason: string
  behavior_id?: string
  pipeline_id?: string
  decided_at?: string
  details?: Record<string, unknown>
  mandate?: string | null
  obligations?: Array<Record<string, unknown>>
  approval?: GovernApproval | null
  modified_payload?: Record<string, unknown> | null
}

/** A TOOL_CALL behavior, the only shape this plugin sends. */
export interface ToolCallBehavior {
  type: 'TOOL_CALL'
  agent_id: string
  session_id: string
  payload: { tool: string; args: Record<string, unknown>; server: string | null }
  org_id?: string
  // This plugin's configured mode, sent so the verdict can be recorded with the
  // posture it was evaluated under.
  enforcement?: { mode: 'observe' | 'enforce' }
}

export interface GovernClientOptions {
  /** TapPass API base, e.g. `https://app.tappass.ai`. The plugin POSTs to `${baseURL}/v1/govern`. */
  baseURL: string
  /** A TapPass developer key (`tp_dev_...`), sent as `Authorization: Bearer`. */
  token: string
  /** Hard timeout for the verdict call, in milliseconds. */
  timeoutMs: number
}

/** Raised when TapPass cannot be reached or returns a non-2xx status. */
export class GovernError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GovernError'
    this.status = status
  }
}

/**
 * Ask TapPass whether a tool call may proceed. Races the caller's `signal`
 * (the harness cancels the tool invocation) against an internal timeout so a
 * slow or dead PDP never wedges the agent loop.
 */
export async function governToolCall(
  opts: GovernClientOptions,
  behavior: ToolCallBehavior,
  signal?: AbortSignal,
): Promise<GovernDecision> {
  const url = opts.baseURL.replace(/\/+$/, '') + '/v1/govern'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
  const onAbort = (): void => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(behavior),
      signal: ac.signal,
    })
    if (!res.ok) {
      throw new GovernError(`TapPass /v1/govern returned ${res.status}`, res.status)
    }
    return (await res.json()) as GovernDecision
  } catch (err) {
    if (err instanceof GovernError) throw err
    throw new GovernError(`TapPass /v1/govern request failed: ${String(err)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
