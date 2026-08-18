/**
 * Config schema for the TapPass governance plugin.
 * Validated by Cordis before `apply` runs; bad config fails the load loudly.
 * @module
 */
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** TapPass API base URL. The plugin POSTs to `${baseURL}/v1/govern`. */
  baseURL: string
  /** Env var name holding the TapPass developer key (`tp_dev_...`). A reference, not the secret. */
  apiKeyEnv: string
  /**
   * `observe`: every tool call is sent to TapPass and recorded, but always allowed.
   * `enforce`: TapPass verdicts are honored (block denies, needs_approval asks).
   * Default is `observe` so a new install watches before it ever blocks.
   */
  mode: 'observe' | 'enforce'
  /** When TapPass is unreachable in `enforce` mode: fail open (`allow`) or closed (`deny`). */
  onError: 'allow' | 'deny'
  /** Hard timeout for each verdict call, in milliseconds. */
  timeoutMs: number
  /** Override the agent id sent to TapPass. Defaults to the harness agent id. */
  agentId?: string
  /** Optional TapPass org id; normally stamped from the developer key. */
  orgId?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default('https://api.tappass.ai'),
  apiKeyEnv: z.string().role('credential-ref').default('TAPPASS_API_KEY'),
  mode: z.union(['observe', 'enforce'] as const).default('observe'),
  onError: z.union(['allow', 'deny'] as const).default('deny'),
  timeoutMs: z.number().step(1).min(1).default(4000),
  agentId: z.string(),
  orgId: z.string(),
})
