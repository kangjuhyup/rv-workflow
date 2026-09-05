# RV Workflow 플러그인 배포 계획

- 작성일: 2026-09-05
- 상태: 검토 요청
- 대상: `plugins/rv-workflow`
- 권장 1차 채널: 저장소 로컬 marketplace (`rv-workflow@personal`)
- 권장 릴리스 버전: `0.2.0+codex.<UTC-cachebuster>`

## 1. 배포 결정

이번 배포의 기본 목표는 현재 저장소의 로컬 marketplace를 통해 `rv-workflow`를 재현 가능하게 설치하고, 새 대화에서 스킬·MCP 도구·터미널 TUI를 검증한 뒤 제한적으로 확산하는 것이다.

public plugin directory 제출은 이번 릴리스에서 제외한다. 현재 플러그인은 `.mcp.json`이 로컬 stdio 서버를 실행하는 구조다. public 제출에는 public HTTPS MCP endpoint, 조직 권한과 검증된 개발자/사업자 신원, 공개 listing·지원·개인정보·약관 자료가 필요하므로 별도 설계와 운영 승인을 거쳐야 한다.

## 2. 현재 상태와 배포 전제

- 저장소 marketplace는 `.agents/plugins/marketplace.json`이며 이름은 `personal`, source는 `./plugins/rv-workflow`다.
- `codex plugin list`에서 `rv-workflow@personal`이 `installed, enabled`로 표시되고 설치 버전과 source manifest 버전은 모두 `0.1.0+codex.20260905060221`다.
- 플러그인 manifest는 `.codex-plugin/plugin.json`, bundled MCP 연결은 `.mcp.json`, 실제 진입점은 `scripts/start-mcp.mjs`와 빌드 산출물이다.
- 런타임은 `.node-version`과 `package.json`에서 Node `24.20.0`, npm `12.0.2`로 고정되어 있다.
- 플러그인 디렉터리는 약 150 MB이며 그중 `node_modules/`가 약 146 MB다. 배포 산출물에는 `node_modules/`를 포함하지 않고, clean install과 번들 재생성을 검증해야 한다.
- 현재 작업공간은 `main` 브랜치의 Git 저장소이고 `origin`은 `https://github.com/kangjuhyup/rv-workflow.git`이다. 아직 기준 commit/tag가 없으므로 첫 검증 commit과 immutable release archive의 SHA-256 checksum 생성은 배포의 선행 조건이다.
- 기존 명세 `docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md`에는 터미널 progress panel이 읽기 전용이라고 남아 있다. 현재 구현과 README는 확인형 allowlist 명령을 허용하므로 릴리스 전에 이 계약을 일치시켜야 한다.

## 3. 범위

### 포함

- `0.2.0` 기능 릴리스용 manifest/package 버전 정렬
- 기존 task-progress 명세와 현재 interactive TUI 계약의 정합성 복구
- clean dependency install, 타입 검사, 전체 테스트, MCP/UI build
- plugin/skill/marketplace 정적 검증
- `node_modules`, 사용자 상태, 캐시, 절대 경로와 비밀정보를 제외한 재현 가능한 release archive
- 현재 호스트에서 cachebuster 갱신과 `rv-workflow@personal` 재설치
- 설치 cache 경로에서 MCP, dashboard, TUI, 역할 스킬과 템플릿 installer 검증
- canary, 점진 배포, 관찰과 rollback drill

### 제외

- public plugin directory 제출
- public HTTPS MCP hosting, Secure MCP Tunnel, OAuth 또는 원격 인증
- marketplace JSON 수동 편집
- task-progress 사용자 상태 삭제 또는 마이그레이션
- 승인되지 않은 외부 저장소 변경, commit, push 또는 PR

## 4. 릴리스 단계

### 단계 0 — 계약 동결과 복구 지점 확보

담당: `planner`, `document`

1. 릴리스 범위를 `0.2.0` minor release로 승인한다. 이유는 기존 `--watch` 화면에 상태 변경 명령을 추가한 사용자 기능 확장이기 때문이다.
2. 이전 명세의 read-only terminal 문구를 현재 README와 일치시키되, MCP inline dashboard는 계속 read-only임을 명확히 한다.
3. 변경 요약, 호환성, 알려진 제한과 rollback 절차를 release notes 또는 CHANGELOG에 기록한다.
4. 현재 `0.1.0+codex.20260905060221` source를 immutable archive로 보관하고 SHA-256을 기록한다. 첫 검증 commit/tag가 만들어지기 전까지는 이 archive를 rollback 기준으로 사용한다.

완료 기준:

- 서로 충돌하는 읽기 전용/쓰기 가능 계약이 남지 않는다.
- 이전 버전 archive를 새 임시 디렉터리에 복원할 수 있고 checksum이 일치한다.

### 단계 1 — 재현 가능한 패키지 구성

담당: `backend`, `document`

1. `.codex-plugin/plugin.json`과 `package.json`의 base version을 `0.2.0`으로 정렬하고 lockfile의 package metadata도 일치시킨다.
2. 명시적 allowlist 기반 패키징 스크립트 또는 동일한 검증 가능한 절차를 추가한다.
3. runtime artifact에는 다음을 포함한다.
   - `.codex-plugin/plugin.json`, `.mcp.json`
   - `skills/`, `templates/`, runtime `scripts/`
   - `mcp/dist/`, `web/dist/`
   - `package.json`, lockfile, `.node-version`, README와 라이선스/릴리스 문서
4. 다음은 제외한다.
   - `node_modules/`, `coverage/`, `.DS_Store`
   - test fixture의 임시 상태와 실제 task-progress state
   - 플러그인 cache, 로그, 절대 사용자 경로와 credential
5. release archive를 빈 임시 디렉터리에 풀어 상대 경로만으로 MCP와 progress CLI가 시작되는지 확인한다.

완료 기준:

- archive 목록이 allowlist와 일치하고 `node_modules/`가 없다.
- archive SHA-256과 파일 목록 manifest가 생성된다.
- source tree 밖의 절대 경로 없이 실행된다.

### 단계 2 — 릴리스 후보 검증

담당: fresh `qa`

프로젝트 toolchain gate로 Node `24.20.0`, npm `12.0.2`를 활성화한 후 다음 gate를 순서대로 실행한다.

```sh
# 저장소 루트에서 시작
cd plugins/rv-workflow
node --version
npm --version
npm ci
npm run typecheck
npm test
npm run build
```

플러그인과 스킬은 시스템 validator로 별도 검증한다.

```sh
# 저장소 루트에서 실행
cd <repository-root>
python3 <plugin-creator-root>/scripts/validate_plugin.py plugins/rv-workflow
python3 <skill-creator-root>/scripts/quick_validate.py plugins/rv-workflow/skills/<skill-name>
python3 <plugin-creator-root>/scripts/read_marketplace_name.py \
  --marketplace-path .agents/plugins/marketplace.json
```

추가 검증:

- MCP initialize, tool list, 대표 read/write 호출, invalid input, annotation과 output schema
- dashboard loading/empty/in-progress/blocked/completed/error 상태와 Refresh
- TUI `j/k`, 상세, 검색, 필터, 새로고침, 도움말, 종료
- `:start`, `:done`, `:block`, `:skip` 확인 흐름과 revision conflict 재시도
- 종료·예외·`SIGINT`에서 raw mode와 cursor 복원
- 임의 command가 shell로 전달되지 않는 negative test
- template installer의 dry-run, 충돌 거부, 명시적 `--apply`를 임시 프로젝트에서 검증
- artifact에서 사용자 절대 경로, credential, state file과 불필요한 dependency tree가 없는지 검사

완료 기준:

- 모든 gate가 exit 0이고 경고와 미검증 항목이 release record에 남는다.
- source 디렉터리가 아니라 추출한 release artifact와 설치 cache에서도 smoke test가 성공한다.

### 단계 3 — cachebuster 갱신과 현재 호스트 canary

담당: release operator, `qa`

marketplace 파일을 직접 수정하지 않는다. 이름을 helper로 검증한 뒤 manifest cachebuster를 한 번만 교체한다.

```sh
# 저장소 루트에서 실행
cd <repository-root>
python3 <plugin-creator-root>/scripts/read_marketplace_name.py \
  --marketplace-path .agents/plugins/marketplace.json
python3 <plugin-creator-root>/scripts/update_plugin_cachebuster.py \
  plugins/rv-workflow
python3 <plugin-creator-root>/scripts/validate_plugin.py \
  plugins/rv-workflow
codex plugin add rv-workflow@personal
codex plugin list
```

`update_plugin_cachebuster.py`는 `0.2.0` base version을 유지하고 `+codex.<UTC-cachebuster>`만 설정해야 한다. 현재 marketplace는 이미 Codex에 노출되어 있으므로 canary 호스트에서는 `codex plugin marketplace add`를 다시 실행하지 않는다.

로컬 marketplace는 `./plugins/rv-workflow` source를 참조하므로, 설치 직전 source를 동결하고 그 파일 목록과 내용 checksum이 승인된 release archive와 일치하는지 확인한다. canary 중에는 이 source를 수정하지 않는다.

재설치 후 Codex/ChatGPT desktop을 다시 열고 새 대화를 시작한다. 기존 대화는 새 스킬과 MCP metadata를 release acceptance 근거로 사용하지 않는다.

canary acceptance:

- `codex plugin list`가 `rv-workflow@personal`, exact release version, expected source를 표시한다.
- 새 대화에서 `rv-workflow:*` 스킬과 `rv-workflow-progress` MCP 도구가 노출된다.
- 저장소 밖 임시 workspace에서 task 생성→시작→완료와 TUI 확인 흐름이 성공한다.
- 기존 task state schema version 1 데이터가 유지되고 읽힌다.

### 단계 4 — 점진 배포

담당: release operator

1. **Canary:** maintainer 1명, 임시 workspace 1개에서 1일 또는 합의한 최소 검증 기간 운영.
2. **Limited:** 실제 프로젝트 1~2개에 opt-in 설치. custom-agent 템플릿은 먼저 dry-run하고 충돌이 없는 프로젝트에만 `--apply`한다.
3. **General local/team:** 검증된 archive, checksum, marketplace 설정 방법, release notes와 rollback 절차를 함께 전달한다.

새 호스트의 marketplace가 자동 발견되지 않을 때만 repo marketplace root를 한 번 등록한 뒤 설치한다. marketplace 이름과 source가 다른 경우 설치를 중단하고 `codex plugin list`로 실제 local source를 먼저 확인한다.

진행 판단 지표:

- 설치·MCP 시작 성공률
- 새 대화에서 스킬 및 tool discovery 성공 여부
- task state read/write, revision conflict, TUI cleanup 실패
- template installer 충돌 또는 model availability 실패
- rollback 필요 여부와 소요 시간

### 단계 5 — 배포 후 확인

담당: `qa`, `document`

1. release version, artifact SHA-256, 검증 결과, canary 결과를 release record에 고정한다.
2. README 설치 예제와 실제 marketplace 경로/명령을 다시 대조한다.
3. cache와 source가 다른 버전을 가리키지 않는지 `codex plugin list`로 확인한다.
4. 후속 개선은 새 base version에서 시작하고, 단순 로컬 반복만 cachebuster를 교체한다.

## 5. 롤백 계획

롤백 트리거:

- MCP server 시작 실패 또는 tool schema 누락
- task state 손상, workspace 격리 또는 revision 보호 회귀
- TUI가 raw mode/cursor를 복원하지 못함
- 역할 스킬 discovery나 custom-agent template 적용이 기존 프로젝트를 방해함

절차:

1. 새 설치 확산을 중지하고 현재 progress panel을 정상 종료한다.
2. 보관한 `0.1.0+codex.20260905060221` archive의 checksum을 확인해 source를 복원한다.
3. rollback임을 식별할 새 cachebuster 하나를 적용하고 plugin validator를 실행한다.
4. `codex plugin add rv-workflow@personal`로 재설치한다.
5. 앱을 재시작하고 새 대화에서 스킬·MCP·기존 task state 읽기를 smoke test한다.
6. task-progress state는 플러그인 밖에 있고 schema 변경이 없으므로 삭제하지 않는다. 손상 의심 시에도 원본을 보존하고 별도 복사본에서 진단한다.

목표 복구 시간은 30분 이내로 두며, canary 전에 rollback drill로 실제 충족 여부를 측정한다.

## 6. 주요 위험과 완화

| 위험 | 영향 | 완화 |
| --- | --- | --- |
| 기준 Git 이력 부재 | 정확한 이전 버전 복원이 어려움 | 첫 검증 commit/tag와 immutable archive, 파일 목록, SHA-256을 hard gate로 설정 |
| mutable local source | 재설치 시 의도하지 않은 파일까지 포함 | release freeze 후 source와 allowlist archive의 파일 목록/checksum 일치를 확인하고 canary 중 수정 금지 |
| 146 MB `node_modules` | 느린 복사, 비결정적 dependency 포함 | archive 제외, `npm ci`와 bundled dist 검증 |
| source/cache 버전 불일치 | 오래된 스킬·MCP 실행 | 한 번의 cachebuster 갱신, 재설치, 새 대화, `codex plugin list` 확인 |
| interactive TUI 계약과 이전 명세 충돌 | 잘못된 QA/운영 기대 | 단계 0에서 명세와 README 정합성 복구 |
| custom-agent 템플릿 충돌 | 대상 프로젝트 설정 손상 | dry-run 기본값, no-overwrite, limited rollout |
| public 제출을 로컬 배포로 오인 | 제출 실패와 운영 공백 | public HTTPS MCP 전환을 별도 프로젝트로 분리 |

## 7. Public directory 후속 트랙

public 배포를 원할 경우 다음 결정을 먼저 승인해야 한다.

1. 로컬 stdio MCP를 public streamable HTTP `/mcp` endpoint로 제공할 hosting과 운영 주체
2. 인증이 필요한지, workspace/task state를 어떤 tenant 경계로 저장할지
3. 도메인 검증, CSP, 개인정보 처리방침, 약관, 지원 URL과 incident 대응
4. OpenAI Platform 조직의 Apps Management write 권한과 검증된 developer/business identity
5. 제출용 5개 positive 및 3개 negative test case, 국가/지역 availability

이 트랙은 현재 로컬 플러그인의 단순 재패키징이 아니라 backend hosting, authentication, persistence와 운영 경계를 추가하는 별도 large/high-risk 명세로 취급한다.

## 8. 승인 기준

다음 세 결정을 승인하면 배포 구현을 시작할 수 있다.

1. 1차 채널을 현재 repo/local marketplace로 제한한다.
2. 기능 릴리스 base version을 `0.2.0`으로 사용한다.
3. 첫 검증 commit/tag와 immutable archive+SHA-256을 함께 rollback 기준으로 채택한다.

승인 후 권장 실행 순서는 `document → backend/package → fresh qa → release operator canary → limited rollout`이다.

## 9. 참고 자료

- [OpenAI: Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: Submit plugins](https://developers.openai.com/plugins/deploy/submission)
- `plugins/rv-workflow/README.md`
- `plugins/rv-workflow/.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `docs/specs/2026-09-04-rv-workflow-plugin-task-progress-ui.md`
