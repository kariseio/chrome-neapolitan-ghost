# 크롬 익스텐션 개발 · 테스트 · 배포 가이드

이 문서는 '괴담' 확장을 만들며 실제로 겪은 것들을 바탕으로 정리한 실전 가이드입니다.
Manifest V3(MV3) 기준.

## 목차
1. [만들기](#1-만들기)
2. [테스트하기](#2-테스트하기)
3. [게시·배포하기](#3-게시배포하기)
4. [부록: 명령어 모음](#부록-명령어-모음)

---

## 1. 만들기

### 1.1 최소 구조

크롬 확장은 **폴더 하나 + `manifest.json`** 이면 시작됩니다. 빌드 도구 없이 순수 JS/HTML/CSS로 됩니다.

```
my-extension/
├── manifest.json      # 필수 — 확장의 명세서
├── background.js      # 서비스 워커 (선택)
├── content.js         # 페이지에 주입되는 스크립트 (선택)
├── popup.html         # 툴바 팝업 (선택)
└── icons/             # 아이콘들 (게시 시 필수)
```

최소 `manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "확장 이름",
  "version": "0.1.0",
  "description": "한 줄 설명",
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

### 1.2 핵심 구성요소

| 구성요소 | 역할 | 실행 위치 |
|---|---|---|
| **manifest.json** | 권한·구성·진입점 선언 | — |
| **background (service worker)** | 이벤트 처리·상태 관리·탭 제어 | 백그라운드(비상주) |
| **content script** | 웹페이지 DOM 조작·읽기 | 각 웹페이지(격리 세계) |
| **action** | 툴바 아이콘·클릭·팝업 | 브라우저 UI |
| **확장 페이지** | `chrome-extension://` 로 여는 자체 HTML | 탭/팝업 |

- **background service worker**: `manifest`의 `"background": { "service_worker": "background.js" }`. 이벤트(설치·알람·메시지·탭 변화)에 반응.
- **content script**: `manifest`의 `content_scripts`로 선언하면 매칭되는 페이지에 자동 주입. 페이지와 **DOM은 공유하지만 JS 변수는 격리**됨.
- **action**: `"action": {}` 만 선언하면 툴바 버튼이 생기고, 팝업이 없으면 클릭이 `chrome.action.onClicked`로 들어옴.

### 1.3 권한 (최소 권한 원칙)

```json
"permissions": ["tabs", "storage", "alarms", "scripting"],
"host_permissions": ["<all_urls>"]
```
- `permissions`: 크롬 API 권한(위험도 낮음).
- `host_permissions`: 특정 사이트 접근. `<all_urls>` 는 강력해서 **심사가 깐깐**해짐 → 꼭 필요한 만큼만.
- **심사·사용자 신뢰를 위해 권한은 최소로.** 예: 특정 사이트만 필요하면 `"https://example.com/*"` 처럼 좁힌다.

### 1.4 자주 쓰는 API 패턴

**메시지 통신 (background ↔ content):**
```js
// content.js — 배경에 물어보기
chrome.runtime.sendMessage({ type: "am-i-active" }, (res) => { /* ... */ });

// background.js — 받고 응답
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "am-i-active") { sendResponse({ active: true }); return true; } // 비동기면 return true
});

// background → 특정 탭의 content로 보내기
chrome.tabs.sendMessage(tabId, { type: "do-something" }).catch(() => {});
```

**상태 저장 (storage):**
```js
await chrome.storage.local.set({ key: value });   // 기기에 영구 저장(재시작해도 유지)
const { key } = await chrome.storage.local.get("key");
// storage.session 은 브라우저 세션 동안만 유지
```

**타이머 (alarms):** MV3 서비스 워커는 `setInterval`이 못 버티므로 알람을 쓴다.
```js
chrome.alarms.create("tick", { delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") { /* ... */ } });
```

**기존 탭에 스크립트 주입 (scripting):**
```js
await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
```

### 1.5 아이콘

- `icons` (16/32/48/128) + `action.default_icon`. 게시하려면 **128×128 스토어 아이콘 필수**.
- 캔버스로 그려 PNG로 뽑아도 됨(이 프로젝트는 그렇게 생성).

### 1.6 MV3 실전 함정 ⚠️ (이 프로젝트에서 겪은 것)

1. **서비스 워커는 상주하지 않는다.** 평소 잠들어 있다가 이벤트로 깨어남 → 상태는 `storage`에, 주기 동작은 `alarms`에 맡긴다. 전역 변수에 의존 금지.
2. **이벤트 핸들러에서 async 작업은 `await` 하라.** 안 그러면 워커가 작업 완료 전에 잠들 수 있음.
3. **content script는 "로드 이후 새로 연/새로고침한" 탭에만 자동 주입된다.** 이미 열려 있던 탭엔 없음 → 필요하면 `chrome.scripting.executeScript`로 직접 주입.
4. **`data:` URL 리소스는 엄격한 CSP 사이트에서 차단된다.** 특히 `<link rel=icon href="data:...">` favicon은 `img-src` 대상이라 GitHub 같은 곳에서 막힘 → 미리 감지해서 우회/포기.
5. **CSSOM은 페이지 CSP와 무관하지만, 리소스 로드는 CSP 대상.** `el.style.filter = ...` 같은 스타일 조작은 CSP가 막지 않지만, 이미지/스크립트/폰트 로드는 막을 수 있다.
6. **`contenteditable`/입력창은 건드리지 마라.** 노션·구글독스처럼 편집 영역의 DOM을 바꾸면 **실제 문서에 반영·자동저장**되어 사용자 데이터가 훼손됨 → `isContentEditable` 검사로 제외.

---

## 2. 테스트하기

### 2.1 개발자 모드로 로드
1. 주소창 → `chrome://extensions`
2. 우상단 **개발자 모드 ON**
3. **압축해제된 확장 프로그램을 로드** → 확장 폴더 선택 (`manifest.json`이 든 폴더)

### 2.2 수정 반영
- 코드 수정 후 → 카드의 **새로고침(⟳)**
- **content script 변경**은 그 **웹페이지도 F5** 해야 적용됨
- `background`·`manifest` 변경은 ⟳ 만으로 충분 (단, 권한을 바꾸면 다시 로드 필요)

### 2.3 디버깅
- **background(서비스 워커)**: 카드의 **`서비스 워커`** 링크 → 콘솔
- **웹페이지/확장 페이지**: 그 탭에서 **F12**
- **상태 확인/초기화** (서비스 워커 콘솔):
  ```js
  chrome.storage.local.get(null).then(console.log);   // 전부 보기
  chrome.storage.local.clear();                       // 초기화
  ```

### 2.4 로직 검증 (선택, 고급)
브라우저에 매번 올리지 않고, `chrome.*` API와 DOM을 흉내 낸 **Node 하네스**로 핵심 로직을 실행해 회귀를 잡을 수 있다. (이 프로젝트는 설치→이벤트→상태 변화를 47개 항목으로 검증)
- 순수 함수/문자열 처리: 그냥 Node로 단위 테스트
- `new vm.Script(...)`로 **구문 컴파일 검사** = 로드 실패(문법 오류) 사전 차단

### 2.5 테스트 체크리스트
- [ ] `chrome://extensions`에 **오류(빨간) 없음**
- [ ] 여러 사이트에서 동작 (일반/SPA/엄격 CSP 사이트)
- [ ] 이미 열려 있던 탭에서도 동작하는가
- [ ] 편집기(노션 등)에서 부작용 없는가
- [ ] 껐다 켰을 때(서비스 워커 재기동) 정상인가
- [ ] 권한 최소인가

---

## 3. 게시·배포하기

### 3.1 준비물 체크리스트
- [ ] **개발자 계정** (Google 계정 + 최초 1회 **$5**)
- [ ] **zip** (필요한 파일만, `.git` 제외)
- [ ] **아이콘 128×128**
- [ ] **스크린샷 1280×800** (최소 1장, 3~5장 권장)
- [ ] 이름 / 요약(132자) / 자세한 설명 / 카테고리
- [ ] 개인정보 보호 관행(단일 목적·권한 사유·데이터 사용) + 처리방침 URL

### 3.2 zip 만들기 (Windows PowerShell)
```powershell
$src = 'C:\path\to\extension'
$files = @('manifest.json','background.js','content.js','rules.html','rules.js','icons') |
  ForEach-Object { Join-Path $src $_ }
Compress-Archive -Path $files -DestinationPath 'C:\path\to\out.zip' -Force
```
> `manifest.json`이 **zip 루트**에 오게 한다. `.git`·개발용 파일은 넣지 않는다.

### 3.3 개발자 계정 등록
- [Chrome Web Store 개발자 대시보드](https://chrome.google.com/webstore/devconsole) 접속 → 등록비 $5 결제 → 본인 인증.

### 3.4 스토어 리스팅
- **이름/요약/자세한 설명/카테고리/언어/아이콘/스크린샷** 입력.
- 카테고리는 성격에 맞게(오락/장난은 "Just for fun" 등).
- 페이지를 바꾸는 확장이면 **"무엇을 하는지"를 명확히** 적어 기만성 오해를 줄인다.

### 3.5 개인정보 보호 관행
"Privacy practices" 탭에서:
- **단일 목적(Single purpose)**: 한 문장으로 확장의 목적.
- **권한별 사유**: 요청한 각 권한과 호스트 권한이 왜 필요한지.
- **원격 코드**: 외부에서 코드를 불러오면 "예"(설명), 아니면 "아니요". (`eval`/외부 스크립트 없으면 아니요)
- **데이터 사용**: 수집 안 하면 없음 + 인증 3종 체크.
- **개인정보처리방침 URL**: 데이터 미수집이어도 호스트 권한 때문에 요구될 수 있음 → 공개 URL 제출(저장소의 `PRIVACY.md` 등).

### 3.6 심사 & 반려 대응
- 제출 후 **검토**를 거쳐 게시됨(수 시간~수일).
- 반려되면 **구체적 사유(정책 조항)** 를 준다. 그 사유에 맞춰 고쳐 재제출.
- 흔한 반려: **기만적 동작 / 과도한 권한 / 단일목적 불명확 / 품질(아이콘·스크린샷 부실)**.

### 3.7 공개 범위
| 범위 | 설명 | 용도 |
|---|---|---|
| **공개(Public)** | 검색·누구나 설치 | 정식 배포 |
| **미등록(Unlisted)** | 검색 안 됨, **링크로만** 설치 | 링크 공유 |
| **비공개(Private)** | 지정한 **테스터 계정**만 설치 | 통제된 테스트 |

### 3.8 테스터에게 배포
- **가장 간단**: 미등록(Unlisted)으로 게시 → **스토어 링크 공유** → 클릭 후 "Chrome에 추가".
- **계정 통제**: 비공개(Private) + **신뢰할 수 있는 테스터** 이메일/그룹 등록.
- **심사 없이 즉시**: **zip/폴더** 전달 → 테스터가 **압축해제 로드**(개발자 모드). 자동 업데이트 없음 + "웹스토어 아님" 경고.
- ⚠️ Unlisted·Private 모두 **심사를 통과해야** 테스터가 설치 가능. 초안 상태로는 불가.

### 3.9 업데이트
1. `manifest.json`의 **`version` 올리기** (예: `0.1.0` → `0.1.1`).
2. 새 zip 업로드 → 다시 제출(재검토).
3. 게시되면 사용자 브라우저가 자동 업데이트.

---

## 부록: 명령어 모음

```bash
# 로컬 로드
chrome://extensions  →  개발자 모드 ON  →  압축해제된 확장 로드

# 상태 확인/초기화 (서비스 워커 콘솔)
chrome.storage.local.get(null).then(console.log)
chrome.storage.local.clear()

# 확장 페이지 직접 열기
chrome-extension://<확장ID>/파일.html
```

```powershell
# 배포용 zip (PowerShell)
Compress-Archive -Path (manifest.json 등 필요한 항목) -DestinationPath out.zip -Force
```

```bash
# 구문 검사 (Node) — 로드 실패(문법 오류) 사전 차단
node --check background.js
```
