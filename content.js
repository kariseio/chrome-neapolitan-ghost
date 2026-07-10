// 페이지마다 주입되지만, "haunt" 신호를 받은 탭에서만 흔적을 남긴다.
// intensity(0~8)가 높을수록 연출이 세진다. 단계별로 새 증상이 하나씩 얹힌다.
(() => {
  const ORIG_TITLE = document.title;
  const WORDS = ["여기", "뒤", "봤어", "돌아봐", "늦었어", "네가", "보여", "이름을", "아직", "그만"];
  const COMBINING = ["́", "̀", "̣", "҉", "̶", "̖", "͛", "̽"];

  let haunted = false;
  let intensity = 0;
  let savedIcons = null;
  let savedHtmlFilter = null;
  let savedBodyTransform = null;
  let veil = null,
    vignetteEl = null,
    flickerEl = null;
  let stareTimer = null,
    stared = false;
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

  // ---------- 강도 곡선 (0~8) ----------
  function cfg(i) {
    return {
      blinkGap: Math.max(1400, 8000 - i * 750),
      whisperGap: Math.max(2000, 9500 - i * 900),
      whisperChance: Math.min(1, 0.12 + i * 0.11),
      whisperSwaps: 1 + Math.floor(i / 2),
      titleOn: i >= 2,
      titleGap: Math.max(2200, 13000 - i * 1300),
      titleSeverity: Math.max(1, i - 1),
      vignetteAlpha: i >= 2 ? Math.min(0.62, (i - 1) * 0.075) : 0, // 가장자리 어둠
      vignetteInner: Math.max(22, 58 - Math.max(0, i - 2) * 5), // 조여오는 시야(%)
      flickerOn: i >= 3, // 밝기 깜빡임 시작
      flickerGap: Math.max(1100, 15000 - i * 1650),
      flickerDepth: Math.min(0.92, 0.25 + Math.max(0, i - 3) * 0.11),
      blackoutOn: i >= 5, // 암전 시작
      blackoutChance: Math.min(0.6, Math.max(0, i - 4) * 0.15),
      grayscale: i >= 5 ? Math.min(0.85, (i - 4) * 0.22) : 0, // 색이 빠진다
      contrast: 1 + Math.max(0, i - 4) * 0.06,
      hue: i >= 6 ? -(i - 5) * 7 : 0, // 색이 틀어진다
      tremorOn: i >= 6, // 화면 떨림
      tremorPx: Math.min(3, Math.max(1, i - 5)),
    };
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

  // ---------- 오버레이(비네트 + 밝기 깜빡임) ----------
  function ensureVeil() {
    if (veil) return;
    veil = document.createElement("div");
    veil.dataset.ghostVeil = "1";
    Object.assign(veil.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    vignetteEl = document.createElement("div");
    Object.assign(vignetteEl.style, { position: "absolute", inset: "0" });
    flickerEl = document.createElement("div");
    Object.assign(flickerEl.style, {
      position: "absolute",
      inset: "0",
      background: "#000",
      opacity: "0",
    });
    veil.appendChild(vignetteEl);
    veil.appendChild(flickerEl);
    document.documentElement.appendChild(veil);
  }
  function removeVeil() {
    if (veil) veil.remove();
    veil = vignetteEl = flickerEl = null;
  }

  function applyStatics(C) {
    // 비네트(가장자리 어둠 + 조여오는 시야)
    if (C.vignetteAlpha > 0) {
      ensureVeil();
      vignetteEl.style.background = `radial-gradient(circle at 50% 45%, transparent ${C.vignetteInner}%, rgba(0,0,0,${C.vignetteAlpha}) 100%)`;
    } else if (vignetteEl) {
      vignetteEl.style.background = "transparent";
    }
    if (flickerEl) flickerEl.style.opacity = "0";
    // 필터(회색 · 대비 · 색 틀어짐)
    if (savedHtmlFilter === null) savedHtmlFilter = document.documentElement.style.filter || "";
    const parts = [];
    if (C.grayscale) parts.push(`grayscale(${C.grayscale.toFixed(2)})`);
    if (C.contrast !== 1) parts.push(`contrast(${C.contrast.toFixed(2)})`);
    if (C.hue) parts.push(`hue-rotate(${C.hue}deg)`);
    document.documentElement.style.filter = parts.join(" ");
  }

  // ---------- 밝기 깜빡임(형광등 죽어가듯) + 암전 ----------
  function stutter(depth, blackout) {
    if (!flickerEl) return;
    const seq = blackout ? [depth, 0, depth] : [depth, 0, depth * 0.5, 0, depth * 0.8];
    let k = 0;
    const step = () => {
      if (!haunted || !flickerEl) {
        if (flickerEl) flickerEl.style.opacity = "0";
        return;
      }
      if (k >= seq.length) {
        if (blackout) {
          // 암전을 잠깐 유지했다가 복귀한다
          flickerEl.style.opacity = String(Math.min(0.97, depth + 0.12));
          T(() => {
            if (flickerEl) flickerEl.style.opacity = "0";
          }, 260 + Math.random() * 420);
        } else {
          flickerEl.style.opacity = "0";
        }
        return;
      }
      flickerEl.style.opacity = String(seq[k++]);
      T(step, 35 + Math.random() * 70);
    };
    step();
  }
  function flickerLoop(C) {
    if (!C.flickerOn) return;
    T(() => {
      if (!haunted) return;
      const bo = C.blackoutOn && Math.random() < C.blackoutChance;
      stutter(C.flickerDepth, bo);
      flickerLoop(C);
    }, C.flickerGap + Math.random() * C.flickerGap);
  }

  // ---------- 화면 미세 떨림 ----------
  function tremorLoop(C) {
    if (!C.tremorOn) return;
    if (savedBodyTransform === null)
      savedBodyTransform = document.body ? document.body.style.transform : "";
    IV(() => {
      if (!haunted || !document.body) return;
      const dx = (Math.random() * 2 - 1) * C.tremorPx;
      const dy = (Math.random() * 2 - 1) * C.tremorPx;
      document.body.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      setTimeout(() => {
        if (document.body) document.body.style.transform = savedBodyTransform || "";
      }, 90);
    }, 700 + Math.random() * 900);
  }

  // ---------- 눈 깜빡임 ----------
  function blinkLoop(C) {
    T(() => {
      if (!haunted) return;
      setFavicon(eyeIcon(false));
      setTimeout(() => {
        if (haunted) setFavicon(eyeIcon(true));
      }, 150);
      blinkLoop(C);
    }, C.blinkGap + Math.random() * 5000);
  }

  // ---------- 속삭임 ----------
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
  function doWhisper(swaps) {
    const node = pickTextNode();
    if (!node) return;
    const original = node.nodeValue;
    const parts = original.split(/(\s+)/);
    const idxs = parts.map((w, i) => (w.trim().length > 1 ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return;
    for (let k = 0; k < Math.min(idxs.length, swaps); k++) {
      const i = idxs[Math.floor(Math.random() * idxs.length)];
      parts[i] = WORDS[Math.floor(Math.random() * WORDS.length)];
    }
    node.nodeValue = parts.join("");
    setTimeout(() => {
      node.nodeValue = original; // 항상 원상복구
    }, 700 + Math.random() * 600);
  }
  function whisperLoop(C) {
    T(() => {
      if (!haunted) return;
      if (Math.random() <= C.whisperChance) doWhisper(C.whisperSwaps);
      whisperLoop(C);
    }, C.whisperGap + Math.random() * C.whisperGap);
  }

  // ---------- 제목 글리치 ----------
  function glitchTitle(s, severity) {
    const arr = [...s];
    const n = Math.min(arr.length, 1 + severity * 2);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * arr.length);
      arr[i] = arr[i] + COMBINING[Math.floor(Math.random() * COMBINING.length)];
    }
    return arr.join("");
  }
  function titleGlitchLoop(C) {
    T(() => {
      if (!haunted || !C.titleOn) return;
      document.title = glitchTitle(ORIG_TITLE, C.titleSeverity);
      setTimeout(() => {
        if (haunted) document.title = ORIG_TITLE;
      }, 240 + C.titleSeverity * 130);
      titleGlitchLoop(C);
    }, C.titleGap + Math.random() * C.titleGap);
  }

  // ---------- 규칙: 눈 탭 30초 이상 응시 ----------
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
    const C = cfg(intensity);
    setFavicon(eyeIcon(true));
    applyStatics(C);
    blinkLoop(C);
    whisperLoop(C);
    if (C.titleOn) titleGlitchLoop(C);
    flickerLoop(C);
    tremorLoop(C);
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
    document.documentElement.style.filter = savedHtmlFilter || "";
    if (document.body) document.body.style.transform = savedBodyTransform || "";
    removeVeil();
    savedHtmlFilter = null;
    savedBodyTransform = null;
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
