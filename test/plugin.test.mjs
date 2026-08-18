// Runtime tests against the compiled package. No external services.
//   npm run build && node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import { mapVerdict, governToolCall, GovernError, toolCallBehavior, Config } from '../lib/index.js'

test('the default baseURL points at the live production host', () => {
  // api.tappass.ai does not resolve; production /v1/govern is served on
  // app.tappass.ai. A wrong default breaks every install that does not
  // override baseURL.
  assert.equal(Config({}).baseURL, 'https://app.tappass.ai')
})

// A minimal ToolExecution stub — enough for the pure behavior builder.
const execStub = (over = {}) => ({
  name: 'bash',
  arguments: { command: 'ls' },
  agent: { id: 'agent-1', session: { id: 'sess-1' } },
  ...over,
})

const baseConfig = {
  baseURL: 'https://app.tappass.ai',
  apiKeyEnv: 'TAPPASS_API_KEY',
  mode: 'observe',
  onError: 'deny',
  timeoutMs: 4000,
}

test('the behavior declares the plugin enforcement posture so TapPass can record pep_mode', () => {
  // observe → the audit trail must be able to show "decided but not enforced"
  const observed = toolCallBehavior({ ...baseConfig, mode: 'observe' }, execStub())
  assert.deepEqual(observed.enforcement, { mode: 'observe' })

  const enforced = toolCallBehavior({ ...baseConfig, mode: 'enforce' }, execStub())
  assert.deepEqual(enforced.enforcement, { mode: 'enforce' })
})

test('the behavior still carries the TOOL_CALL essentials', () => {
  const b = toolCallBehavior(baseConfig, execStub())
  assert.equal(b.type, 'TOOL_CALL')
  assert.equal(b.payload.tool, 'bash')
  assert.deepEqual(b.payload.args, { command: 'ls' })
  assert.equal(b.agent_id, 'agent-1')
  assert.equal(b.session_id, 'sess-1')
})

test('observe mode always proceeds, whatever the verdict', () => {
  for (const outcome of ['allow', 'block', 'needs_approval', 'modify']) {
    assert.equal(mapVerdict({ outcome, reason: 'x' }, 'observe'), null)
  }
})

test('enforce mode maps each TapPass outcome to the right dsh decision', () => {
  assert.equal(mapVerdict({ outcome: 'allow', reason: '' }, 'enforce'), null)

  assert.deepEqual(mapVerdict({ outcome: 'block', reason: 'PII leaves EU' }, 'enforce'), {
    kind: 'deny',
    reason: 'PII leaves EU',
  })

  assert.deepEqual(mapVerdict({ outcome: 'needs_approval', reason: 'refund > 500' }, 'enforce'), {
    kind: 'ask',
    reason: 'refund > 500',
  })

  // modify cannot be applied at pre-execute, so it fails closed with guidance.
  assert.equal(mapVerdict({ outcome: 'modify', reason: '' }, 'enforce').kind, 'deny')
})

test('block falls back to blocking_step when no reason is given', () => {
  const d = mapVerdict({ outcome: 'block', reason: '', details: { blocking_step: 'region_guard' } }, 'enforce')
  assert.equal(d.kind, 'deny')
  assert.match(d.reason, /region_guard/)
})

test('governToolCall sends a TOOL_CALL with bearer auth and parses the decision', async () => {
  let received
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received = { url: req.url, auth: req.headers['authorization'], body: JSON.parse(body) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ outcome: 'block', reason: 'not allowed', details: {} }))
    })
  })
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()

  const decision = await governToolCall(
    { baseURL: `http://127.0.0.1:${port}`, token: 'tp_dev_test', timeoutMs: 2000 },
    { type: 'TOOL_CALL', agent_id: 'a', session_id: 's', payload: { tool: 'bash', args: { command: 'ls' }, server: null } },
  )

  assert.equal(received.url, '/v1/govern')
  assert.equal(received.auth, 'Bearer tp_dev_test')
  assert.equal(received.body.type, 'TOOL_CALL')
  assert.equal(received.body.payload.tool, 'bash')
  assert.equal(decision.outcome, 'block')
  server.close()
})

test('governToolCall raises GovernError on a non-2xx status', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500)
    res.end('boom')
  })
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()

  await assert.rejects(
    () =>
      governToolCall(
        { baseURL: `http://127.0.0.1:${port}`, token: 'tp_dev_test', timeoutMs: 2000 },
        { type: 'TOOL_CALL', agent_id: 'a', session_id: 's', payload: { tool: 'x', args: {}, server: null } },
      ),
    (err) => err instanceof GovernError && /500/.test(err.message),
  )
  server.close()
})

test('governToolCall times out instead of hanging the agent loop', async () => {
  const server = http.createServer(() => {
    /* never responds */
  })
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()

  await assert.rejects(
    () =>
      governToolCall(
        { baseURL: `http://127.0.0.1:${port}`, token: 'tp_dev_test', timeoutMs: 150 },
        { type: 'TOOL_CALL', agent_id: 'a', session_id: 's', payload: { tool: 'x', args: {}, server: null } },
      ),
    (err) => err instanceof GovernError,
  )
  server.close()
})
