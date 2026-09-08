# RV Workflow

[한국어](./README-KR.md)

RV Workflow is a Codex plugin for role-based project execution, repository-pinned toolchain checks, self-contained Superpowers-derived workflows, Ponytail's minimal-code mode, and task-progress dashboards in MCP Apps and terminal panels.

It is intended for teams that want agents to follow a consistent planner → test → implementation → QA workflow without adding heavy process to small tasks.

## Features

- Backend, frontend, document, planner, QA, and test-writer agent profiles
- Compact implementation plans capped to a small, reviewable shape
- Plugin-qualified skills that avoid collisions with unrelated workflows
- Repository-pinned Node.js and npm runtime checks
- Scope-aware, self-contained Superpowers 6.3.0 routing
- Bundled Ponytail 4.9.0 minimal-code, review, audit, debt, gain, and help skills
- Persistent task state with dependency-ordered steps and explicit owners
- Read-only MCP App dashboard and an interactive terminal TUI
- Automatic, duplicate-safe TUI startup with idle shutdown
- Opt-in project templates that preserve existing project configuration

## Repository layout

| Path | Purpose |
| --- | --- |
| `plugins/rv-workflow/` | Codex plugin source, skills, MCP server, terminal TUI, and web dashboard |
| `.agents/plugins/marketplace.json` | Local Codex marketplace entry |
| `.codex/agents/` | Role-specific Codex agent profiles used by this repository |
| `docs/specs/` | Accepted design and deployment specifications |
| `.github/` | Commit-message and pull-request templates |

## Requirements

- Codex CLI with plugin support
- Node.js `24.20.0`
- npm `12.0.2`
- A supported panel host for the TUI: tmux, Orca, iTerm2, or macOS Terminal

The plugin bootstrap can resolve the pinned Node.js runtime through NVM, asdf, mise, Volta, or the `RV_WORKFLOW_NODE` environment variable.

## Install the Codex plugin

Clone the repository and register it as a local marketplace:

```bash
git clone https://github.com/kangjuhyup/rv-workflow.git
cd rv-workflow
codex plugin marketplace add .
codex plugin add rv-workflow@personal
```

Start a new Codex conversation after installation so the plugin skills and MCP tools are discovered.

### Bundled methodology skills

Simple, clear, low-risk tasks run directly without a plan unless one is requested. Requests such as “plan this change” or “outline the implementation steps” automatically use `compact-plan` for a short, reviewable plan; no skill name is needed. Superpowers-derived workflows are bundled as lazy-loaded references behind `$rv-workflow:scoped-superpowers`; no separate Superpowers plugin is required. Ponytail is available through six plugin-qualified skills:

```text
$rv-workflow:ponytail full
$rv-workflow:ponytail-review
$rv-workflow:ponytail-audit
$rv-workflow:ponytail-debt
$rv-workflow:ponytail-gain
$rv-workflow:ponytail-help
```

The persistent Ponytail mode is explicit-only so it does not silently alter every coding task. Upstream versions and MIT notices are recorded in [third-party notices](./plugins/rv-workflow/THIRD_PARTY_NOTICES.md).

### Install the optional project templates

Plugin installation does not modify a project's `AGENTS.md` or `.codex/agents/`. Preview the changes first, then apply them explicitly:

```bash
node plugins/rv-workflow/scripts/install-templates.mjs /path/to/project
node plugins/rv-workflow/scripts/install-templates.mjs /path/to/project --apply
```

The installer reports collisions and never silently overwrites existing files.

## Task-progress TUI

From the plugin directory:

```bash
cd plugins/rv-workflow
npm run progress:ensure -- --color --workspace /path/to/project
```

From another directory, point npm at the plugin:

```bash
npm --prefix /path/to/rv-workflow/plugins/rv-workflow \
  run progress:ensure -- --color --workspace /path/to/project
```

`progress:ensure` keeps at most one watcher per workspace. The ensured panel follows the latest active task and closes after the workspace has remained on completed work for 30 seconds. Press `q` or `Ctrl-C` to close it manually.

Useful commands:

```bash
npm run progress -- --once --workspace /path/to/project
npm run progress:panel -- --workspace /path/to/project
npm run progress:ensure -- --color --workspace /path/to/project
```

## Development

Run development commands from `plugins/rv-workflow/`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate
```

`npm run validate` runs the type check, complete test suite, MCP build, and web dashboard build.

## npm distribution

The npm package is configured as the public scoped package `@rvkang/rv-workflow`. The package has not been published yet. After the exact release source is committed and pushed to `main`, pending pre-release Changesets have been absorbed, npm login belongs to `kangjuhyup`, and Git tag signing is configured, run the guarded bootstrap from an interactive terminal:

```bash
cd plugins/rv-workflow
npm run release:first
```

That single command validates and packs the package, requires a clean `main` exactly matching `origin/main`, verifies the npm identity and package integrity, publishes `0.1.0` with public access, pushes the signed `@rvkang/rv-workflow@0.1.0` tag, and creates the matching GitHub Release. It can resume an exact partial release, but rejects a conflicting registry artifact or tag. It accepts no arguments and refuses non-interactive execution so npm 2FA remains a deliberate bootstrap action.

Every pull request that changes the published package should include a Changeset:

```bash
npm run changeset
```

Commit the generated `.changeset/*.md` file with the change. When it reaches `main`, [the release workflow](./.github/workflows/release.yml) opens or updates a version pull request. Merging that pull request runs the complete validation suite, publishes to npm, pushes an `@rvkang/rv-workflow@<version>` Git tag, and creates the matching GitHub Release.

After the bootstrap, repository maintainers must configure npm Trusted Publishing for GitHub owner `kangjuhyup`, repository `rv-workflow`, and workflow `release.yml`, or configure an `NPM_TOKEN` secret with publish access to the `rvkang` organization package. GitHub repository settings must also allow Actions to create pull requests so the version PR can be maintained with `GITHUB_TOKEN`.

After the first release, the package can be installed globally and its terminal tools can be used directly:

```bash
npm install --global @rvkang/rv-workflow
rv-workflow-progress --once --workspace /path/to/project
rv-workflow-templates /path/to/project
```

The npm package distributes the runtime plugin assets and command-line tools. Codex plugin discovery still uses the marketplace installation described above.

## Contribution workflow

Commit messages use this format:

```text
<type>/<title> -description
```

Examples:

```text
feat/TUI 자동 실행 -작업 시작 시 진행 패널을 자동으로 연다
fix/작업 종료 처리 -완료된 워처가 남지 않도록 수정한다
docs/README 추가 -영문과 한국어 사용법을 문서화한다
```

The repository includes a local commit template and a GitHub pull-request template under `.github/`.

## More documentation

- [Plugin reference](./plugins/rv-workflow/README.md)
- [Task-progress UI specification](./docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md)
- [Plugin deployment specification](./docs/specs/2026-09-05-rv-workflow-plugin-deployment.md)
