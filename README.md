# Coding Dojo

브라우저에서 바로 풀고 채점하는 코딩 테스트 연습 사이트. React + TypeScript + Vite, GitHub Pages 배포.

- 사이트: https://kyhsa93.github.io/coding-dojo/
- 언어: JavaScript, TypeScript(sucrase 로 브라우저 변환), Python(Pyodide, 브라우저 안에서 실행)
- 채점: 문제마다 준비된 테스트 케이스를 Web Worker 에서 실행해 결과를 깊은 비교로 판정. 테스트당 3초 제한.
- PWA: 홈 화면에 설치할 수 있고, 앱 셸과 문제 데이터는 서비스 워커가 미리 캐시한다. Python 런타임(Pyodide)은 처음 한 번 CDN 에서 받은 뒤 캐시에서 쓰므로 그 뒤로는 오프라인에서도 채점된다. 아이콘은 `node scripts/make-icons.mjs` 로 다시 만든다.
- 문제 추가: GitHub Actions 가 Ollama(qwen3:14b) 로 문제를 생성하고, 참고 풀이를 실제로 실행해 테스트 기대값을 만든 뒤 검증을 통과한 문제만 커밋.

## 개발

```bash
npm install
npm run dev        # http://localhost:5173/coding-dojo/
npm test           # problems/*.json 스키마 + 참고 풀이 검증
npm run build
```

## 문제 파일

`problems/<id>.json` 하나가 문제 하나. 주요 필드:

| 필드 | 설명 |
|---|---|
| `functionName`, `params`, `returnType` | 사용자가 구현할 함수 시그니처 |
| `starterCode` | 언어별 초기 코드 |
| `examples` | 화면에 보여 주는 예제 (입력, 기대값, 설명) |
| `tests` | 채점용 테스트 (입력, 기대값). 최소 6개 |
| `solution` | JavaScript 참고 풀이. `npm test` 가 이 풀이로 모든 테스트를 다시 실행해 기대값과 일치하는지 확인 |

직접 추가할 때는 `solution` 과 입력만 쓰고 기대값은 풀이를 실행해 채우는 것을 권장. 예: `scripts/generate-problem.mjs` 의 `buildProblem` 과 같은 방식.

## 자동 생성

`.github/workflows/generate-problem.yml`

- 매주 월요일 02:00 KST 자동 실행, 또는 Actions 탭에서 수동 실행(문제 수, 주제, 난이도 지정 가능).
- 러너에 Ollama 를 설치하고 `qwen3:14b` 를 받아 로컬에서 생성. 외부 유료 API 는 쓰지 않는다.
- 모델은 문제 설명, 참고 풀이, 테스트 **입력**만 만든다. 기대값은 풀이를 실행해 계산하므로 풀이와 테스트가 어긋날 수 없다.
- 검증(스키마, 테스트 8개 이상, 결과가 전부 같은 사소한 문제 거부, 참고 풀이 재실행)을 통과한 문제만 `problems/` 에 커밋하고, 커밋되면 Pages 배포가 이어서 돈다.
- 난이도 판정: 검증을 통과한 문제를 같은 모델에 다시 보여 주고 실제 난이도와 핵심 알고리즘을 묻는다(`scripts/lib/judge.mjs`). 요청 난이도와 한 단계 차이면 라벨을 판정값으로 고쳐 쓰고, 두 단계 차이(easy↔hard)면 거부하고 다음 시도 프롬프트에 거부 사유를 넣는다. 판정 결과는 문제 파일의 `judge` 필드에 남는다.
- 기존 문제 재판정: Actions 수동 실행에서 `rejudge` 에 문제 id(쉼표 구분) 또는 `all` 을 넣으면 생성 대신 재판정만 하고 라벨 변경분을 커밋한다. 두 단계 차이 문제는 고치지 않고 로그에 FLAG 로만 남긴다. 로컬: `npm run judge -- <id>`.

로컬에서 돌리려면 Ollama 를 띄운 뒤:

```bash
OLLAMA_MODEL=qwen3:14b COUNT=2 TOPIC=graph-bfs DIFFICULTY=medium npm run generate
```
