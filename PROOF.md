# Live proof

`test/live-proof.mjs` mounts this plugin inside the **real** DeepSeek Harness
runtime, not a mock of it: `@deepseek-ai/cordis` (the kernel) and
`@deepseek-ai/dsh-tools` (the actual `ToolRuntime`). It registers two real tools,
mounts the plugin in `enforce` mode, and drives both tools through the genuine
tool-execution pipeline. Each tool body records whether it ran, so a `block`
verdict is proven to stop execution rather than merely rewrite a result.

Run it yourself:

```sh
npm run build && npm run proof
```

Recorded output (local stub PDP returning the real `/v1/govern` wire shape):

```
[proof] no TAPPASS_BASE_URL set; using local stub PDP at http://127.0.0.1:xxxxx

[proof] list_files: isError=false content="SIDE EFFECT: list_files ran"
[proof] exfiltrate_secrets: isError=true content="Error: exfiltration blocked by business rule"
[proof] tool bodies that actually ran: ["list_files"]

[proof] PASS: TapPass governed real dsh tool calls (allow ran, block was stopped before execution).
```

What this establishes:

- The plugin's `tools/pre-execute` listener fires inside the real dsh
  `ToolRuntime`.
- An `allow` verdict lets the tool run (its side effect is observed).
- A `block` verdict returns an error result to the model **and the tool body
  never executes** (`exfiltrate_secrets` is absent from the list of bodies that
  ran).

This runs in CI on every push, so the "governs real dsh tool calls" claim is
continuously enforced, not a one-off screenshot.

## Against a real TapPass instance (executed)

The same harness governs against a live `/v1/govern` when you point it there:

```sh
TAPPASS_BASE_URL=https://staging.tappass.ai \
TAPPASS_API_KEY=tp_dev_... \
BLOCK_TOOL=exfiltrate_secrets \
EXPECT_ALLOW=0 \
npm run proof
```

This was run against a live staging TapPass. The plugin, inside the real dsh
runtime, made real network calls to `/v1/govern` with a real developer key and
received real `block` verdicts; both governed tools were stopped before their
bodies ran:

```
[proof] governing against REAL TapPass at https://staging.tappass.ai
[proof] list_files: isError=true content="Error: provider_not_allowed"
[proof] exfiltrate_secrets: isError=true content="Error: provider_not_allowed"
[proof] tool bodies that actually ran: []
[proof] PASS: the plugin honored the real /v1/govern block verdict; the tool body never ran.
```

`EXPECT_ALLOW=0` is the honest mode for a fresh agent whose org policy floor
denies every tool call: it asserts only that governed calls are stopped, without
manufacturing an allow the real policy would not grant. The allow path (a verdict
letting a tool run) is exercised by the default local/CI proof above.
