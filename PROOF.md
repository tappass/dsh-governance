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

## Against a real TapPass instance

The same harness governs against a live `/v1/govern` when you point it there:

```sh
TAPPASS_BASE_URL=https://staging-api.tappass.ai \
TAPPASS_API_KEY=tp_dev_... \
BLOCK_TOOL=<a tool your policy blocks> \
npm run proof
```

That exercises the full path end to end: real dsh runtime, real network call,
real policy engine, real verdict.
