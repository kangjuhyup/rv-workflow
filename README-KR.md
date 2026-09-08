# RV Workflow

[English](./README.md)

RV Workflow는 역할 기반 프로젝트 실행, 저장소에 고정된 툴체인 확인, 자체 포함된 Superpowers 파생 워크플로, Ponytail 최소 코드 모드, MCP App 및 터미널 작업 진행 대시보드를 제공하는 Codex 플러그인입니다.

작은 작업에는 불필요한 절차를 추가하지 않으면서, 에이전트가 기획 → 테스트 → 구현 → QA 흐름을 일관되게 따르도록 구성되어 있습니다.

## 주요 기능

- Backend, frontend, document, planner, QA, test-writer 에이전트 프로필
- 작고 검토하기 쉬운 형태로 제한된 구현 계획
- 다른 워크플로와 이름이 충돌하지 않는 플러그인 한정 스킬
- 저장소에 고정된 Node.js 및 npm 런타임 검사
- 외부 설치 없이 동작하는 Superpowers 6.3.0 범위 라우팅
- Ponytail 4.9.0의 최소 코드·리뷰·감사·부채·효과·도움말 스킬
- 의존성과 담당자가 명시된 영구 작업 상태
- 읽기 전용 MCP App 대시보드와 대화형 터미널 TUI
- 중복 실행을 방지하는 TUI 자동 실행 및 유휴 종료
- 기존 프로젝트 설정을 보존하는 선택형 프로젝트 템플릿

## 저장소 구조

| 경로 | 용도 |
| --- | --- |
| `plugins/rv-workflow/` | Codex 플러그인, 스킬, MCP 서버, 터미널 TUI 및 웹 대시보드 소스 |
| `.agents/plugins/marketplace.json` | 로컬 Codex marketplace 설정 |
| `.codex/agents/` | 이 저장소에서 사용하는 역할별 Codex 에이전트 프로필 |
| `docs/specs/` | 승인된 설계 및 배포 명세 |
| `.github/` | 커밋 메시지 및 Pull Request 템플릿 |

## 요구 사항

- 플러그인을 지원하는 Codex CLI
- Node.js `24.20.0`
- npm `12.0.2`
- TUI 패널을 지원하는 tmux, Orca, iTerm2 또는 macOS Terminal

플러그인 부트스트랩은 NVM, asdf, mise, Volta 또는 `RV_WORKFLOW_NODE` 환경 변수를 통해 고정된 Node.js 런타임을 찾을 수 있습니다.

## Codex 플러그인 설치

저장소를 복제하고 로컬 marketplace로 등록합니다.

```bash
git clone https://github.com/kangjuhyup/rv-workflow.git
cd rv-workflow
codex plugin marketplace add .
codex plugin add rv-workflow@personal
```

설치 후 새 Codex 대화를 시작해야 플러그인의 스킬과 MCP 도구가 로드됩니다.

### 내장 방법론 스킬

단순하고 명확하며 위험이 낮은 작업은 계획 없이 바로 실행합니다. “계획 세워줘”, “구현 순서 정리해줘”처럼 계획을 요청하면 `compact-plan`으로 짧고 검토하기 쉬운 계획을 작성합니다. 스킬 이름을 명시할 필요는 없습니다. Superpowers 파생 워크플로는 `$rv-workflow:scoped-superpowers`가 필요한 reference만 불러오므로 별도 Superpowers 플러그인이 필요하지 않습니다. Ponytail은 다음 여섯 개의 플러그인 한정 스킬로 사용할 수 있습니다.

```text
$rv-workflow:ponytail full
$rv-workflow:ponytail-review
$rv-workflow:ponytail-audit
$rv-workflow:ponytail-debt
$rv-workflow:ponytail-gain
$rv-workflow:ponytail-help
```

지속형 Ponytail 모드는 명시적으로 호출할 때만 활성화되어 일반 코딩 작업을 자동으로 변경하지 않습니다. Upstream 버전과 MIT 고지는 [제3자 고지](./plugins/rv-workflow/THIRD_PARTY_NOTICES.md)에 기록되어 있습니다.

### 선택형 프로젝트 템플릿 설치

플러그인 설치만으로 프로젝트의 `AGENTS.md`나 `.codex/agents/`가 변경되지는 않습니다. 먼저 변경 내용을 미리 확인한 다음 명시적으로 적용합니다.

```bash
node plugins/rv-workflow/scripts/install-templates.mjs /path/to/project
node plugins/rv-workflow/scripts/install-templates.mjs /path/to/project --apply
```

설치 프로그램은 충돌을 보고하며 기존 파일을 자동으로 덮어쓰지 않습니다.

## 작업 진행 TUI

플러그인 디렉터리에서 실행합니다.

```bash
cd plugins/rv-workflow
npm run progress:ensure -- --color --workspace /path/to/project
```

다른 디렉터리에서는 npm에 플러그인 경로를 지정합니다.

```bash
npm --prefix /path/to/rv-workflow/plugins/rv-workflow \
  run progress:ensure -- --color --workspace /path/to/project
```

`progress:ensure`는 workspace마다 최대 하나의 워처만 유지합니다. 패널은 최신 활성 작업을 표시하며, 완료 상태가 30초 동안 유지되면 자동으로 닫힙니다. 직접 종료하려면 `q` 또는 `Ctrl-C`를 누릅니다.

주요 명령어:

```bash
npm run progress -- --once --workspace /path/to/project
npm run progress:panel -- --workspace /path/to/project
npm run progress:ensure -- --color --workspace /path/to/project
```

## 개발

`plugins/rv-workflow/`에서 다음 명령을 실행합니다.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate
```

`npm run validate`는 타입 검사, 전체 테스트, MCP 빌드 및 웹 대시보드 빌드를 순서대로 실행합니다.

## npm 배포

npm 패키지는 `@rvkang/rv-workflow` 공개 scope 패키지로 설정되어 있습니다. 아직 실제 배포되지는 않았습니다. 정확한 릴리스 소스를 `main`에 커밋·푸시하고, 최초 릴리스에 포함되는 Changeset을 정리하고, `kangjuhyup` npm 로그인과 Git tag 서명을 준비한 다음 대화형 터미널에서 보호된 bootstrap 명령 하나를 실행합니다.

```bash
cd plugins/rv-workflow
npm run release:first
```

이 명령 하나가 패키지 검증과 pack, 깨끗한 `main`과 `origin/main` 일치 확인, npm 사용자와 artifact 무결성 확인, 공개 `0.1.0` 게시, 서명된 `@rvkang/rv-workflow@0.1.0` tag push, 동일한 GitHub Release 생성을 순서대로 수행합니다. 정확히 일치하는 부분 릴리스는 재실행할 수 있지만 registry artifact나 tag가 충돌하면 중단합니다. 인자를 받지 않고 비대화형 실행을 거부하므로 최초 npm 2FA는 명시적인 사용자 작업으로 유지됩니다.

배포되는 패키지를 변경하는 Pull Request에는 Changeset을 추가합니다.

```bash
npm run changeset
```

생성된 `.changeset/*.md` 파일을 변경 사항과 함께 커밋합니다. 이 파일이 `main`에 병합되면 [릴리스 워크플로](./.github/workflows/release.yml)가 버전 Pull Request를 생성하거나 갱신합니다. 버전 Pull Request를 병합하면 전체 검증 후 npm 게시, `@rvkang/rv-workflow@<version>` Git 태그 및 동일한 GitHub Release 생성이 자동으로 진행됩니다.

bootstrap 이후 npm에서 GitHub owner `kangjuhyup`, repository `rv-workflow`, workflow `release.yml`을 Trusted Publisher로 설정하거나, `rvkang` 조직 패키지 게시 권한이 있는 `NPM_TOKEN` secret을 설정해야 합니다. 버전 Pull Request를 `GITHUB_TOKEN`으로 관리할 수 있도록 GitHub 저장소 설정에서 Actions의 Pull Request 생성도 허용해야 합니다.

최초 배포 후에는 전역으로 설치하고 터미널 도구를 직접 사용할 수 있습니다.

```bash
npm install --global @rvkang/rv-workflow
rv-workflow-progress --once --workspace /path/to/project
rv-workflow-templates /path/to/project
```

npm 패키지는 런타임 플러그인 파일과 명령줄 도구를 배포합니다. Codex에서 플러그인을 검색하고 로드하는 과정에는 위에서 설명한 marketplace 설치 방식이 계속 필요합니다.

## 기여 방법

커밋 메시지는 다음 형식을 사용합니다.

```text
<type>/<제목> -내용
```

예시:

```text
feat/TUI 자동 실행 -작업 시작 시 진행 패널을 자동으로 연다
fix/작업 종료 처리 -완료된 워처가 남지 않도록 수정한다
docs/README 추가 -영문과 한국어 사용법을 문서화한다
```

로컬 커밋 템플릿과 GitHub Pull Request 템플릿은 `.github/`에 포함되어 있습니다.

## 추가 문서

- [플러그인 상세 문서](./plugins/rv-workflow/README.md)
- [작업 진행 UI 명세](./docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md)
- [플러그인 배포 명세](./docs/specs/2026-09-05-rv-workflow-plugin-deployment.md)
