# RV Workflow 플러그인과 태스크 진행 UI 명세

- 작성일: 2026-09-04
- 상태: 구현 승인됨
- 대상 저장소: `/Users/kangjuhyup/Documents/skills`
- 배포 범위: 로컬·저장소 marketplace용 Codex 플러그인

## 1. 문제와 목표

현재 저장소에는 재사용 가능한 역할 스킬과 모델별 커스텀 에이전트 정책이 있지만, 설치 가능한 하나의 플러그인 단위가 아니며 작업 진행 상태를 시각적으로 확인할 수 없다.

이 변경의 사용자는 여러 프로젝트에서 같은 개발 워크플로를 재사용하는 개발자다. 사용자는 다음 결과를 얻어야 한다.

1. `backend`, `frontend`, `document`, `qa`, `planner` 역할과 공통 정책을 하나의 `rv-workflow` 플러그인으로 설치한다.
2. 역할별 모델, 테스트 작성자와 구현자의 분리, 프로젝트별 toolchain 확인, 제한적인 Superpowers 사용 정책을 유지한다.
3. 중간 이상 크기의 작업에서 계획 단계와 역할별 진행 상태를 대화 안의 UI로 확인한다.
4. 소규모 질문, status, 파일 조회, 단순 수정, routine commit에는 진행 추적이나 Superpowers 오버헤드를 추가하지 않는다.

## 2. 현재 저장소 근거

- 역할 라우팅과 실행 순서는 `AGENTS.md`에 정의되어 있다.
- 역할 스킬은 `.agents/skills/{backend,frontend,document,qa,planner}`에 있고 필요한 reference만 읽는 경량 router다.
- 공통 스킬은 `.agents/skills/project-toolchain`과 `.agents/skills/scoped-superpowers`다.
- `.codex/agents/*.toml`에는 역할 5개와 `test-writer`의 모델 및 reasoning 설정이 있다.
- `.codex/config.toml`이 여섯 custom agent를 등록한다.
- 현재 저장소에는 Node, package manager 또는 MCP/UI 빌드용 manifest와 lockfile이 없다.
- 현재 디렉터리는 `main` 브랜치의 Git 저장소이며 `origin`은 `https://github.com/kangjuhyup/rv-workflow.git`이다. 아직 기준 commit이 없으므로 이 명세의 구현 범위에는 commit, push, PR 절차를 포함하지 않는다.

공식 플러그인 구조는 `.codex-plugin/plugin.json`, 선택적인 `skills/`, bundled MCP용 `.mcp.json`, assets와 scripts를 지원한다. MCP 서버는 structured result와 UI resource를 함께 제공할 수 있으며, UI가 필요한 경우에도 데이터 도구는 UI 없이 사용할 수 있어야 한다.

## 3. 범위

### 포함

- `plugins/rv-workflow/` 아래 단일 플러그인 패키지
- 기존 7개 스킬의 플러그인 내 canonical 배치
- 진행 기록만 담당하는 경량 공통 `task-progress` 스킬
- 역할 custom agent와 `test-writer`를 대상 프로젝트에 적용하기 위한 opt-in 템플릿 및 충돌 검사형 설치 도구
- 로컬 stdio MCP 서버, 작업 상태 저장소, task progress 도구
- MCP Apps 표준 기반 읽기 전용 inline dashboard
- 터미널 환경별 읽기 전용 progress panel launcher와 watch dashboard
- repo marketplace 등록
- manifest, skill, 상대 경로, MCP 도구, 상태 전이, UI 및 설치 도구 검증
- 기존 `.agents/skills`에서 플러그인 skill로의 중복 없는 전환

### 제외

- Vote 저장소 변경 또는 재검사
- public plugin directory 제출, 배포 서버, Secure MCP Tunnel, OAuth
- 외부 프로젝트에 템플릿을 자동 적용하거나 덮어쓰기
- Codex 내부 subagent lifecycle의 비공개 상태를 자동 수집하는 기능
- UI에서 task나 step을 직접 수정하는 기능
- 명령 단위 로그, 토큰 사용량, 비용, arbitrary percentage 입력
- commit, push, PR, release 또는 배포

## 4. 플러그인 구조

`plugins/rv-workflow`를 배포 가능한 canonical root로 사용한다.

```text
plugins/rv-workflow/
├── .codex-plugin/plugin.json
├── .mcp.json
├── skills/
│   ├── backend/
│   ├── frontend/
│   ├── document/
│   ├── qa/
│   ├── planner/
│   ├── project-toolchain/
│   ├── scoped-superpowers/
│   └── task-progress/
├── mcp/
│   ├── src/
│   └── test/
├── web/
│   ├── src/
│   └── test/
├── templates/
│   ├── AGENTS.md.fragment
│   └── .codex/
│       ├── config.toml.fragment
│       └── agents/
├── scripts/
├── package.json
├── package-lock.json
├── tsconfig.json
├── .node-version
└── README.md

.agents/plugins/marketplace.json
```

`.codex-plugin/plugin.json`은 stable lower-kebab 이름 `rv-workflow`, strict SemVer, `skills: "./skills/"`, `mcpServers: "./.mcp.json"`, 완전한 `author`와 `interface` metadata를 가진다. 자체 bundled MCP UI에는 `.app.json`이 필요하지 않으므로 만들지 않는다. lifecycle hook도 v1에서 사용하지 않는다.

`skills/`가 최종 skill source of truth다. 전환 중에는 기존 `.agents/skills`를 유지하되, 플러그인 설치와 검증이 성공한 뒤 기존 복사본을 제거하여 `backend`, `qa`, `planner` 등의 비네임스페이스 skill과 `rv-workflow:*` skill이 동시에 노출되지 않게 한다. 제거 전에는 파일별 동등성 검증을 실행한다.

custom agent TOML과 `.codex/config.toml`은 현재 plugin manifest가 자동 병합하는 구성요소가 아니다. 따라서 `templates/`에 배포하고, 설치 도구가 대상 프로젝트를 명시적으로 전달받았을 때만 dry-run, 충돌 검사, 사용자 실행 순서로 적용한다. 기존 파일은 자동 덮어쓰지 않는다.

## 5. 역할과 모델 정책

플러그인은 기존 역할 구성을 유지한다.

| Agent | Model | Reasoning | 책임 |
| --- | --- | --- | --- |
| `planner` | `gpt-5.6-sol` | `high` | 큰 작업의 spec 작성과 단계/역할 순서 결정 |
| `test-writer` | `gpt-5.6-terra` | `high` | 구현 전 비즈니스 정책 테스트 작성, production code 수정 금지 |
| `backend` | `gpt-5.6-sol` | `high` | backend 구현과 architecture/domain 판단 |
| `frontend` | `gpt-5.6-sol` | `medium` | frontend 구현, UI, UX와 접근성 |
| `document` | `gpt-5.6-luna` | `medium` | README, ERD, 계획 및 agent 문서 |
| `qa` | `gpt-5.6-terra` | `high` | 독립적인 test/lint/type/build/review/security 검증 |

설치 도구는 대상 환경에서 model ID를 사용할 수 있는지 사전 확인하거나 확인 방법을 출력한다. 사용할 수 없는 model을 임의 모델로 대체하지 않고 적용을 중단해 충돌로 보고한다.

모든 agent는 executable 작업 전 `project-toolchain` gate를 수행한다. 대상 프로젝트의 pin이 있으면 그 값을 사용하고, 충돌하거나 누락되면 다른 로컬 버전을 임의 선택하지 않는다. 플러그인 자체 MCP/UI 모듈은 아래 10절의 pin을 사용한다.

## 6. 범위 판단, Superpowers와 병렬 작업

현재 `scoped-superpowers` 정책을 유지한다.

- small: 요구가 명확하고 국소적이며 쉽게 되돌릴 수 있고 보안·데이터 위험이 낮다. Superpowers와 task tracking을 모두 생략한다.
- medium: 하나의 역할 또는 subsystem 안에서 여러 연관 변경, 동작 변경, focused test 또는 비자명한 실패가 있다.
- large/high-risk: 여러 역할·경계를 넘거나 public contract, migration, 민감 정보, 넓은 회귀 위험 또는 중요한 불확실성이 있다.

파일 수는 보조 근거일 뿐이며 uncertainty, blast radius, reversibility, operational/security risk를 우선한다. medium 이상에서만 `scoped-superpowers`를 실행하며 현재 phase에 필요한 Superpowers skill을 최대 하나만 읽는다. 기존 explicit-only 목록은 그대로 유지하고, 독립 작업이 둘 이상인 경우 `dispatching-parallel-agents`만 allow-list로 사용한다.

병렬화는 서로 다른 목표, 겹치지 않는 파일과 mutable state, 선행 결과 의존 없음, 분산 오버헤드를 상회하는 작업량을 모두 만족할 때 수행한다. agent별 step은 독립적으로 갱신하며 revision 기반 충돌 검사를 사용한다.

## 7. 진행 추적 동작

### 추적 시작 기준

- `planner`가 필요한 large/high-risk 작업은 spec의 구현 단계로 task와 step을 생성한다.
- 명확한 medium 작업은 담당 역할 agent가 구현 시작 시 task와 step을 생성한다.
- 사용자가 명시적으로 진행 추적을 요청한 경우에는 범위와 관계없이 생성한다.
- small 작업과 일반적인 status/조회/routine commit에는 task를 자동 생성하지 않는다.

### 기록 경계

agent는 모든 command를 기록하지 않는다. 다음 경계만 기록한다.

- task와 step 생성
- step 시작
- 사용자가 이해할 수 있는 주요 milestone 완료
- step 차단과 차단 이유
- step 완료 또는 명시적 skip
- 전체 task 완료

`planner → test-writer → backend/frontend/document → qa` 순서를 기본으로 하되 spec이 다른 순서를 결정할 수 있다. 계약이 확정되고 독립성이 확보된 backend/frontend/document step은 병렬 진행할 수 있다.

### 내부 상태 한계

MCP 서버는 Codex의 내부 subagent 상태를 자동 관찰한다고 가정하지 않는다. UI의 source of truth는 역할 스킬과 agent 지침이 MCP write tool로 명시적으로 기록한 이벤트다. 서버나 UI는 실제 상태를 추측하지 않으며, 오래된 상태는 `lastUpdatedAt`로 드러낸다.

## 8. 데이터 모델과 상태 전이

workspace는 canonical path의 SHA-256 key로 구분하고 UI와 model-readable result에는 전체 로컬 경로를 반환하지 않는다. 사용자가 구분할 수 있도록 안전한 workspace basename만 표시한다.

```text
TaskSnapshot
  schemaVersion
  workspaceKey
  workspaceLabel
  task: id, title, specPath?, revision, createdAt, updatedAt
  steps[]:
    id, title, role, status, dependsOn[], owner?, summary?,
    blockedReason?, startedAt?, completedAt?
  events[]:
    id, stepId?, kind, at, summary, evidenceRefs[]
```

step role은 `planner | test-writer | backend | frontend | document | qa`다. step status는 `pending | in_progress | blocked | completed | skipped`다.

허용 전이는 다음과 같다.

- `pending → in_progress | blocked | skipped`
- `in_progress → blocked | completed`
- `blocked → in_progress | skipped`
- `completed`와 `skipped`는 terminal이다.

task 진행률은 사용자가 입력한 값이 아니라 `completed / (전체 step - skipped)`로 계산해 단계 수와 함께 표시한다. 분모가 0이면 0%가 아니라 `No actionable steps` 상태로 표시한다. 하나의 병렬 step이 blocked여도 다른 runnable 또는 in-progress step이 있으면 전체 task를 blocked로 표시하지 않는다. 남은 runnable step이 없고 blocked step이 있을 때만 task 상태를 blocked로 파생한다. 모든 non-skipped step이 completed면 completed다.

이벤트는 최신 항목 중심의 제한된 로그로 유지한다. `evidenceRefs`는 workspace 내부 상대 경로 또는 검증 command label만 허용하며 secret, token, 원문 command output과 절대 경로를 저장하지 않는다.

## 9. MCP 도구 계약

### `create_task`

- 입력: `workspaceRoot`, `title`, optional `specPath`, dependency-ordered `steps`, `idempotencyKey`
- 동작: 동일 workspace와 idempotency key의 재호출은 기존 task를 반환한다.
- 출력: task ID, revision, initial snapshot summary
- annotation: state-changing, non-destructive, closed-world

### `update_task_step`

- 입력: `workspaceRoot`, `taskId`, `stepId`, `status`, optional `summary`, `blockedReason`, `evidenceRefs`, `expectedRevision`
- 동작: 허용 상태 전이와 필드 길이를 검증하고 atomic update한다.
- 동시성: revision이 다르면 덮어쓰지 않고 최신 revision을 포함한 conflict error를 반환한다. agent는 최신 snapshot을 읽고 의미가 보존될 때만 재적용한다.
- 출력: 새 revision과 갱신된 task summary
- annotation: state-changing, non-destructive, closed-world

### `get_task_progress`

- 입력: `workspaceRoot`, optional `taskId`; task ID가 없으면 최신 active task를 선택한다.
- 출력: UI 없이도 이해 가능한 완전한 `structuredContent` snapshot과 짧은 text summary
- annotation: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`

### `render_task_progress`

- 입력: `get_task_progress`와 같은 schema
- 동작: 최신 snapshot을 읽어 inline dashboard를 렌더한다.
- 출력: snapshot `structuredContent`와 model-readable summary
- metadata: 이 도구에만 `_meta.ui.resourceUri`를 연결한다.
- annotation: read-only, non-destructive, closed-world

데이터/write 도구와 render 도구를 분리한다. 모든 입력은 신뢰하지 않고 schema, 문자열 길이, status 전이, workspace/task association을 서버에서 검증한다. 오류는 `invalid_input`, `not_found`, `revision_conflict`, `invalid_transition`, `storage_error`의 안정적인 code와 복구 가능한 설명을 반환한다.

## 10. MCP 서버와 저장소

플러그인 자체 런타임은 Node.js `24.20.0`, npm `12.0.2`로 고정한다. `.node-version`, `package.json.engines`, `packageManager`, lockfile을 일치시키고 구현 시작 전에 `project-toolchain`로 활성 버전을 검증한다. TypeScript MCP 서버는 공식 `@modelcontextprotocol/sdk`와 MCP Apps resource helper를 사용하며, 의존성 버전은 최초 설치 시 lockfile로 고정한다.

`.mcp.json`은 bundled local stdio server를 `node`와 빌드된 server entrypoint로 실행한다. archive 밖의 사용자 절대 경로를 포함하지 않고 plugin root 기준의 상대 entrypoint를 사용한다. 설치 후 현재 working directory와 무관하게 시작되는지 smoke test한다.

상태는 plugin cache나 대상 repository의 tracked 파일에 저장하지 않는다. 운영체제별 사용자 state directory 아래 `rv-workflow/<workspaceKey>/state.json`에 저장한다.

- macOS: `~/Library/Application Support/rv-workflow`
- Linux: `$XDG_STATE_HOME/rv-workflow`, 미설정 시 `~/.local/state/rv-workflow`
- Windows: `%LOCALAPPDATA%/rv-workflow`

한 MCP server process 안에서는 writer queue로 갱신을 직렬화하고, temp file write, flush, atomic rename으로 저장한다. revision compare-and-swap으로 병렬 agent의 lost update를 방지한다. 손상된 파일은 자동 덮어쓰지 않고 `storage_error`로 보고하며 원본을 보존한다. 여러 독립 Codex process의 동시 쓰기가 실제 요구로 확인되면 후속 버전에서 SQLite로 승격하며 v1 범위에는 포함하지 않는다.

## 11. UI 요구사항

UI resource URI는 versioned `ui://rv-workflow/task-progress/v1.html`이고 MIME type은 `text/html;profile=mcp-app`이다. breaking HTML/JS/CSS 변경 시 URI version을 올린다.

기본 presentation은 작은 inline card다. 다음 내용을 표시한다.

- workspace label과 task title
- 파생 task status와 `완료 step / 전체 actionable step`
- role별 lane과 각 step status
- 현재 진행 중 step과 다음 runnable step
- blocked step의 구체적 이유
- 최근 event와 evidence reference
- 마지막 갱신 시각
- 수동 Refresh control

UI는 `ui/notifications/tool-result`의 `structuredContent`를 렌더하고, Refresh에서 MCP Apps `tools/call`로 `get_task_progress`를 호출한다. `window.openai.*` 호환 alias는 필수 경로로 사용하지 않으며 필요 시 capability detection 후에만 사용한다. v1은 polling하지 않는다.

UI는 읽기 전용이다. task와 step 수정은 agent의 MCP write tool만 수행한다. UI source와 server source를 분리하고 web bundle은 단일 ESM artifact로 만들어 resource HTML에 포함한다. 외부 script, font, image, API 호출을 하지 않으므로 CSP connect/resource allow-list는 비워 둔다.

### 접근성 및 반응형

- status는 색만으로 구분하지 않고 text와 icon을 함께 사용한다.
- semantic heading, list, progress semantics와 명확한 accessible name을 제공한다.
- Refresh는 keyboard로 작동하고 visible focus를 가진다.
- 갱신 결과는 `aria-live="polite"`로 과도하지 않게 알린다.
- loading, empty, stale, error, blocked, completed 상태를 각각 표현한다.
- 좁은 inline 폭에서 가로 스크롤 없이 lane을 세로로 reflow한다.
- reduced-motion 설정을 존중하고 필수적이지 않은 animation을 사용하지 않는다.
- 날짜·시간은 `document.documentElement.lang`과 `Intl.DateTimeFormat`으로 표시한다.
- tool result를 untrusted input으로 처리하며 text escaping을 유지하고 `dangerouslySetInnerHTML`을 사용하지 않는다.

dashboard는 task 생성 직후, block/completion 시점, 사용자의 명시적 진행 요청에 렌더한다. 모든 milestone마다 UI를 강제로 다시 열지 않는다.

## 12. 템플릿 설치와 전환

설치 도구는 target project path를 필수 인자로 받고 기본 동작을 dry-run으로 한다. 다음을 검사하고 보고한다.

- 기존 `AGENTS.md` 정책과 삽입 위치
- 기존 `.codex/config.toml`의 `[agents.*]` key 충돌
- 기존 `.codex/agents/*.toml` 파일 충돌
- model availability 확인 방법
- 대상 프로젝트의 runtime/engine pin 존재 여부
- 이미 설치된 동일 plugin 또는 비네임스페이스 skill 중복

실제 적용은 별도 `--apply`가 있을 때만 수행하고, 생성 또는 변경할 파일을 사전에 열거한다. 기존 파일이 있으면 통째로 교체하지 않고 적용을 중단하거나 명시적인 merge artifact를 생성한다. 저장소 밖의 프로젝트에는 구현 과정에서 이 도구를 실행하지 않는다.

repo marketplace는 `.agents/plugins/marketplace.json`에 `rv-workflow`를 `AVAILABLE`로 등록하고 source path를 `./plugins/rv-workflow`로 둔다. 플러그인 설치와 테스트가 끝난 뒤 기존 `.agents/skills` 복사본을 제거하고 plugin-prefixed skill만 discovery되는지 새 대화에서 확인한다.

## 13. 구현 단계와 역할

### 1단계: package contract와 toolchain

- 담당: `backend`, `document`
- plugin creator로 scaffold를 생성하고 manifest, marketplace, Node/npm pin, scripts와 README contract를 확정한다.
- 기존 skill 내용을 `plugins/rv-workflow/skills`로 이동하되 router body를 짧게 유지하고 relative reference를 보존한다.
- custom agent 템플릿과 충돌 검사형 installer contract를 추가한다.

### 2단계: 비즈니스 정책 테스트

- 담당: `test-writer`
- accepted spec을 기준으로 task idempotency, 상태 전이, progress 계산, blocked 파생, revision conflict, workspace 격리, storage failure와 installer no-overwrite를 테스트로 먼저 표현한다.
- suite와 scenario 이름은 구현 자료구조가 아니라 사용자가 이해할 수 있는 정책 언어를 사용한다.
- production code를 수정하지 않고, 새 테스트가 문법/fixture 문제가 아니라 누락된 동작 때문에 실패하는지 증명한다.

### 3단계: 독립 구현 스트림

계약과 테스트가 확정되면 다음을 병렬화한다.

- `backend`: MCP tool, 상태 전이, persistence, revision conflict, structured result
- `frontend`: MCP App resource, dashboard, refresh bridge, 접근성 및 반응형 상태
- `document`: README, 설치/전환 설명, agent template와 task-progress routing 문서

각 스트림은 파일 소유권을 분리하고 자신의 toolchain gate 결과를 handoff한다.

### 4단계: 통합과 중복 제거

- 담당: `backend`, `frontend`, `document`
- server와 web bundle을 연결하고 `.mcp.json`의 installed-path 실행을 확인한다.
- repo marketplace 설치를 검증한 뒤 기존 `.agents/skills` 복사본을 제거한다.
- root development config와 plugin template의 의도된 관계를 검증한다.

### 5단계: 독립 검증

- 담당: fresh `qa`
- unit/integration/UI/accessibility/build/plugin validation/marketplace smoke test를 실행한다.
- write tool의 annotation, schema validation, path redaction, no-overwrite, Superpowers negative-routing을 리뷰한다.
- 실행한 command, 활성 toolchain version, exit status, 실패와 미검증 영역을 보고한다.

## 14. 예상 변경 영역

- 추가: `plugins/rv-workflow/**`
- 추가: `.agents/plugins/marketplace.json`
- 추가/수정: plugin 및 MCP/UI test와 validation scripts
- 수정: `AGENTS.md`, `.codex/config.toml`, `.codex/agents/*.toml`의 plugin-prefixed routing과 task boundary 기록 지침
- 최종 제거: 기존 `.agents/skills/{backend,frontend,document,qa,planner,project-toolchain,scoped-superpowers}` 중 plugin package로 이전되어 중복된 복사본
- 유지: `docs/specs/**`와 이 저장소의 개발용 custom agent 구성

## 15. 검증 기준

### 정적 검증

- plugin creator의 `validate_plugin.py`가 성공한다.
- 모든 plugin skill에 대해 skill creator의 `quick_validate.py`가 성공한다.
- 모든 `SKILL.md` frontmatter에 non-empty `name`과 `description`이 있고 directory name과 `name`이 일치한다.
- 미완성 표식이나 대체용 문구가 plugin과 문서에 남지 않는다.
- Markdown relative link, manifest asset path, template path와 `.mcp.json` entrypoint가 실제 파일로 resolve된다.
- plugin archive에 사용자 절대 경로, Vote 경로, secret 또는 state file이 포함되지 않는다.
- 기존 skill과 plugin skill이 최종 discovery 결과에서 중복되지 않는다.

### 실행 검증

- `node --version`은 `v24.20.0`, `npm --version`은 `12.0.2`다.
- clean install, type-check, unit test, UI test와 production build가 성공한다.
- MCP server가 repository root와 다른 working directory에서도 stdio로 시작된다.
- MCP Inspector 또는 동등한 protocol test가 initialize, tool list, 대표/invalid 입력, output schema, annotations와 error code를 검증한다.
- 두 agent가 같은 revision을 갱신할 때 하나만 성공하고 다른 하나는 `revision_conflict`를 받는다.
- 다른 workspace key의 task가 서로 노출되지 않는다.
- plugin validator가 검사하지 않는 `.mcp.json` 실행, UI resource와 bridge 동작은 별도 smoke test로 보완한다.
- repo marketplace에서 plugin을 설치하고 새 대화에서 역할 skill direct/indirect/negative routing을 확인한다.

### UI 검증

- `render_task_progress`만 UI resource URI를 가진다.
- UI가 loading, empty, in-progress, blocked, completed, stale, storage error snapshot을 console error 없이 렌더한다.
- Refresh가 `get_task_progress`를 호출하고 새 revision을 반영한다.
- keyboard navigation, visible focus, accessible names, live announcement, narrow width와 reduced motion을 검사한다.
- component가 없어도 `get_task_progress`의 structured result와 text만으로 상태를 이해할 수 있다.

### 정책 회귀 검증

- small 질문/status/파일 조회/국소 수정/routine commit 요청은 task를 만들거나 Superpowers를 호출하지 않는다.
- medium/large 요청은 주요 단계 경계만 기록한다.
- large/cross-role 요청은 planner spec 승인 전 구현하지 않는다.
- test-writer는 production code를 수정하지 않고 테스트를 executable business policy로 작성한다.
- 독립 스트림이 둘 이상이면 병렬 agent를 사용하고, 파일이나 mutable state가 겹치면 병렬화하지 않는다.
- 각 실행 agent가 대상 프로젝트의 pinned runtime/engine을 직접 검증한다.

## 16. 완료 조건

다음이 모두 충족되면 구현 완료로 판단한다.

1. 로컬 repo marketplace에서 `rv-workflow`를 설치할 수 있다.
2. 다섯 역할 skill, 두 공통 skill, `task-progress`가 필요한 reference만 읽는 경량 구조로 동작한다.
3. 역할별 custom agent와 별도 test-writer model 설정을 opt-in 방식으로 대상 프로젝트에 적용할 수 있고 기존 파일을 덮어쓰지 않는다.
4. medium/large task의 단계, 역할, 상태, blocker, 다음 단계와 최근 event가 inline UI에 표시된다.
5. 병렬 update가 상태를 유실하지 않고 작은 작업에는 추적 및 Superpowers 오버헤드가 없다.
6. 정적·실행·UI·정책 회귀 검증이 모두 통과하고 미검증 항목이 명시된다.
7. Vote 저장소, commit, push, PR 또는 외부 프로젝트 변경이 발생하지 않는다.

## 17. 공식 참고 자료

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Plugin UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
