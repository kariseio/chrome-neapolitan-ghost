// 서비스 워커: 귀신의 위치와 "오염도(corruption)"를 관리한다.
// - corruption(storage.local): 규칙을 어길수록 오른다. 세션이 지나도 유지된다(고장 누적).
// - hauntedTabIds / rulesTabId(storage.session): 지금 깃든 탭들, 규칙서 탭.

const ELIGIBLE = /^https?:/i;
const MAX_CORRUPTION = 8; // 오염도 0~8 (잘게 나눔)
const MAX_TABS = 6; // 7개째부터 규칙 위반
const DRIFT_CHANCE = 0.15; // 이동할 때마다 저절로 나빠질 확률(불가피함)

// 어떤 위반이 어떤 "번호의 규칙"을 부순 것으로 기록되는가
const RULE_OF = {
  "closed-rules": 2, // 규칙 2: 이 문서를 닫지 마라
  "closed-eye": 3, // 규칙 3: 눈 탭을 닫지 마라 (규칙 7과 대립)
  stare: 5, // 규칙 5: 서른을 세기 전에 시선을 돌려라 (규칙 6과 대립)
  "too-many-tabs": 8, // 규칙 8: 탭을 일곱 개 이상 두지 마라
};

// ---------- 상태 ----------
async function getCorruption() {
  const { corruption = 0 } = await chrome.storage.local.get("corruption");
  return corruption;
}
async function setCorruption(v) {
  await chrome.storage.local.set({
    corruption: Math.max(0, Math.min(MAX_CORRUPTION, v)),
  });
}
async function getSession() {
  const { hauntedTabIds = [], rulesTabId = null } =
    await chrome.storage.session.get(["hauntedTabIds", "rulesTabId"]);
  return { hauntedTabIds, rulesTabId };
}
async function setSession(patch) {
  await chrome.storage.session.set(patch);
}

// ---------- 강도 파라미터 ----------
function params(c) {
  return {
    count: c >= 6 ? 4 : c >= 4 ? 3 : c >= 2 ? 2 : 1, // 오염될수록 여러 탭에 동시에 깃든다
    minDelay: Math.max(0.15, 0.8 - c * 0.07), // 이동이 빨라진다(분)
    maxDelay: Math.max(0.35, 1.6 - c * 0.14),
  };
}

function send(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}
async function eligibleTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.url && ELIGIBLE.test(t.url));
}
function scheduleNext(minutes) {
  chrome.alarms.create("move-ghost", { delayInMinutes: minutes });
}

// ---------- 귀신 이동 ----------
async function moveGhost() {
  let c = await getCorruption();
  // 가끔, 아무 짓 안 해도 저절로 한 단계 나빠진다 (서서히 스며드는 오염)
  if (c < MAX_CORRUPTION && Math.random() < DRIFT_CHANCE) {
    c += 1;
    await setCorruption(c);
  }
  const p = params(c);
  const { hauntedTabIds: prev } = await getSession();

  const pool = await eligibleTabs();
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, p.count);
  const nextIds = shuffled.map((t) => t.id);

  prev
    .filter((id) => !nextIds.includes(id))
    .forEach((id) => send(id, { type: "unhaunt" }));
  nextIds.forEach((id) => send(id, { type: "haunt", intensity: c }));

  await setSession({ hauntedTabIds: nextIds });
  const delay = p.minDelay + Math.random() * (p.maxDelay - p.minDelay);
  scheduleNext(delay);
}

// ---------- 규칙 위반 ----------
const lastViolation = {}; // 같은 종류 위반 디바운스용
async function violate(kind) {
  const now = Date.now();
  if (lastViolation[kind] && now - lastViolation[kind] < 4000) return;
  lastViolation[kind] = now;

  const c = Math.min(MAX_CORRUPTION, (await getCorruption()) + 1);
  await setCorruption(c);

  // 어긴 규칙 번호를 기록 → 규칙서가 해당 번호에 취소선을 긋는다
  const ruleNo = RULE_OF[kind];
  if (ruleNo) {
    const { brokenRules = [] } = await chrome.storage.local.get("brokenRules");
    if (!brokenRules.includes(ruleNo)) {
      brokenRules.push(ruleNo);
      await chrome.storage.local.set({ brokenRules });
    }
  }

  // 지금 깃든 탭들에 즉시 반영 + 곧바로 한 번 더 튄다 → "어기자마자 더 고장남"
  const { hauntedTabIds } = await getSession();
  hauntedTabIds.forEach((id) => send(id, { type: "corrupt", intensity: c }));
  await moveGhost();
}

// ---------- 수명주기 ----------
async function openRules() {
  const url = chrome.runtime.getURL("rules.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await setSession({ rulesTabId: existing[0].id });
  } else {
    const tab = await chrome.tabs.create({ url });
    await setSession({ rulesTabId: tab.id });
  }
}

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === "install") {
    await setCorruption(0); // 첫 설치는 온전한 상태
    await chrome.storage.local.set({ brokenRules: [] });
  }
  await openRules();
  await moveGhost();
});
chrome.runtime.onStartup.addListener(async () => {
  await moveGhost();
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "move-ghost") await moveGhost();
});

// ---------- 메시지 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "am-i-haunted") {
    getSession().then(({ hauntedTabIds }) =>
      sendResponse({ haunted: hauntedTabIds.includes(sender.tab?.id) })
    );
    return true;
  }
  if (msg.type === "get-intensity") {
    getCorruption().then((c) => sendResponse({ intensity: c }));
    return true;
  }
  if (msg.type === "violation") {
    violate(msg.kind || "stare"); // content.js가 보고하는 '응시' 위반
  }
});

// ---------- 규칙 감지 ----------
// 규칙 1·2: 눈 탭 / 규칙서를 닫으면 위반
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { hauntedTabIds, rulesTabId } = await getSession();
  if (hauntedTabIds.includes(tabId)) {
    await setSession({ hauntedTabIds: hauntedTabIds.filter((id) => id !== tabId) });
    await violate("closed-eye");
  }
  if (tabId === rulesTabId) {
    await setSession({ rulesTabId: null });
    await violate("closed-rules");
  }
});

// 규칙 3: 탭 7개 이상
chrome.tabs.onCreated.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  if (tabs.length > MAX_TABS) await violate("too-many-tabs");
});

// 오염도가 바뀌면(위반·드리프트·리셋) 지금 깃든 탭에 즉시 반영한다
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.corruption) return;
  const c = ch.corruption.newValue || 0;
  getSession().then(({ hauntedTabIds }) =>
    hauntedTabIds.forEach((id) => send(id, { type: "corrupt", intensity: c }))
  );
});
