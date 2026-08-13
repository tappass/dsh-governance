# TapPass governance for DeepSeek Harness

**The authority layer for agentic AI, as a DeepSeek Harness plugin.**

Everything in DeepSeek Harness is a plugin. This is the one that decides what
your agents are allowed to do.

Guardrails and safety classifiers ask *"is this output harmful?"* That is a
property of the model. TapPass asks a different question: *"is this agent
**allowed** to do this, under **our** rules, right now?"* That is a property of
your business, and no model level tool can answer it, because the answer lives
in your organisation, not in the weights.

This plugin intercepts every tool call at the harness's `tools/pre-execute`
seam, sends it to the TapPass policy decision point (`POST /v1/govern`), and
allows, denies, or escalates it for human approval.

## Why it is different

- **Business rules, not model safety.** Write the rule once, in your language:
  "refunds over 500 need a human", "no customer PII leaves the EU region", "this
  agent may read the CRM, never write it". It is enforced on every tool call, on
  every harness, under every model. A prompt is a suggestion. A policy is a fact.
- **Authority is earned.** The plugin ships in **observe mode**: from the first
  minute it watches and records every call, and blocks nothing. You see what
  your agents do before you enforce a single deny. Then you turn on enforcement
  for what matters. Autonomy is a track record, not a checkbox.
- **Harness and model agnostic.** The same rules that govern an agent here
  govern it in Claude Code, in Codex, behind LiteLLM. The harness is
  interchangeable. The authority is not.
- **EU hosted, EU AI Act ready.**

## Install

```sh
# create a profile if you do not have one, then add the plugin
dsh plugin --profile default add @tappass/dsh-governance

# point it at your TapPass workspace
export TAPPASS_API_KEY="tp_dev_..."      # a TapPass developer key

# verify the layer without booting, then run
dsh --profile default --dump-config
dsh --profile default
```

Get a developer key from your TapPass dashboard (Settings, Developer keys) or
`POST /api/agents/{agent}/developer-keys`. The key is bound to one agent and one
org; TapPass records the audit trail against it.

## Configure

Every tool call is governed once it is installed. Configuration is optional; the
defaults are safe.

| Key | Default | Meaning |
|-----|---------|---------|
| `baseURL` | `https://api.tappass.ai` | TapPass API base. The plugin POSTs to `${baseURL}/v1/govern`. |
| `apiKeyEnv` | `TAPPASS_API_KEY` | Env var holding your `tp_dev_` key. A reference, not the secret. |
| `mode` | `observe` | `observe`: send and record every call, block nothing. `enforce`: honor verdicts. |
| `onError` | `deny` | In `enforce`, when TapPass is unreachable: `deny` (fail closed) or `allow` (fail open). |
| `timeoutMs` | `4000` | Hard timeout per verdict call. A slow PDP never wedges the agent loop. |
| `agentId` | harness agent id | Override the agent id sent to TapPass. |
| `orgId` | from the key | Override the org id; normally stamped from the developer key. |

Set them in your profile's patch, for example to enforce:

```yaml
# $DSH_HOME/profiles/default/cordis.patch.yml
- tappass-governance:
    config:
      mode: enforce
```

## How a verdict becomes a decision

| TapPass `outcome` | dsh `PreToolDecision` | Effect |
|---|---|---|
| `allow` | `next()` | the tool runs |
| `block` | `{ kind: 'deny', reason }` | the model gets an error result with the reason |
| `needs_approval` | `{ kind: 'ask', reason }` | routed to the harness approval flow for a human |

In `observe` mode every call returns `next()`, but a would-be block or approval
is still recorded server side and logged locally, so you can size your policy
against real traffic before enforcing.

## Honest limitations

- **No argument rewriting.** DeepSeek Harness makes tool arguments read only at
  `tools/pre-execute` by design (they are already logged and shown to the
  model), so a TapPass `modify` verdict cannot be applied in place. This plugin
  fails such a call closed in `enforce` mode with a clear reason rather than
  silently running the unmodified request. Redaction obligations are surfaced,
  not applied.
- **Approval needs an open turn.** A `needs_approval` verdict maps to the
  harness `ask` decision, which routes to whatever approval answerer your
  profile mounts. With no approver configured, `ask` fails closed to a denial,
  which is the safe default.
- **Developer preview.** DeepSeek Harness and its plugin API are pre-release and
  may change. This plugin is deliberately thin: it is a bridge to `/v1/govern`,
  so if the harness API shifts the fix is a small shim, not a rewrite.

## Develop

```sh
npm install --legacy-peer-deps   # dsh rc packages have skewed peer ranges
npm run build
node --test
```

The verdict mapping and the `/v1/govern` client are covered by
`test/plugin.test.mjs` and run against a local mock server, no TapPass instance
required.

## Links

- TapPass: https://tappass.ai
- The authority layer for agentic AI. Authority is earned. Even by AI.

## License

MIT © Cogniqor BV (TapPass)
