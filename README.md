# Coding Dojo

브라우저에서 바로 풀고 채점하는 코딩 테스트 연습 사이트. React + TypeScript + Vite, GitHub Pages 배포.

- 사이트: https://kyhsa93.github.io/coding-dojo/
- 언어: JavaScript, TypeScript(sucrase 로 브라우저 변환), Python(Pyodide, 브라우저 안에서 실행)
- 채점: 문제마다 준비된 테스트 케이스를 Web Worker 에서 실행하고, 워커가 돌려준 반환값을 메인 스레드가 기대값과 비교한다(아래 「채점 규칙」). 테스트당 3초, 한 번 실행 전체 30초 제한. Python 런타임을 내려받는 시간은 제한에 들지 않는다.
- PWA: 홈 화면에 설치할 수 있고, 앱 셸과 문제 데이터는 서비스 워커가 미리 캐시한다. Python 런타임(Pyodide)은 처음 한 번 CDN 에서 받은 뒤 캐시에서 쓰므로 그 뒤로는 오프라인에서도 채점된다. 아이콘은 `node scripts/make-icons.mjs` 로 다시 만든다.
- 문제 추가: GitHub Actions 가 Ollama(qwen3:14b) 로 문제를 생성하고, 참고 풀이를 실제로 실행해 테스트 기대값을 만든 뒤 검증을 통과한 문제만 커밋.

## 개발

Node 22.18 이상(테스트가 TypeScript 파일을 타입 스트리핑으로 바로 실행한다).

```bash
npm install
npm run dev        # http://localhost:5173/coding-dojo/
npm test           # problems/*.json 스키마 + 참고 풀이 검증, scripts/lib 와 tests/ 의 테스트
npm run build
npm run e2e        # 빌드 결과를 띄워 브라우저로 확인(Playwright, 처음엔 npx playwright install chromium)
```

`tests/` 는 비교 규칙(`deepEqual.test.ts`, 모든 문제에서 이전 비교와 판정이 같은지도 확인), JS/TS 변환, 러너, 워커 세션(가짜 워커로 요청·응답 매핑, 취소, 시간 제한, 런타임 로딩 실패·재시도), 실제 `worker_threads` 로 돌리는 JS/TS 통합 테스트(무한 루프, 동시 실행, 전역 오염)다. Python(Pyodide)은 Node 테스트에 없고 `e2e/` 가 브라우저에서 확인한다. `e2e/` 는 JS/TS·Python 흐름, 네트워크 차단(CSP 를 끈 대조군과 비교), 오프라인, CDN 실패 뒤 재시도, 한글 조합 입력, 스크린리더 알림 영역, 키보드 포커스, 모바일 가로 넘침을 CI 에서 본다. `E2E_BASE=https://kyhsa93.github.io/coding-dojo/ npm run e2e` 면 운영 사이트를 본다.

## 채점 규칙

- 같은 실행 안의 테스트는 순서대로 돌고, 각 테스트는 입력의 복사본을 받는다.
- JavaScript/TypeScript 는 실행마다 새 워커에서 돈다. 전역이나 프로토타입을 고쳐도 다음 실행에 남지 않는다. Python 은 런타임(Pyodide)을 다시 띄우는 데 몇 초가 걸려 워커를 재사용하되, 제출마다 새 이름공간에서 실행하므로 이전 제출의 함수·변수가 보이지 않는다(`sys.modules` 와 `sys.setrecursionlimit` 같은 인터프리터 전체 상태는 남는다).
- JavaScript/TypeScript 는 Sucrase 로 변환한다. TypeScript 문법, `export`/`export default`, `import type` 은 그대로 쓸 수 있고, 외부 모듈 `import` 는 모듈 이름을 담은 오류가 된다. 문법 오류는 줄·열을 표시한다.
- 비교(`src/lib/deepEqual.ts`):
  - 정수끼리는 정확히 비교한다. 2^53 을 넘는 정수(Python 큰 정수)는 기대값이 JSON 숫자라 그 이상 정밀할 수 없으므로 double 정밀도로 비교한다.
  - 정수가 아닌 수는 절대 오차 1e-6 까지 같다고 본다. 문제 파일의 `tolerance` 로 바꿀 수 있고 0 이면 정확히 비교한다. 둘 다 정수가 아닐 때만 크기의 1e-9 배 상대 오차도 허용한다.
  - NaN, Infinity 는 자기 자신과만 같다(기대값은 유한한 JSON 이라 이 값을 돌려주면 항상 틀린다).
  - `undefined` 와 `null` 은 같게 본다(return 이 없는 함수는 null 을 돌려준 것으로 본다).
  - 배열은 원소 순서대로 비교하고 객체와는 같지 않다. 객체는 키 집합과 값으로 비교한다. Set 은 삽입 순서대로 배열로, Map 은 키를 문자열로 바꾼 객체로 바꿔 비교한다. 순환 참조가 있는 반환값은 그 테스트의 오류가 된다.
- 시간 제한에 걸리면 그 테스트는 「시간 초과」, 뒤의 테스트는 「실행 안 함」이 되고 워커는 종료된다. 실행 중에 「중단」을 누르거나 문제를 떠나도 같은 방식으로 멈춘다.

## 실행 환경과 보안

제출한 코드는 이 사이트 출처(`kyhsa93.github.io`) 의 Web Worker 에서 `new Function`(JS/TS) 또는 Pyodide(Python)로 실행된다. 워커는 DOM·localStorage 에 닿지 못하지만 보안 샌드박스는 아니다. 지금 막는 것:

- 네트워크: 빌드한 페이지에 Content-Security-Policy 메타 태그를 넣고(`vite.config.ts`), 워커를 blob URL 에서 시작해 그 정책을 물려받게 한다(`src/judge/client.ts`). GitHub Pages 는 워커 스크립트에 CSP 헤더를 붙일 수 없어서 이 방식만 가능하다. `connect-src`·`script-src` 가 이 사이트와 Pyodide 배포 경로(`cdn.jsdelivr.net/pyodide/v0.27.7/full/`, CDN 전체가 아니다)만 허용하므로 `fetch`·`import()` 로 그 밖의 주소에 요청을 보낼 수 없다(Chromium 에서 CSP 를 끈 대조군과 비교해 확인).
- 같은 출처의 저장소와 중첩 워커: 워커가 시작할 때(Python 은 런타임을 받은 뒤) `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `navigator.storage`, `navigator.storageBuckets`, `navigator.locks`, Chromium 의 옛 파일 시스템 API, `Worker`, `postMessage` 등을 지운다(`src/judge/lockdown.ts`). 전역 삭제는 우회될 수 있는 보조 수단이다.
- 채점 조작: 워커는 기대값을 받지 않고 반환값만 돌려주며, 비교는 메인 스레드에서 한다. 응답은 실행마다 새로 만든 무작위 id 로만 받는다.
- 무한 루프·과도한 실행: 테스트당·전체 시간 제한이 지나면 워커를 종료한다. 출력은 20,000자에서 자른다.

남는 한계:

- `kyhsa93.github.io` 는 블로그와 다른 하위 사이트가 함께 쓰는 출처다. 그 출처의 IndexedDB·Cache Storage 를 막는 것은 전역 삭제뿐이고, 이것은 브라우저가 보장하는 경계가 아니어서 우회 방법이 없다고 장담할 수 없다. 완전히 막으려면 채점을 별도 출처(다른 도메인의 iframe)로 옮겨야 하는데, 그러면 서비스 워커 캐시를 쓰는 오프라인 Python 채점을 다시 설계해야 해서 이번에는 하지 않았다.
- 메모리 사용량 제한은 없다. 큰 배열을 만들면 보통 시간 제한으로 끝나지만, 메모리가 작은 기기에서는 탭 전체가 죽을 수 있다(작성 중인 코드는 입력할 때마다 저장되므로 남는다). 반환값 크기 제한도 없다.
- Python 코드는 `import js` 로 같은 워커의 JavaScript 전역을 바꿔 같은 탭의 다음 Python 실행에 영향을 줄 수 있다. 자기 실행에만 영향을 주므로 그대로 둔다.
- 해결 기록은 브라우저 localStorage 에만 있고 위조할 수 있다. 연습용 기록이지 인증이 아니다.
- CSP 상속과 채점은 Chromium, Playwright Firefox·WebKit 에서 확인했다. 오프라인 동작은 Chromium 에서만 확인했고, 실제 Safari·iOS 는 확인하지 못했다. 어떤 브라우저에서 CSP 가 상속되지 않으면 `fetch` 류는 전역 삭제로만 막히고, 삭제로 막을 수 없는 `import()` 는 어느 호스트로든 열린다.
- 개발 서버(`npm run dev`)에는 CSP 를 넣지 않는다(핫 리로드가 인라인 스크립트를 쓴다).

## 문제 파일

`problems/<id>.json` 하나가 문제 하나. 주요 필드:

| 필드 | 설명 |
|---|---|
| `functionName`, `params`, `returnType` | 사용자가 구현할 함수 시그니처 |
| `starterCode` | 언어별 초기 코드 |
| `examples` | 화면에 보여 주는 예제 (입력, 기대값, 설명) |
| `tests` | 채점용 테스트 (입력, 기대값). 최소 6개 |
| `tolerance` | (선택) 정수가 아닌 수의 허용 절대 오차. 기본 1e-6, 0 이면 정확히 비교 |
| `solution` | JavaScript 참고 풀이. `npm test` 가 이 풀이로 모든 테스트를 다시 실행해 기대값과 일치하는지 확인 |

직접 추가할 때는 `solution` 과 입력만 쓰고 기대값은 풀이를 실행해 채우는 것을 권장. 예: `scripts/generate-problem.mjs` 의 `buildProblem` 과 같은 방식.

## 자동 생성

`.github/workflows/generate-problem.yml`

- 매주 월요일 02:00 KST 자동 실행, 또는 Actions 탭에서 수동 실행(슬롯 수, 주제, 난이도, 러너 지정 가능).
- 병렬 슬롯: `count` 는 동시에 도는 잡 수다(최대 8, 슬롯마다 문제 최대 1개). `plan` 잡이 `scripts/plan-slots.mjs` 로 슬롯을 계획하고, 슬롯 잡들이 각자 Ollama 를 띄워 생성·검증·지문 검수까지 한 뒤 후보를 아티팩트로 올리면, `collect` 잡이 모아서 같은 id·제목·핵심 알고리즘인 후보를 걸러 내고(`scripts/lib/collect.mjs`) PR 하나를 연다. 한 실행의 벽시계 시간은 슬롯 하나 분량(hard 기준 약 20분 + 준비 2분)이다. hard 슬롯은 서로 다른 아키타입으로 시작하고 형제 슬롯의 아키타입은 피한다(`ARCHETYPE_FIRST`, `ARCHETYPE_EXCLUDE`). 병렬 잡은 서로의 거부 후보를 보지 못하므로 비슷한 문제가 두 번 나올 수 있고, 그건 수집 단계의 중복 제거에 맡긴다.
- 러너: 기본은 `ubuntu-24.04-arm` 이다. 2026-11-01 측정에서 qwen3:14b 생성이 x64(`ubuntu-latest`) 2.5~2.8 tok/s 대비 ARM 3.4~3.9 tok/s 로 약 30% 빨랐고 둘 다 공개 저장소에서 무료다. `runner` 입력으로 바꿀 수 있고, 설치 단계가 아키텍처에 맞는 Ollama 바이너리를 받는다. 예약 실행은 슬롯 3개로 돈다.
- 소재(`scripts/lib/domains.mjs`): 주제가 기법을 정하면 소재는 이야기를 정한다. 백엔드 서비스(요청 로그, 레이트 리밋, 멱등키, 재시도, 작업 큐, 캐시 축출), 컨테이너·오케스트레이션(이미지 레이어, 파드 스케줄링, 롤링 배포, 프로브), AWS(S3 수명 주기, IAM 정책 평가, VPC CIDR, 오토스케일링, SQS, Lambda 동시성, 태그별 비용), 데이터베이스, 네트워킹, CI/CD 여섯 가지가 있고, 시도의 60% 에 무작위 소재가 붙어 그 현장의 용어와 자료 구조로 문제를 내며 태그에 소재가 들어간다. 나머지는 소재 없는 알고리즘 문제다. 수동 실행의 `domain` 입력(또는 `DOMAIN` 환경변수)에 키를 넣으면 고정, `none` 이면 소재 없이 생성한다.
- 러너에 Ollama 를 설치하고 `qwen3:14b` 를 받아 로컬에서 생성. 외부 유료 API 는 쓰지 않는다.
- 모델은 문제 설명, 참고 풀이, 테스트 **입력**만 만든다. 기대값은 풀이를 실행해 계산하므로 풀이와 테스트가 어긋날 수 없다. 모델이 자주 하는 형식 실수 두 가지는 거부하지 않고 복구한다: 타입 주석이 붙은 풀이·brute force 는 sucrase 로 벗겨 쓰고, 매개변수가 하나인 함수의 테스트를 인자 목록 대신 인자 자체로 쓴 경우(`[5, 7]`, `[[1,2,3],[4]]`)는 감싸서 받는다.
- 검증(스키마, 테스트 8개 이상, 결과가 전부 같은 사소한 문제 거부, 참고 풀이 재실행)을 통과한 문제만 `problems/` 에 쓴다. 생성된 문제는 main 에 바로 올리지 않고 `problems/run-<run id>` 브랜치에 커밋해 PR 을 연다. PR 본문에 문제 요약, 제외된 후보, 아래 지문 검수 보고서가 들어가며, 사람이 보고 병합하면 Pages 배포가 돈다. 봇이 PR 을 열려면 저장소 Settings > Actions > General > Workflow permissions 의 "Allow GitHub Actions to create and approve pull requests" 가 켜져 있어야 한다(꺼져 있으면 브랜치만 push 되고 잡이 compare 링크를 남긴다). 봇이 연 PR 에는 CI 워크플로우가 돌지 않으므로 `npm test` 는 슬롯 잡과 수집 잡 안에서 먼저 통과시킨다.
- 지문 검수(`scripts/lib/audit.mjs`): 게이트와 교차 검증은 풀이·brute force·독립 풀이가 테스트에서 일치함을 보일 뿐, 지문을 읽은 사람이 같은 규칙에 도달한다는 보장은 아니다(첫 hard 문제는 풀이가 내림차순 인접 자리도 제외하는데 지문은 12, 23 만 들었다). 그래서 생성·재판정 뒤에 모델이 지문을 풀이·테스트와 대조해 "풀이는 적용하지만 지문에 없는 규칙"을 심각도(high = 지문대로 풀면 테스트 실패)·근거·제안 문장과 함께 적고, 기계 검사(제약 언급, 예제 설명, 빈 입력·0/1 테스트 유무, 기대값 다양성)를 덧붙인다. 보고서는 PR 본문과 잡 요약에 들어가며 게이트는 아니다. 기존 문제는 수동 실행의 `audit` 입력에 id 를 넣으면 보고서만 남긴다. 로컬: `node scripts/audit-problems.mjs <id>`.
- 교차 검증: 검증을 통과한 문제의 **지문만** 모델에 다시 주고 독립적인 풀이를 쓰게 한 뒤, 예제와 테스트 입력에서 참고 풀이와 결과가 같아야 통과한다(두 번 시도, 하나라도 일치하면 통과). 독립 풀이가 시간 초과한 입력(hard 의 큰 입력에 순진한 풀이)은 의미 검사가 아니므로 무시하되, 6개 이상 입력에서 일치해야 한다. 지문이 모호하거나 풀이가 지문을 구현하지 않은 문제를 걸러낸다. 불일치 입력과 두 결과를 다음 시도 프롬프트에 넣는다.
- 난이도 판정: 교차 검증을 통과한 문제를 같은 모델에 다시 보여 주고 실제 난이도와 핵심 알고리즘을 묻는다(`scripts/lib/judge.mjs`). 요청 난이도와 한 단계 차이면 라벨을 판정값으로 고쳐 쓰고, 두 단계 차이(easy↔hard)면 거부하고 다음 시도 프롬프트에 거부 사유를 넣는다. 판정 결과는 문제 파일의 `judge` 필드에 남는다.
- 기존 문제 재판정: Actions 수동 실행에서 `rejudge` 에 문제 id(쉼표 구분) 또는 `all` 을 넣으면 생성 대신 재판정만 하고 라벨 변경분을 같은 방식으로 PR 로 올린다. 두 단계 차이 문제는 고치지 않고 로그에 FLAG 로만 남긴다. 로컬: `npm run judge -- <id>`.

### hard 문제: 아키타입 + 성능 게이트

모델에게 "어려운 문제를 내라"고만 하면 주제 안에서 가장 익숙한 쉬운 문제로 수렴한다(주식 수익, 문자열 압축 등). 그래서 hard 는 난이도를 모델이 정하지 않고 다음 두 장치로 만든다.

- 아키타입(`scripts/lib/archetypes.mjs`): 주제별로 사람이 적어 둔 hard 기법 목록(구간 DP, 비트마스크 DP, 상태 포함 다익스트라, 모노토닉 스택, 펜윅 트리, KMP 등 40개). hard 슬롯은 주제에 맞는 아키타입을 하나 뽑아 "풀이는 반드시 이 기법을 구현해야 한다"고 지시하고, 판정 모델에게는 난이도 대신 `usesTechnique`(그 기법을 실제로 구현했는가)를 묻는다. 같은 아키타입으로 2회 연속 실패하면 다음 시도는 다른 아키타입을 쓴다. 요청 주제에 아키타입이 없으면 무작위 아키타입의 주제로 바꿔 생성한다.
- 성능 게이트(`scripts/lib/perf-gate.mjs`): 문제·풀이·테스트를 받은 뒤 **별도 호출**로 같은 시그니처의 `bruteForce` 를, 그다음 상한 크기 입력을 결정적으로 만드는 `largeInput` 함수를 받는다(`scripts/lib/hard-stages.mjs`). 각 단계는 실패 사유를 넣어 최대 3회 다시 묻고, 문제 자체는 다시 만들지 않는다. brute force 프롬프트에는 가장 작은 테스트 4개의 입력과 기대값을 앵커로 넣어 빈 입력 같은 경계 사례를 못 박고, 큰 입력 프롬프트는 크기만이 아니라 brute force 의 최악 경우 모양을 요구한다. 풀이가 어떤 테스트에서 undefined 를 돌려주면(반환 타입이 null 허용이 아닌 한) 그 문제는 거부된다. 통과 조건은 (1) `largeInput` 이 결정적이고 인자 수가 맞음, (2) brute force 가 작은 테스트 전부에서 참고 풀이와 같은 값(두 번째 오라클), (3) 참고 풀이가 큰 입력을 1초 안에 끝냄, (4) brute force 는 2초 안에 못 끝냄. 통과한 문제는 판정 모델이 medium 이라 해도 hard 로 유지하고 판정 의견은 `judge.opinion` 에 남긴다. 증거는 `judge.performance`, 아키타입 키는 `judge.archetype` 에 기록한다. 큰 입력은 JSON 400KB 이하일 때만 테스트에 추가한다(번들 크기 때문).
- 호출 분할(`HARD_GENERATION=split`, 기본): hard 는 한 호출로 지문·풀이·테스트를 다 받지 않고, 먼저 지문·시그니처·예제·힌트만 받은 뒤(`buildSpecPrompt`/`buildSpec`) 그 지문을 보여 주고 풀이와 테스트 입력만 다시 받는다(`buildImplPrompt`/`obtainImplementation`). 한 호출의 답이 3000 토큰을 넘으면 14b 모델이 CPU 러너에서 퇴화·끊김·타입 주석을 내기 쉬운데, 두 답은 각각 그 절반이고 풀이가 거부되면 지문은 그대로 두고 풀이만 사유를 넣어 최대 3회 다시 받는다. brute force 가 풀이와 같은 입력에서 계속 어긋나면(지문은 분명한데 풀이가 틀린 경우가 많다) 그 증거를 넣어 풀이만 한 번 더 다시 받는다. `HARD_GENERATION=single` 로 예전 한 호출 방식으로 돌릴 수 있다. 2026-11-01 비교 실행에서 한 호출 방식(qwen2.5-coder:14b)은 9번 시도 중 1번만 형식 검증을 통과한 반면 분할 방식(qwen3:14b)은 11번 중 7번이 통과해 성능 게이트까지 갔다.
- 워크플로우 `archetype` 입력(또는 `ARCHETYPE` 환경변수)에 키를 넣으면 그 아키타입으로 hard 를 고정 생성한다. 예: `ARCHETYPE=dp-lis-nlogn npm run generate`.
- 시간 예산: 모델 호출 하나는 `OLLAMA_CALL_TIMEOUT_MS`(기본 20분)를 넘기면 끊고, 같은 토막이 반복되거나 공백만 이어지는 퇴화 출력도 바로 끊는다(로그에 어느 쪽인지 남는다). `GENERATION_BUDGET_MINUTES`(워크플로우는 60)가 지나면 새 시도·단계 호출을 시작하지 않으므로, 그때까지 만든 문제는 잡 제한(90분) 안에서 검증·커밋된다. 각 호출의 토큰 수·속도는 로그에 남는다.
- 거부된 후보는 제목과 함께 판정 모델이 뽑은 핵심 알고리즘 문장도 회피 목록에 넣어, 이름만 바꾼 같은 문제가 돌아오는 것을 막는다.

로컬에서 돌리려면 Ollama 를 띄운 뒤:

```bash
OLLAMA_MODEL=qwen3:14b COUNT=2 TOPIC=graph-bfs DIFFICULTY=medium npm run generate
```
