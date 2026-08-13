// Live proof: mount the TapPass plugin inside the REAL DeepSeek Harness runtime
// (@deepseek-ai/cordis + dsh-tools ToolRuntime), register real tools, and show a
// `block` verdict from /v1/govern actually stop a tool from executing.
//
//   node test/live-proof.mjs
//
// Against real staging instead of the local stub:
//   TAPPASS_BASE_URL=https://staging-api.tappass.ai TAPPASS_API_KEY=tp_dev_... \
//   BLOCK_TOOL=exfiltrate_secrets node test/live-proof.mjs
import http from 'node:http'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

import * as tappass from '../lib/index.js'

const BLOCK_TOOL = process.env.BLOCK_TOOL ?? 'exfiltrate_secrets'
const ALLOW_TOOL = 'list_files'

// Tracks whether a tool body actually ran, so a "deny" can be proven to prevent
// execution rather than merely rewrite the result.
const executed = []

async function main() {
  let baseURL = process.env.TAPPASS_BASE_URL
  let stub

  if (!baseURL) {
    stub = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const behavior = JSON.parse(body)
        const tool = behavior?.payload?.tool
        const decision =
          tool === BLOCK_TOOL
            ? { outcome: 'block', reason: 'exfiltration blocked by business rule', details: { blocking_step: 'data_egress_guard' } }
            : { outcome: 'allow', reason: '', mandate: 'demo-mandate', details: {} }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(decision))
      })
    })
    await new Promise((r) => stub.listen(0, '127.0.0.1', r))
    baseURL = `http://127.0.0.1:${stub.address().port}`
    process.env.TAPPASS_API_KEY = process.env.TAPPASS_API_KEY ?? 'tp_dev_local'
    console.log(`[proof] no TAPPASS_BASE_URL set; using local stub PDP at ${baseURL}`)
  } else {
    console.log(`[proof] governing against REAL TapPass at ${baseURL}`)
  }

  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)

  // Register two real tools whose bodies record that they ran.
  await ctx.plugin(
    Object.assign(
      (c) => {
        for (const name of [ALLOW_TOOL, BLOCK_TOOL]) {
          c.tools.register(
            defineTool({
              name,
              description: `demo tool ${name}`,
              parameters: {},
              output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
              async execute() {
                executed.push(name)
                return `SIDE EFFECT: ${name} ran`
              },
            }),
          )
        }
      },
      { inject: ['tools'] },
    ),
  )

  // Mount the TapPass plugin in enforce mode (config is validated by its schema).
  await ctx.plugin(tappass, {
    baseURL,
    apiKeyEnv: 'TAPPASS_API_KEY',
    mode: 'enforce',
    onError: 'deny',
    timeoutMs: 4000,
  })

  const call = (name) =>
    ctx.tools.execute({ callId: CallId(`c-${name}`), name, arguments: {}, signal: new AbortController().signal })

  const allow = await call(ALLOW_TOOL)
  const block = await call(BLOCK_TOOL)

  const text = (r) => r.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  console.log(`\n[proof] ${ALLOW_TOOL}: isError=${allow.isError} content=${JSON.stringify(text(allow))}`)
  console.log(`[proof] ${BLOCK_TOOL}: isError=${block.isError} content=${JSON.stringify(text(block))}`)
  console.log(`[proof] tool bodies that actually ran: ${JSON.stringify(executed)}\n`)

  // The claims we make at launch, asserted:
  assert.equal(allow.isError, false, 'allowed tool should succeed')
  assert.ok(executed.includes(ALLOW_TOOL), 'allowed tool body should have run')
  assert.equal(block.isError, true, 'blocked tool should error')
  assert.ok(!executed.includes(BLOCK_TOOL), 'BLOCKED tool body must NOT have run')
  assert.match(text(block), /blocked|policy|egress/i, 'block result should carry the reason')

  if (stub) stub.close()
  console.log('[proof] PASS: TapPass governed real dsh tool calls (allow ran, block was stopped before execution).')
}

main().catch((err) => {
  console.error('[proof] FAIL:', err)
  process.exit(1)
})
