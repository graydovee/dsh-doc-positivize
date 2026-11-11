# dsh-doc-positivize

A DeepSeek Harness (DSH) plugin that keeps documentation positive and current: an always-on English guard in the system prompt, plus a `/positivize` command that rewrites negative or historical phrasing in documentation, comments, and commit text into positive descriptions.

## What it does

`apply` registers two contributions:

- a global system-prompt section — `doc-positivize:guard`, order `6000` — through `ctx.systemPrompt.section()`;
- the human command `/positivize` through `ctx.commands.register()`.

While enabled, the guard applies on every request; the command runs only when the user types it, in the host process.

## Why doc-positivize

The name pairs the scope with the action: documentation, positivized. The guard applies that rule to every model request; `/positivize` applies it to existing artefacts.

The reference project states the standard: state the accepted design, and describe the current state only.

## The guard contract

The built-in guard is English, like every first-party prompt section, and passes the marker scan with zero hits:

- **State the final state only** — code, comments, commit and MR/PR titles and descriptions, documentation, and prompts describe the current design as if it had been designed that way from the start.
- **Affirmative is the standard** — rules, prompts, tool schemas, and comments state the one positive practice and its trigger condition

`tests/guard.test.ts` pins that contract: the default text passes the reference scan patterns with zero hits, stays in English, and keeps literal braces out.

## The /positivize command

```text
/positivize                  rewrite the current workspace to positive descriptions
/positivize README*.md       rewrite the matching files to positive descriptions
```

In the Web GUI the command scans the scope with the marker list, asks the session's current model for a minimal JSON edit plan one file at a time, applies the edits in place, and returns immediately so the composer clears. Its result card carries the structured diff, a **Stop** button while the scan runs, and an **Undo** button on every changed file. The sweep stays outside model history, so the calling context keeps its conversation untouched.

CLI and headless runs use the foreground path: the command waits for the sweep and returns the full text report.

The sweep is bounded by `maxFiles`, `maxFileBytes`, and `timeoutMs`; the report lists any file left for a later run. It respects the reference exemptions (program logic and test assertions, public SDK Semver deprecation notices, high-risk boundaries rewritten as positive preconditions, and literal user-input matches). It edits files directly; run your project's tests after a sweep that changes code.

## Result card, undo, and stop

The result card renders a plugin-owned unified diff with hunk headers, line numbers, and the theme's added/deleted colors. It opens the first changed file and folds the rest; the file rows show `+added` / `-deleted` counts.

- **Stop** aborts the running scan, leaves files already changed before the stop listed with their Undo buttons, and stops all further model requests and writes.
- **Undo** restores that one file to its pre-scan content. It overwrites a file only when its current content matches the sweep's output, and accepts only a path the run recorded.
- Undo is available only after the scan settles and applies to one file at a time.
- A run with no changes collapses to one compact line.
- Run state lives in the Host process: after a Host restart the card shows only the command's compact summary.

The card uses three exact, owner-authenticated routes supplied by Connection: `GET /api/doc-positivize.state?runId=…`, `POST /api/doc-positivize.cancel`, and `POST /api/doc-positivize.undo`. The route payloads carry only identifiers the run recorded; the undo request selects a file the run already changed.

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.2-rc.1`; any 0.2.x line with `systemPrompt.section()`, `ctx.commands`, and `ctx.llm` |
| Client | web GUI: the package ships a `dsh.client` settings card and the `/positivize` result card for the Plugins page |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Services | `systemPrompt`, `commands`, and `llm`, all part of `@deepseek-ai/dsh-base`; optional `connection` enables the result card's Stop/Undo routes |
| Runtime imports | `@deepseek-ai/schemastery` |
| Config | Schemastery `Config` schema; invalid values fail at load time |

## Install

The repository commits its built entry points, so a git install is one step and needs no build permission:

```sh
# install straight from GitHub, without an allowBuilds approval
dsh plugin --profile <profile> add github:graydovee/dsh-doc-positivize

# confirm that the bundle row mounts
dsh --profile <profile> --dump-config | grep dsh-doc-positivize
```

In the Web **Plugins** page, paste `github:graydovee/dsh-doc-positivize` (or the repository URL) into **Add plugin** for the same install. To work on the sources, or to install a packed tarball offline:

```sh
pnpm install
pnpm build          # regenerates lib/; commit it with the source change
pnpm pack --pack-destination ./.pack

# a local spec must be an absolute path
dsh plugin --profile <profile> add "$PWD/.pack/dsh-doc-positivize-0.1.0-alpha.10.tgz"
```

A successful `dsh plugin add` also records the package in `dsh.profile.bundles`, so the row applies on the next boot. Restart the app (or reload the profile) to activate it.

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `guardEnabled` | boolean | `true` | mount the always-on guard section |
| `guard` | string | built-in English guard | replaces the whole always-on section |
| `extra` | string | `""` | project-specific guidance appended after a blank line |
| `command` | boolean | `true` | register the `/positivize` command |
| `ignoredPaths` | string[] | built-in list | names, paths, or globs the sweep skips |
| `maxFiles` | number | `12` | maximum candidate files swept in one run |
| `maxFileBytes` | number | `96000` | maximum bytes of one file sent to the model |
| `timeoutMs` | number | `180000` | time budget for one sweep, in milliseconds |

Override them in the profile patch (the plugin's own `cordis.patch.yml` carries a commented example):

```yaml
- id: dsh-doc-positivize
  config:
    extra: |-
      In this repository, name the exact check that proves each step.
```

`README-zh.md` also shows a scan-clean Chinese guard for repositories whose instructions are Chinese.

## Settings

The package ships a web settings card, so the guard switch and the sweep ignore list are editable in the settings card:

- open Settings → **Doc Positivize**;
- **Enable the doc-positivize guard** toggles the always-on rule;
- **Ignored files and directories** is a multiline editor with one name, path, or glob per line, so a list can be pasted in whole; **Save** writes the profile entry, and **Restore defaults** clears the override so the built-in list applies again.

Saving applies to the next model request. Scan results support per-file undo, and a running scan can be stopped from its card; both actions are available only while the Host still holds the run.

The built-in list is `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.pnpm-store`, `.pnpm-cache`, `.pack`, `target`, `vendor`, `.venv`, `__pycache__`, and the pnpm, npm, yarn, and bun lockfiles. An explicitly named file is swept even when its directory is on the list.

## Where it applies

Order `6000` sits in the empty `5000`–`9000` band: after every tool-guidance section, before the deliverable and environment block. The section is global, so every agent inherits it, and its text is static, so an unchanged render keeps the prompt prefix cache. The guard costs roughly 210 tokens per request; the sweep model calls run in-process and stay outside the conversation, which pays only the command lifecycle.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test          # unit tests plus real SystemPrompt and Commands integration
pnpm smoke:built   # build, then mount lib/index.js on the real registries
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js check --cwd .
```

`0.1.0` is the first released version. Local debugging builds use the next release's `-alpha.N` suffix (for example `0.1.0-alpha.10`) and remain internal to development.

## Verify

`dsh-plugin-dev verify` packs the plugin and installs it into a clean temporary `DSH_HOME`. On harness `0.2.2-rc.1` the headless smoke reaches the model transport, so a credential-free temporary home ends with `TRANSPORT: DeepSeek Messages transport failed` rather than a model answer; the install and `--dump-config` steps still pass, and the boot writes the rendered prompt as a `system/message` event. Grep that event for the guard text to prove the section reached the model-visible prompt.

## Attribution

The guard contract and the sweep procedure are adapted from the reference project [ox01024/pink-elephant](https://github.com/ox01024/pink-elephant) (MIT, Copyright © 2026 ox01024). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
