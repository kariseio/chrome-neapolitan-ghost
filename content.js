// 페이지마다 주입되지만, "haunt" 신호를 받은 탭에서만 흔적을 남긴다.
// intensity(0~8)가 높을수록 연출이 세진다. 단계별로 새 증상이 하나씩 얹힌다.
(() => {
  const ORIG_TITLE = document.title;
  const WHISPER_WORDS = ["여기", "뒤", "봤어", "돌아봐", "늦었어", "네가", "보여", "아직", "그만", "왜", "거기", "누구야"];
  const WHISPER_PHRASES = [
    "너 지금 읽고 있지",
    "뒤 돌아보지 마",
    "하나 더 늘었어",
    "그거 아까랑 달라",
    "네 이름 알아",
    "계속 읽어",
    "거의 다 왔어",
    "여기 있으면 안 돼",
  ];
  // 라틴 글자를 똑같이 생긴 키릴 문자로 (읽으면 멀쩡한데 미묘하게 틀린 — 위화감)
  const HOMO = { a: "а", c: "с", e: "е", i: "і", o: "о", p: "р", x: "х", y: "у", s: "ѕ", j: "ј" };
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
  let mouseX = -1,
    mouseY = -1;
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
      whisperGap: Math.max(1800, 8500 - i * 850),
      whisperChance: Math.min(1, 0.2 + i * 0.1),
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
  const rand = (n) => Math.floor(Math.random() * n);

  // 글자 훼손 도구들
  function zalgo(s, amount) {
    const marks = ["̀", "́", "̂", "̃", "̈", "̣", "̧", "҉", "̶", "͜"];
    const chars = [...s];
    const nonSpace = chars.map((c, i) => (/\s/.test(c) ? -1 : i)).filter((i) => i >= 0);
    const forced = nonSpace.length ? nonSpace[rand(nonSpace.length)] : -1; // 최소 한 글자는 반드시
    return chars
      .map((ch, i) => {
        if (/\s/.test(ch)) return ch;
        let out = ch;
        const n = i === forced ? Math.max(1, amount) : Math.random() < 0.6 ? amount : 0;
        for (let k = 0; k < n; k++) out += marks[rand(marks.length)];
        return out;
      })
      .join("");
  }
  function homoglyph(s) {
    const chars = [...s];
    const mappable = chars.map((c, i) => (HOMO[c.toLowerCase()] ? i : -1)).filter((i) => i >= 0);
    const forced = mappable.length ? mappable[rand(mappable.length)] : -1; // 바꿀 수 있으면 최소 하나
    return chars
      .map((ch, i) => {
        const rep = HOMO[ch.toLowerCase()];
        if (!rep) return ch;
        return i === forced || Math.random() < 0.6 ? rep : ch;
      })
      .join("");
  }
  // 라틴이 없어 호모글리프가 안 먹으면(한글 등) 자모 깨짐으로 대체
  function subtle(word) {
    const h = homoglyph(word);
    return h !== word ? h : zalgo(word, 1);
  }
  function corruptWord(word, intensity) {
    const r = Math.random();
    const w = () => WHISPER_WORDS[rand(WHISPER_WORDS.length)];
    if (intensity <= 1) return r < 0.6 ? subtle(word) : w();
    if (intensity <= 4) return r < 0.5 ? w() : r < 0.8 ? subtle(word) : zalgo(word, 1 + (intensity >> 2));
    return r < 0.45 ? w() : r < 0.75 ? zalgo(word, 1 + (intensity >> 1)) : subtle(word);
  }

  function pickTextNode() {
    if (!document.body) return null;
    const vh = window.innerHeight || 800,
      vw = window.innerWidth || 1200;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.trim().length < 6) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(p.tagName))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    // 화면(뷰포트) 안에 실제로 보이는 후보만 모은다
    const cands = [];
    let n;
    while ((n = walker.nextNode()) && cands.length < 160) {
      const el = n.parentElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      cands.push({ node: n, el, r });
    }
    if (!cands.length) return null;
    // 점수: 큰 글자·제목·커서 근처일수록 높다(주의가 가 있는 곳을 노림)
    for (const c of cands) {
      const fs = parseFloat(getComputedStyle(c.el).fontSize) || 14;
      const heading = /^H[1-4]$/.test(c.el.tagName) ? 36 : 0;
      let prox = 0;
      if (mouseX >= 0) {
        const cx = c.r.left + c.r.width / 2,
          cy = c.r.top + c.r.height / 2;
        prox = Math.max(0, 320 - Math.hypot(cx - mouseX, cy - mouseY)) / 5;
      }
      c.score = fs + heading + prox + Math.random() * 12;
    }
    cands.sort((a, b) => b.score - a.score);
    const top = cands.slice(0, Math.min(5, cands.length));
    return top[rand(top.length)].node;
  }

  function doWhisper(intensity) {
    const node = pickTextNode();
    if (!node) return;
    const original = node.nodeValue;
    const parts = original.split(/(\s+)/);
    const wi = parts.map((w, i) => (w.trim().length > 1 ? i : -1)).filter((i) => i >= 0);
    if (!wi.length) return;

    // 고강도에선 가끔 구절을 통째로 — 페이지가 당신에게 말을 건다
    if (intensity >= 4 && Math.random() < 0.12 + intensity * 0.04) {
      parts[wi[rand(wi.length)]] = WHISPER_PHRASES[rand(WHISPER_PHRASES.length)];
    } else {
      // 연속된 여러 단어를 한꺼번에 — 덩어리로 보여야 인식된다
      const runLen = Math.min(wi.length, 2 + intensity);
      const start = rand(Math.max(1, wi.length - runLen + 1));
      for (let k = 0; k < runLen && start + k < wi.length; k++) {
        const i = wi[start + k];
        parts[i] = corruptWord(parts[i], intensity);
      }
    }
    node.nodeValue = parts.join("");

    // 복구 — 더 오래 유지해 눈이 닿을 시간을 준다. 고강도엔 드물게 한 글자 남김
    const linger = intensity >= 7 && Math.random() < 0.2;
    setTimeout(() => {
      if (!linger) {
        node.nodeValue = original;
      } else {
        const p2 = original.split(/(\s+)/);
        const li = wi[rand(wi.length)];
        p2[li] = subtle(p2[li]);
        node.nodeValue = p2.join("");
      }
    }, 900 + Math.random() * 700 + intensity * 160);
  }

  function whisperLoop(C) {
    T(() => {
      if (!haunted) return;
      if (Math.random() <= C.whisperChance) doWhisper(intensity);
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
  document.addEventListener(
    "mousemove",
    (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    },
    { passive: true }
  );

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
