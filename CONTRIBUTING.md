# Contributing

## This repository is public — document the contract, not the internals

The plugin and its npm tarball are public. Write docs, comments, and test
fixtures that explain **the public `/v1/govern` wire contract** a caller needs
(fields, `outcome` values, `enforcement.mode`, config) — not TapPass's internal
governance architecture, reasoning, or environment details.

Concretely, keep out of this repo:

- internal design rationale (how/why the audit trail, policy engine, or
  decision internals work the way they do — that lives in the private backend);
- real environment hostnames, org ids, agent ids, developer keys, or captured
  API responses — use placeholders (`https://<your-tappass-host>`, `tp_dev_...`);
- anything you would not put on a public webpage.

Comments are stripped from the shipped JS (`tsconfig removeComments`), but they
remain in the public source and git history — so write them accordingly.
