# Version Sources and Activation

Inspect only the rows relevant to the assigned task. Stop after authoritative versions are established.

## Source Order

Use the most specific applicable source, and compare it with CI or container configuration when those environments define the actual build contract:

1. Nearest repository instructions such as `AGENTS.md`, `CONTRIBUTING.md` or documented bootstrap commands.
2. Module-specific version-manager files, engine project metadata and checked-in build wrappers.
3. Package manifests and explicit engine, runtime or package-manager fields.
4. Devcontainer, container, CI and deployment configuration.
5. Lockfiles as dependency-resolution evidence, not as permission to infer an undeclared runtime version.

When sources disagree, do not silently pick the highest or locally installed version. Report the conflict and use a clearly documented, module-specific source only when its precedence is unambiguous.

## Common Sources

| Stack | Inspect first | Verify with the project-selected executable |
| --- | --- | --- |
| JavaScript/TypeScript | `.nvmrc`, `.node-version`, `.tool-versions`, `mise.toml`, `package.json` `engines`, `packageManager` or Volta fields, then the lockfile | Runtime and selected package-manager version commands |
| JVM | Gradle or Maven wrapper, `.java-version`, toolchain declarations, build properties, container or CI JDK setup | Java version plus wrapper version |
| Python | `.python-version`, `.tool-versions`, `pyproject.toml` runtime constraint and environment or lock configuration | Interpreter and selected environment/package tool versions |
| Go | `go.mod` `go` and `toolchain` declarations | Go version |
| Rust | `rust-toolchain.toml`, `rust-toolchain`, Cargo metadata | Rust compiler and Cargo versions |
| .NET | `global.json`, target framework declarations | SDK information from the selected `dotnet` executable |
| Ruby | `.ruby-version`, `.tool-versions`, `Gemfile` and lockfile bundler metadata | Ruby and Bundler versions |
| PHP | `composer.json` platform/runtime constraints and lockfile | PHP and Composer versions |
| Swift/Apple | `.swift-version`, `Package.swift`, Xcode project settings and CI-selected Xcode | Swift and selected Xcode toolchain versions |
| Game engines | Checked-in engine project metadata, documented editor version and CI/build configuration; for example Unity project version metadata or Unreal engine association | Engine/editor or command-line build tool version |
| Frameworks and services | Dependency manifests and locks for application frameworks; Compose images, Helm values or deployment manifests for task-relevant databases and services | Framework/package resolution and service image/version evidence |

## Activation Rules

- Prefer repository wrappers such as checked-in build launchers over globally installed build tools.
- Use an existing manager such as mise, asdf, Volta, nvm/fnm, pyenv, rbenv, rustup, SDKMAN or jenv only when its configuration is present or repository documentation selects it.
- Respect the pinned package manager and lockfile. Do not switch npm, pnpm, Yarn, Bun, Poetry, uv, Bundler or another resolver for convenience.
- Install dependencies in the project scope only when the assigned task requires execution. Use frozen or immutable lockfile behavior when the repository or CI requires it.
- Do not refresh a lockfile as a side effect of environment activation. If the selected tool would rewrite it, stop and resolve the mismatch first.

## Handoff

Report one concise line per relevant toolchain containing the expected version, declaration source, observed version and any setup command that materially changed the environment. Omit unrelated stacks.
