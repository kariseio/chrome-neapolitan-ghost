// 페이지마다 주입되지만, "haunt" 신호를 받은 탭에서만 흔적을 남긴다.
// intensity(0~4)가 높을수록 연출이 심해진다. (서비스 워커의 corruption 값)
(() => {
  const ORIG_TITLE = document.title;
  const WORDS = ["여기", "뒤", "봤다", "닫지마", "늦었어", "아직"];
  const COMBINING = ["́", "̀", "̣", "҉", "̶", "̖"];

  let haunted = false;
  let intensity = 0;
  let savedIcons = null;
  let overlay = null;
  let stareTimer = null;
  let stared = false;
  const timers = new Set();

  const T = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.add(id);
    return id;
  };
  const IV = (fn, ms) => {
    const id = setInterval(fn, ms);
    timers.add(id);
    return id;
  };
  function clearAll() {
    timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    timers.clear();
    stareTimer = null;
  }

  // ---------- favicon: 눈 ----------
  function eyeIcon(open = true) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 32, 32);
    if (open) {
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
    } else {
      g.strokeStyle = "rgba(150,150,150,0.95)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(4, 16);
      g.quadraticCurveTo(16, 23, 28, 16);
      g.stroke();
    }
    return c.toDataURL("image/png");
  }
  function setFavicon(dataUrl) {
    if (savedIcons === null)
      savedIcons = [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.href);
    document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = dataUrl;
    link.dataset.ghost = "1";
    (document.head || document.documentElement).appendChild(link);
  }
  function restoreFavicon() {
    document.querySelectorAll("link[data-ghost]").forEach((l) => l.remove());
    if (savedIcons)
      savedIcons.forEach((href) => {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = href;
        (document.head || document.documentElement).appendChild(link);
      });
    savedIcons = null;
  }

  // ---------- 눈 깜빡임 ----------
  function blinkLoop() {
    T(() => {
      if (!haunted) return;
      setFavicon(eyeIcon(false));
      setTimeout(() => {
        if (haunted) setFavicon(eyeIcon(true));
      }, 160);
      blinkLoop();
    }, Math.max(1600, 7000 - intensity * 1200) + Math.random() * 7000);
  }

  // ---------- 나폴리탄식 속삭임: 단어가 잠깐 바뀐다 ----------
  function pickTextNode() {
    if (!document.body) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.trim().length < 6) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(p.tagName))
          return NodeFilter.FILTER_REJECT;
        const r = p.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode()) && nodes.length < 90) nodes.push(n);
    return nodes.length ? nodes[Math.floor(Math.random() * nodes.length)] : null;
  }
  function doWhisper() {
    const node = pickTextNode();
    if (!node) return;
    const original = node.nodeValue;
    const parts = original.split(/(\s+)/);
    const idxs = parts.map((w, i) => (w.trim().length > 1 ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return;
    const swaps = Math.min(idxs.length, 1 + Math.floor(intensity / 2));
    for (let k = 0; k < swaps; k++) {
      const i = idxs[Math.floor(Math.random() * idxs.length)];
      parts[i] = WORDS[Math.floor(Math.random() * WORDS.length)];
    }
    node.nodeValue = parts.join("");
    setTimeout(() => {
      node.nodeValue = original; // 항상 원상복구(추적 타이머 아님)
    }, 700 + Math.random() * 600);
  }
  function whisperLoop() {
    const chance = [0.35, 0.55, 0.75, 0.9, 1][Math.min(intensity, 4)];
    const gap = Math.max(2500, 9000 - intensity * 1500);
    T(() => {
      if (!haunted) return;
      if (Math.random() <= chance) doWhisper();
      whisperLoop();
    }, gap + Math.random() * gap);
  }

  // ---------- 제목 글리치 (intensity>=1) ----------
  function glitchTitle(s) {
    const arr = [...s];
    const n = Math.min(arr.length, 1 + intensity * 2);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * arr.length);
      arr[i] = arr[i] + COMBINING[Math.floor(Math.random() * COMBINING.length)];
    }
    return arr.join("");
  }
  function titleGlitchLoop() {
    if (intensity < 1) return;
    const gap = Math.max(3000, 12000 - intensity * 2500);
    T(() => {
      if (!haunted || intensity < 1) return;
      document.title = glitchTitle(ORIG_TITLE);
      setTimeout(() => {
        if (haunted) document.title = ORIG_TITLE;
      }, 250 + intensity * 150);
      titleGlitchLoop();
    }, gap + Math.random() * gap);
  }

  // ---------- 화면 비네트 오버레이 (intensity>=2) ----------
  function updateOverlay() {
    if (intensity < 2) {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      return;
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.dataset.ghostOverlay = "1";
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2147483647",
        mixBlendMode: "multiply",
      });
      document.documentElement.appendChild(overlay);
    }
    const a = intensity >= 4 ? 0.24 : intensity >= 3 ? 0.15 : 0.08;
    overlay.style.background = `radial-gradient(circle at 50% 42%, transparent 52%, rgba(0,0,0,${a}) 100%)`;
    if (intensity >= 3) {
      IV(() => {
        if (overlay) overlay.style.opacity = (0.55 + Math.random() * 0.45).toFixed(2);
      }, 220);
    } else if (overlay) {
      overlay.style.opacity = "1";
    }
  }

  // ---------- 규칙4: 눈 탭 30초 이상 응시 ----------
  function armStare() {
    if (!haunted) return;
    if (document.visibilityState === "visible" && document.hasFocus() && !stared) {
      stareTimer = setTimeout(() => {
        if (
          haunted &&
          !stared &&
          document.visibilityState === "visible" &&
          document.hasFocus()
        ) {
          stared = true;
          try {
            chrome.runtime.sendMessage({ type: "violation", kind: "stare" });
          } catch (e) {}
        }
      }, 30000);
      timers.add(stareTimer);
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stared = false;
    else armStare();
  });
  window.addEventListener("focus", () => armStare());
  window.addEventListener("blur", () => {
    stared = false;
  });

  // ---------- 상태 전이 ----------
  function startEffects() {
    clearAll();
    if (!haunted) return;
    setFavicon(eyeIcon(true));
    blinkLoop();
    whisperLoop();
    titleGlitchLoop();
    updateOverlay();
    armStare();
  }
  function haunt(level) {
    intensity = level | 0;
    haunted = true;
    startEffects();
  }
  function corrupt(level) {
    intensity = level | 0;
    if (haunted) startEffects();
  }
  function unhaunt() {
    haunted = false;
    clearAll();
    restoreFavicon();
    document.title = ORIG_TITLE;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    stared = false;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "haunt") haunt(msg.intensity);
    else if (msg.type === "corrupt") corrupt(msg.intensity);
    else if (msg.type === "unhaunt") unhaunt();
  });

  // 로드/새로고침 직후: 내가 그 탭이면 현재 강도로 다시 깃든다
  chrome.runtime.sendMessage({ type: "am-i-haunted" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.haunted) return;
    chrome.runtime.sendMessage({ type: "get-intensity" }, (r2) => {
      if (chrome.runtime.lastError) return haunt(0);
      haunt(r2 && r2.intensity ? r2.intensity : 0);
    });
  });
})();
