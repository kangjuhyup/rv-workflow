# RV Workflow

`rv-workflow` is a local Codex plugin for reusable role routing, project-pinned toolchain checks, narrowly scoped Superpowers guidance, and task-progress dashboards for MCP Apps and terminals.

Source: [github.com/kangjuhyup/rv-workflow](https://github.com/kangjuhyup/rv-workflow)

## Install

The repository marketplace entry is `.agents/plugins/marketplace.json` with source `./plugins/rv-workflow`. Install the plugin through Codex's local marketplace, then start a new conversation so plugin-qualified skills are discovered. The canonical skill source is `skills/` inside this package.

Role and custom-agent configuration are opt-in templates because plugin installation does not automatically merge `.codex/config.toml` or `.codex/agents/*.toml`. The template installer takes a target project path and defaults to a dry run:

```sh
node scripts/install-templates.mjs /path/to/project
node scripts/install-templates.mjs /path/to/project --apply
```

The dry run should enumerate the proposed files and check existing `AGENTS.md`, agent-key and agent-file collisions, model availability guidance, runtime pins, duplicate skills, and duplicate plugin installation. `--apply` is the explicit mutation step; existing files are never silently overwritten. Review the report before applying. (The command is the installer contract; run it only after the installer is present in the package.)

## Runtime and development

The bundled MCP/UI package declares Node.js `24.20.0` and npm `12.0.2` in `.node-version`, `package.json.engines`, `packageManager`, and the lockfile. Resolve and activate those pins with `project-toolchain` before executable work; prose-only README work uses its not-applicable fast path.

Codex may start an MCP server or progress panel with a different PATH than an interactive shell. The shared bootstrap therefore verifies the exact engine version before importing either bundle and re-executes through `RV_WORKFLOW_NODE`, NVM, asdf, mise, or Volta when it finds the pinned runtime. It fails clearly instead of silently running on another Node version. `RV_WORKFLOW_NODE` may be set to an explicit Node 24.20.0 executable when automatic discovery is unavailable.

From `plugins/rv-workflow/`, the available validation commands are:

```sh
npm run typecheck
npm test
npm run build
npm run validate
```

These are commands to run, not claims that they have passed. The package's own MCP dependencies are installed from its lockfile; do not change pins merely to match a local runtime.

## npm package

The public package name is `@rvkang/rv-workflow`. For the one-time `0.1.0` bootstrap, first commit and push the exact release source to `main`, absorb pending pre-release Changesets, log in to npm as `kangjuhyup`, and configure Git tag signing. Then run this from an interactive terminal:

```sh
npm run release:first
```

The command validates and packs the artifact, requires a clean `main` exactly matching `origin/main`, verifies npm identity and integrity, publishes the public package, pushes the signed package tag, and creates the GitHub Release. Exact partial state is resumable; conflicting package or tag state is rejected. The command accepts no arguments and requires a TTY for npm 2FA.

Add a Changeset to every pull request that changes the published package:

```sh
npm run changeset
```

After the changeset reaches `main`, the repository release workflow opens or updates a version pull request. Merging that pull request runs `changeset publish`; `prepublishOnly` performs the complete validation suite before npm publishing, then the workflow pushes the `@rvkang/rv-workflow@<version>` Git tag and creates the matching GitHub Release. After bootstrap, configure npm Trusted Publishing for GitHub owner `kangjuhyup`, repository `rv-workflow`, and workflow `release.yml`, or provide a repository `NPM_TOKEN` secret with publish access. GitHub Actions also needs permission to create pull requests with `GITHUB_TOKEN`.

After the first release, a global installation exposes `rv-workflow-progress` and `rv-workflow-templates`:

```sh
npm install --global @rvkang/rv-workflow
rv-workflow-progress --once --workspace /path/to/project
rv-workflow-templates /path/to/project
```

The npm package distributes the runtime plugin assets and CLIs. Codex plugin discovery still uses the local marketplace installation described above.

## Bundled methodology skills

The scoped workflow router includes adapted Superpowers 6.3.0 guidance as lazy-loaded references, so installing RV Workflow does not require a separate Superpowers plugin. The full catalog remains behind `$rv-workflow:scoped-superpowers`; it loads at most one phase-specific reference.

Ponytail 4.9.0 is bundled as six plugin-qualified skills:

```text
$rv-workflow:ponytail full
$rv-workflow:ponytail-review
$rv-workflow:ponytail-audit
$rv-workflow:ponytail-debt
$rv-workflow:ponytail-gain
$rv-workflow:ponytail-help
```

The persistent Ponytail mode is explicit-only. Focused one-shot skills may match their specific natural-language triggers. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for upstream versions, revisions, adaptations, and MIT license files.

## Task progress UI

The local stdio MCP server exposes separate write/read tools for task state and a read-only `render_task_progress` dashboard. The terminal companion uses the same task service and, when both stdin and stdout are TTYs, also exposes confirmed, allowlisted step updates. Use `$rv-workflow:task-progress` only when the user explicitly requests tracking or for medium/large work, and record phase boundaries rather than every command. Small questions, status checks, file lookups, localized routine edits, and routine commits remain untracked.

The opt-in `AGENTS.md` template treats panel startup separately from task tracking. Every tool-using agent task runs the idempotent `--ensure-panel` bootstrap once before scope classification, including read-only and small tasks; those tasks still do not create progress records. Pure conversational responses that need no tools skip panel startup.

The dashboard renders a structured tool result in an inline card with role lanes, derived completion, blocked reasons, recent evidence references, stale/empty/error states, and a keyboard-accessible Refresh control. It does not edit tasks, poll, observe private Codex subagent lifecycle, show command logs/tokens/costs, or accept arbitrary percentage input. Agents must explicitly write state through MCP tools. The UI uses a versioned MCP Apps resource and no external scripts, fonts, images, or API calls; a new breaking UI contract requires a resource URI version.

Parallel agents are represented by independent steps with distinct `owner` values. Each agent marks only its own step, so several steps may be `in_progress` at once and appear together in the role lanes and terminal view. Codex or Orca terminal presence can be used as a troubleshooting hint, but completion and blocking are never inferred from process existence; MCP step updates remain the authoritative signal.

For a persistent terminal view, build the package and open the interactive companion in a separate panel from the plugin root:

```sh
npm run build:mcp
npm run progress:panel -- --workspace /path/to/project
```

For agent-driven work, prefer the idempotent form:

```sh
npm run progress:ensure -- --color --workspace /path/to/project
```

From outside the plugin root, point npm at the installed plugin explicitly:

```sh
npm --prefix /path/to/rv-workflow run progress:ensure -- --color --workspace /path/to/project
```

`--ensure-panel` keeps at most one watcher per workspace and state directory. It records the watcher PID in a private `panels/` instance file under the task-progress state directory, reuses a live watcher, replaces stale state after a crash, and releases the instance when the watcher exits normally. It follows the latest active task and exits after the workspace has remained on completed work for 30 seconds. Repeating `--ensure-panel` immediately after tracked task creation prevents slow classification from missing the task while preserving the single-watcher guarantee. Use explicit `--panel --task-id <id>` only for an intentionally separate, task-specific view.

Colors are enabled by default unless `NO_COLOR` is set. Pass `--color` to explicitly enable the semantic TUI palette in a child panel, or `--no-color` to force plain output.

When stdin is a TTY, the watcher enables raw mode and supports these navigation commands:

| Key | Action |
| --- | --- |
| `j` / `k` | Move between visible steps |
| `Enter` | Expand or collapse the selected step details |
| `/` | Enter search mode |
| `f` | Cycle the status filter |
| `r` | Refresh immediately |
| `?` | Toggle help |
| `q` | Exit |
| `:` | Enter command mode |

Command mode accepts only a fixed registry; it never passes input to a shell:

```text
:start build
:done build "Renderer implemented"
:block build --reason "Waiting for API approval"
:skip docs
:filter blocked
```

Step mutations require confirmation and call the existing `updateTaskStep()` service with the revision currently displayed. If that compare-and-swap revision conflicts, the companion loads the latest snapshot and asks before retrying. `:refresh`, `:help`, and `:quit` are also available. `Esc` cancels search, command, or confirmation mode. Raw mode and the hidden cursor are restored on normal exit, input `Ctrl-C`, `SIGINT`, `SIGTERM`, and handled exceptions.

`--panel` auto-detects the host and launches the same compiled CLI with the current Node runtime:

| Environment | Panel behavior |
| --- | --- |
| tmux | Right-side split in the current tmux window |
| Orca terminal | Right-side Orca terminal split |
| iTerm2 | Right-side split using the current profile |
| other macOS terminals | New Terminal.app window |
| zsh or bash | Uses the host terminal's configured shell with POSIX-safe argument quoting |

Auto-detection prefers tmux, then Orca, then iTerm2, with Terminal.app as the macOS fallback. Override a mistaken detection with `--panel-launcher tmux`, `orca`, `iterm2`, or `terminal`. Unmanaged Linux terminals require tmux or an explicit supported launcher; the command exits instead of creating a background watcher when no panel host is available.

The watcher checks the stored revision once per second and redraws only after a meaningful task update. Polling and local interaction perform no model calls and therefore add no token usage. `--watch` remains available when a panel is already open, and `--once` prints a read-only single snapshot or redirected output. Press `q` or `Ctrl-C` in the panel to stop it. Each explicit `--panel` invocation opens one new panel, while repeated `--ensure-panel` invocations reuse the workspace watcher. Codex TUI itself does not expose a plugin API for a pinned custom panel.

The watcher never guesses that a task finished because an agent or terminal disappeared. Before a coordinating agent sends its final response, it must read the latest snapshot and explicitly complete or skip every remaining runnable step, then render the completed or blocked state. This prevents an abandoned `pending` step from keeping an otherwise finished task `in_progress`.

## Model templates

The opt-in templates preserve the established roles and routing:

| Agent | Model | Reasoning |
| --- | --- | --- |
| planner | `gpt-5.6-sol` | high |
| test-writer | `gpt-5.6-terra` | high |
| backend | `gpt-5.6-sol` | high |
| frontend | `gpt-5.6-sol` | medium |
| document | `gpt-5.6-luna` | medium |
| qa | `gpt-5.6-terra` | high |

`test-writer` remains separate and may write tests only. Templates use plugin-qualified skill names (`$rv-workflow:backend`, `$rv-workflow:frontend`, `$rv-workflow:document`, `$rv-workflow:qa`, `$rv-workflow:planner`, `$rv-workflow:project-toolchain`, `$rv-workflow:scoped-superpowers`, and `$rv-workflow:task-progress`) to avoid collisions with unrelated skills.

See the accepted design and behavior contract in [`docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md`](../../docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md).
