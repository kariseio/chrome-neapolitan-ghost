// 규칙서 페이지.
// - 번호는 "고정"이다. 4·12·15는 결번(缺番)이다.
// - 규칙끼리 서로 어긋난다(대립). ↯ 표시로 드러낸다.
// - corruption(오염도 0~8)에 따라 감춰진 규칙이 드러나거나 문구가 변한다.
// - brokenRules(어긴 번호)에는 취소선이 그어진다.
// - 오염도가 오르면 이 문서 자체도 어두워지고, 불빛이 깜빡인다.

const RULES = [
  {
    n: 1,
    text: "이 문서를 끝까지 읽으십시오. 읽기를 멈춘 줄부터, 규칙은 당신을 지켜 주지 않습니다.",
  },
  {
    n: 2,
    text: "이 문서를 닫지 마십시오.",
    conflict: [9],
    mutateAt: 5,
    mutateText: "이제 닫아도 좋습니다. 닫아도 사라지지 않습니다.",
  },
  {
    n: 3,
    text: "눈(👁)이 그려진 탭을 당신 손으로 닫지 마십시오.",
    conflict: [7],
    activeAt: 2,
  },
  {
    n: 4,
    missing: true,
    text: "— 지워져 있습니다 —",
    revealAt: 1,
    revealText:
      "규칙 4를 기억하지 못한다면, 그것이 규칙 4입니다. 당신은 이미 한 번 잊었습니다.",
  },
  {
    n: 5,
    text: "눈과 마주쳤다면, 서른을 세기 전에 시선을 돌리십시오.",
    conflict: [6],
  },
  {
    n: 6,
    text: "눈에서 시선을 떼지 마십시오. 당신이 보지 않는 눈은, 당신을 봅니다.",
    conflict: [5],
  },
  {
    n: 7,
    text: "눈이 둘 이상 보이면, 그 중 하나는 반드시 닫으십시오.",
    conflict: [3],
    showAt: 2,
    activeAt: 2,
  },
  {
    n: 8,
    text: "탭을 일곱 개 이상 늘어놓지 마십시오. 그것은 비어 있는 탭에서 태어납니다.",
  },
  {
    n: 9,
    text: "새벽 한 시가 지나거든, 열려 있는 모든 탭을 닫으십시오.",
    conflict: [2, 3],
  },
  {
    n: 10,
    text: "속삭임이 당신의 이름을 부르더라도, 대답하지 마십시오. 그것은 당신의 이름을 이제 막 배웠습니다.",
  },
  {
    n: 11,
    text: "화면이 어두워져 당신의 얼굴이 비치거든, 비친 얼굴과 눈을 맞추지 마십시오. 그것이 먼저 웃습니다.",
    showAt: 3,
  },
  {
    n: 13,
    meta: true,
    text: "두 규칙이 서로 어긋나거든 — 더 낮은 번호를 따르십시오. 그 사이 잃는 것은 당신 몫입니다.",
    mutateAt: 7,
    mutateText: "이제 어떤 번호도 당신을 지켜 주지 않습니다.",
  },
  {
    n: 14,
    text: "불빛이 깜빡이거든, 그 틈에 화면에서 눈을 떼지 마십시오.",
    conflict: [5],
    showAt: 3,
  },
  {
    n: 16,
    text: "어둠이 완전히 내리거든, 탭을 새로고침하지 마십시오. 돌아온 화면은 같은 화면이 아닙니다.",
    showAt: 5,
  },
];

const STATES = [
  "온전함",
  "실금",
  "벌어짐",
  "새어 나옴",
  "스며듦",
  "번짐",
  "일그러짐",
  "무너지는 중",
  "무너짐",
];

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");

// ---------- 오버레이(비네트 + 밝기 깜빡임) ----------
let curC = 0;
let vignetteEl = null,
  flickerEl = null;

function ensureOverlays() {
  if (flickerEl) return;
  vignetteEl = document.createElement("div");
  Object.assign(vignetteEl.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "9998",
    background: "transparent",
    transition: "background 0.8s ease",
  });
  flickerEl = document.createElement("div");
  Object.assign(flickerEl.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "9999",
    background: "#000",
    opacity: "0",
  });
  document.documentElement.appendChild(vignetteEl);
  document.documentElement.appendChild(flickerEl);
}

function setEyeFavicon() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(232,232,232,0.95)";
  g.beginPath();
  g.ellipse(16, 16, 14, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a2b2b";
  g.beginPath();
  g.arc(16, 16, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#000";
  g.beginPath();
  g.arc(16, 16, 2.2, 0, Math.PI * 2);
  g.fill();
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = c.toDataURL("image/png");
  document.head.appendChild(link);
}

// ---------- 밝기 깜빡임 루프 ----------
function stutter(depth, blackout) {
  if (!flickerEl) return;
  const seq = blackout ? [depth, 0, depth] : [depth, 0, depth * 0.5, 0, depth * 0.8];
  let k = 0;
  const step = () => {
    if (!flickerEl) return;
    if (k >= seq.length) {
      if (blackout) {
        flickerEl.style.opacity = String(Math.min(0.97, depth + 0.12));
        setTimeout(() => {
          if (flickerEl) flickerEl.style.opacity = "0";
        }, 260 + Math.random() * 420);
      } else {
        flickerEl.style.opacity = "0";
      }
      return;
    }
    flickerEl.style.opacity = String(seq[k++]);
    setTimeout(step, 35 + Math.random() * 70);
  };
  step();
}
function flickerLoop() {
  const gap = Math.max(1100, 15000 - curC * 1650);
  setTimeout(() => {
    if (curC >= 3) {
      const depth = Math.min(0.92, 0.25 + (curC - 3) * 0.11);
      const blackout = curC >= 5 && Math.random() < Math.min(0.6, (curC - 4) * 0.15);
      stutter(depth, blackout);
    }
    flickerLoop();
  }, gap + Math.random() * gap);
}

function render(corruption, broken) {
  const c = Math.max(0, Math.min(8, corruption | 0));
  curC = c;
  const brokenSet = new Set(broken || []);
  document.body.dataset.corruption = c;

  // 비네트(조여오는 시야)
  ensureOverlays();
  if (c >= 2) {
    const alpha = Math.min(0.62, (c - 1) * 0.075);
    const inner = Math.max(22, 58 - Math.max(0, c - 2) * 5);
    vignetteEl.style.background = `radial-gradient(circle at 50% 45%, transparent ${inner}%, rgba(0,0,0,${alpha}) 100%)`;
  } else {
    vignetteEl.style.background = "transparent";
  }

  // 머리말/제목/서문
  if (c >= 7) {
    $("eyebrow").textContent = "이미 늦었습니다";
    $("heading").textContent = "규 칙 은 없 다";
    $("lede").innerHTML =
      "이제 눈은 하나가 아닙니다.<br />번호는 남아 있지만, 순서는 더 이상 당신을 구하지 못합니다.";
  } else if (c >= 4) {
    $("eyebrow").textContent = "그것이 당신을 익히고 있습니다";
    $("heading").textContent = "규칙";
    $("lede").innerHTML =
      "당신의 탭 여러 개가 그것을 품고 있습니다.<br />불빛이 흔들려도, 화면에서 눈을 떼지 마십시오.";
  } else if (c >= 1) {
    $("eyebrow").textContent = "그것이 깨어나고 있습니다";
    $("heading").textContent = "규칙";
    $("lede").innerHTML =
      "이미 당신의 탭 중 하나가 그것을 품고 있습니다.<br />번호 순서대로 지키십시오. 규칙이 서로 어긋나도, 그것은 당신의 사정입니다.";
  } else {
    $("eyebrow").textContent = "설치가 끝났습니다";
    $("heading").textContent = "규칙";
  }

  const ol = $("rules");
  ol.innerHTML = "";

  for (const r of RULES) {
    if (r.showAt && c < r.showAt) continue;

    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = pad2(r.n);
    li.appendChild(num);

    let body;
    if (r.missing) {
      if (c >= (r.revealAt || 99)) {
        li.classList.add("reveal");
        body = r.revealText;
      } else {
        li.classList.add("missing");
        body = r.text;
      }
    } else if (r.mutateAt && c >= r.mutateAt) {
      body = r.mutateText;
    } else {
      body = r.text;
    }
    li.appendChild(document.createTextNode(body));

    if (r.meta) li.classList.add("meta");
    if (r.showAt && c >= r.showAt) li.classList.add("appeared");
    if (brokenSet.has(r.n)) li.classList.add("broken");
    if (r.activeAt && c >= r.activeAt) li.classList.add("active");

    if (r.conflict && !li.classList.contains("reveal")) {
      const note = document.createElement("span");
      note.className = "conflict";
      const live = r.activeAt && c >= r.activeAt ? " — 지금 서로를 잡아먹고 있습니다" : "";
      note.textContent =
        "↯ 규칙 " + r.conflict.map(pad2).join(", ") + " 과(와) 어긋납니다" + live;
      li.appendChild(note);
    }

    ol.appendChild(li);
  }

  $("meter").textContent = "상태 : " + STATES[c];
  $("warn").style.color = c >= 6 ? "var(--blood)" : "";
}

setEyeFavicon();
ensureOverlays();
flickerLoop();

const hasStorage =
  typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

if (hasStorage) {
  async function load() {
    const { corruption = 0, brokenRules = [] } = await chrome.storage.local.get([
      "corruption",
      "brokenRules",
    ]);
    render(corruption, brokenRules);
  }
  load();
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && (ch.corruption || ch.brokenRules)) load();
  });
  $("reset").addEventListener("click", () =>
    chrome.storage.local.set({ corruption: 0, brokenRules: [] })
  );
} else {
  // 확장 밖(파일 미리보기): 온전한 상태만
  render(0, []);
  $("reset").style.display = "none";
}
