// 가면카메라 — 얼굴에 판다/토끼/고양이/곰/개구리 가면을 씌운다
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { drawMask, CHARS } from "./masks.js?v=10";

const $ = (id) => document.getElementById(id);
const video = $("cam"), canvas = $("art"), ctx = canvas.getContext("2d");
const statusEl = $("status"), toastEl = $("toast");

let facing = "environment";
let stream = null;
let faceLM = null, visionReady = false;
let faces = [];
let lastDetect = 0, lastVideoTime = -1;
let char = "panda";           // 선택된 가면
let faceChars = [];           // 얼굴별 가면 (random 모드용)
let shuffleTick = 0;
let switching = false;        // 카메라 전환 중 잠금
let modelLoading = false;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const mirror = () => facing === "user";

function toast(msg, ms = 2400) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}
function setStatus(m) { statusEl.textContent = m; }

// ---------- 가면 선택 ----------
document.querySelectorAll(".char-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".char-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  char = b.dataset.char;
  faceChars = faces.map(() => char === "random" ? pick(CHARS) : char);
  shuffleTick++;
  toast({ panda: "🐼 판다!", rabbit: "🐰 토끼!", cat: "🐱 고양이!", bear: "🐻 곰!", frog: "🐸 개구리!", random: "🎲 랜덤 가면!" }[char]);
});
$("btnShuffle").onclick = () => {
  faceChars = faces.map(() => pick(CHARS));
  if (char !== "random") { // 고정 모드에서도 섞으면 랜덤으로 전환
    char = "random";
    document.querySelectorAll(".char-btn").forEach(x => x.classList.toggle("active", x.dataset.char === "random"));
  }
  shuffleTick++;
  toast("🎲 가면 바꿨어요!");
};

// ---------- 카메라 (새 카메라가 켜져야 예전 걸 끈다 — 실패해도 검은 화면 안 됨) ----------
const withTimeout = (p, ms, msg) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || "timeout")), ms))
]);
async function startCamera() {
  if (switching) return false;
  switching = true;
  setStatus("📷 카메라 켜는 중…");
  let newStream = null;
  try {
    try {
      newStream = await withTimeout(navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      }), 15000, "cam-timeout");
    } catch (e1) {
      // 폴드 등 전면/후면 지정이 먹지 않으면 기본 카메라로 재시도
      console.warn("지정 카메라 실패, 기본으로 재시도:", e1);
      newStream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: true, audio: false }), 15000, "cam-timeout");
    }
  } catch (e) {
    switching = false;
    console.warn(e);
    if (e.name === "NotAllowedError" || e.name === "SecurityError") {
      $("denied").classList.remove("hidden");
      $("loading").classList.add("hidden");
    } else if (e.message === "cam-timeout") {
      toast("카메라가 응답 없어요 😢 다른 앱 카메라 끄고 다시 눌러주세요!");
      setStatus("😢 카메라 응답 없음 — 🔄를 다시 눌러주세요");
    } else {
      toast("카메라를 열 수 없어요 😢 " + e.message);
      setStatus("😢 카메라 실패 — 🔄를 다시 눌러주세요");
    }
    return false;
  }
  // 새 스트림 확보 성공 → 이제 예전 것 끄고 교체
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = newStream;
  try { video.pause(); } catch {}
  video.srcObject = stream;
  video.classList.toggle("mirror", mirror());
  try { await withTimeout(video.play(), 10000, "play-timeout"); } catch (e) { console.warn("play 대기:", e); }
  await new Promise((res) => { // 영상이 실제로 나올 때까지 대기
    if (video.readyState >= 2 && video.videoWidth) return res();
    const h = () => { video.removeEventListener("loadeddata", h); res(); };
    video.addEventListener("loadeddata", h);
    setTimeout(res, 5000);
  });
  resizeCanvas();
  setupZoom();
  $("denied").classList.add("hidden");
  switching = false;
  return true;
}
// 캔버스는 화면 비율 그대로 (예전엔 카메라 비율이라 세로 화면에서 잘려 확대돼 보였음)
function resizeCanvas() {
  const st = $("stage"), cw = st.clientWidth || 360, ch = st.clientHeight || 640;
  const L = Math.max(video.videoWidth, video.videoHeight) || 1280;
  const w = cw >= ch ? L : Math.round(L * cw / ch), h = cw >= ch ? Math.round(L * ch / cw) : L;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
// 카메라 영상을 캔버스 어디에 얼마나 크게 놓을지 (기본은 넓게, swZoom으로 확대/축소)
let swZoom = 1;
function layout() {
  const W = canvas.width, H = canvas.height, vw = video.videoWidth || W, vh = video.videoHeight || H;
  const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
  const floor = Math.min(contain, cover * 0.6);
  const k = cover * Math.pow(floor / cover, 0.7) * swZoom; // 꽉 채움과 전체 보기 사이, 전체 보기 쪽에 가깝게
  const dw = vw * k, dh = vh * k;
  return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, fills: dw >= W - 1 && dh >= H - 1 };
}

// ---------- 배율 (폰 카메라 배율 지원하면 그걸, 아니면 화면 배율) ----------
let hwZoom = null; // { min, max } — 하드웨어 배율 범위
function setupZoom() {
  const bar = $("zoombar"), track = stream && stream.getVideoTracks()[0];
  let caps = {};
  try { caps = (track && track.getCapabilities && track.getCapabilities()) || {}; } catch {}
  hwZoom = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null;
  let levels;
  if (hwZoom) {
    levels = [0.5, 0.6, 1, 2, 3, 5].filter(v => v >= hwZoom.min - 0.001 && v <= hwZoom.max + 0.001);
    const mn = Math.round(hwZoom.min * 10) / 10;
    if (mn < 1 && !levels.includes(mn)) levels.unshift(mn);
    if (!levels.includes(1)) levels.push(1);
    if (!levels.includes(0.5)) levels.unshift(0.5); // 폰 배율이 0.5까지 안 내려가도 0.5는 항상 (모자란 만큼 화면 축소)
    levels = [...new Set(levels)].sort((a, b) => a - b).slice(0, 5);
  } else levels = [0.5, 0.7, 1, 2];
  bar.innerHTML = "";
  levels.forEach(v => {
    const b = document.createElement("button");
    b.className = "zoom-chip"; b.dataset.z = v;
    b.textContent = (v < 1 ? String(v).replace(/^0/, "") : v) + "x";
    b.onclick = () => setZoom(v);
    bar.appendChild(b);
  });
  setZoom(1, true);
}
async function setZoom(v, quiet) {
  document.querySelectorAll(".zoom-chip").forEach(b => b.classList.toggle("active", +b.dataset.z === v));
  if (hwZoom) {
    const hw = Math.min(hwZoom.max, Math.max(hwZoom.min, v));
    swZoom = v / hw; // 폰 배율 최소보다 낮으면 나머지는 화면 축소로
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: hw }] }); }
    catch (e) { console.warn("배율 실패:", e); hwZoom = null; swZoom = v; } // 하드웨어 실패 → 화면 배율로
  } else swZoom = v;
  if (!quiet) toast(`🔍 ${v}x`, 900);
}
window.addEventListener("resize", resizeCanvas);
$("btnRetry").onclick = async () => { $("denied").classList.add("hidden"); $("loading").classList.remove("hidden"); await startCamera(); $("loading").classList.add("hidden"); };
$("btnFlip").onclick = async () => {
  if (switching) return;
  facing = facing === "environment" ? "user" : "environment";
  const ok = await startCamera();
  faces = []; faceChars = [];
  if (ok) setStatus(visionReady ? "✨ 얼굴을 화면 가운데에 맞춰보세요!" : "🧠 인식 준비 중…");
  // 실패 시 startCamera가 이미 안내 문구를 보여줌 (예전 화면은 그대로 유지)
};

// ---------- 모델 로딩 (GPU 실패하면 CPU로 재시도 — 갤럭시 등 대응) ----------
async function loadModels(retried = false) {
  if (modelLoading) return;
  modelLoading = true;
  setStatus("🧠 얼굴 인식 준비 중… (10초 정도)");
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    const url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
    try {
      faceLM = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: url, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 4,
      });
    } catch (e) {
      console.warn("GPU 실패, CPU로 재시도:", e);
      faceLM = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: url, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 4,
      });
    }
    visionReady = true;
    modelLoading = false;
    setStatus("✨ 얼굴을 화면 가운데에 맞춰보세요!");
  } catch (e) {
    console.warn(e);
    visionReady = false;
    modelLoading = false;
    if (!retried) { // 한 번은 자동으로 다시 받기
      setStatus("🧠 인식 다시 받는 중… (잠시만요)");
      setTimeout(() => loadModels(true), 4000);
    } else {
      setStatus("😢 인식 준비 실패 — 화면을 한 번 톡 터치!");
      toast("모델을 못 받았어요. 와이파이 확인 후 화면을 톡 터치!");
    }
  }
}
// 인식 실패 상태면 화면 터치로 다시 받기
$("stage").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  if (!visionReady && !modelLoading) loadModels();
});

// ---------- 인식 루프 ----------
function detectLoop() {
  const now = performance.now();
  if (visionReady && video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect > 90) {
    lastDetect = now; lastVideoTime = video.currentTime;
    try {
      const fr = faceLM.detectForVideo(video, video.currentTime * 1000);
      const W = canvas.width, Lo = layout();
      faces = (fr.faceLandmarks || []).map(lm => {
        const P = (i) => ({ x: Lo.dx + lm[i].x * Lo.dw, y: Lo.dy + lm[i].y * Lo.dh });
        const avg = (a) => ({ x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length });
        let f = {
          leye: avg([P(33), P(133), P(159), P(145)]),
          reye: avg([P(362), P(263), P(386), P(374)]),
          nose: P(1), mouth: P(13), top: P(10), chin: P(152),
        };
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (const p of lm) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
        f.box = { x: Lo.dx + minX * Lo.dw, y: Lo.dy + minY * Lo.dh, w: (maxX - minX) * Lo.dw, h: (maxY - minY) * Lo.dh };
        if (mirror()) {
          const mx = (p) => ({ x: W - p.x, y: p.y });
          f.leye = mx(f.leye); f.reye = mx(f.reye); f.nose = mx(f.nose);
          f.mouth = mx(f.mouth); f.top = mx(f.top); f.chin = mx(f.chin);
          f.box.x = W - f.box.x - f.box.w;
        }
        return f;
      });
      while (faceChars.length < faces.length) faceChars.push(char === "random" ? pick(CHARS) : char);
      if (faces.length) { setStatus(`✨ 얼굴 ${faces.length}명 인식됨!`); $("hint").style.display = "none"; }
      else { setStatus("✨ 얼굴을 화면 가운데에 맞춰보세요!"); $("hint").style.display = ""; }
    } catch (e) { console.warn(e); }
  }
  requestAnimationFrame(detectLoop);
}

// ---------- 그리기 ----------
const beauty = document.createElement("canvas");
const bctx = beauty.getContext("2d");
// 인식은 초당 10번이라 그대로 그리면 뚝뚝 끊김 → 매 프레임 목표 위치로 부드럽게 따라가기
let shown = [];
const PTS = ["leye", "reye", "nose", "mouth", "top", "chin"];
function smoothFaces() {
  shown = faces.map((f, i) => {
    const p = shown[i];
    const far = p && Math.hypot(p.nose.x - f.nose.x, p.nose.y - f.nose.y) > f.box.w; // 순간이동이면 바로 붙기
    if (!p || far) return { ...f };
    const o = { box: f.box };
    for (const k of PTS) o[k] = { x: p[k].x + (f[k].x - p[k].x) * 0.35, y: p[k].y + (f[k].y - p[k].y) * 0.35 };
    return o;
  });
}
function drawLoop(t) {
  const W = canvas.width, H = canvas.height;
  // ----- 뽀샤시 베이스: 몽글 + 밝게 + 분홍 광 (저장되는 사진과 똑같이 보임) -----
  if (video.readyState >= 2 && video.videoWidth) {
    const bw = 240, bh = Math.max(2, Math.round(240 * video.videoHeight / video.videoWidth));
    if (beauty.width !== bw || beauty.height !== bh) { beauty.width = bw; beauty.height = bh; }
    bctx.drawImage(video, 0, 0, bw, bh);
    const Lo = layout();
    ctx.save();
    if (mirror()) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (!Lo.fills) { // 영상이 화면보다 작으면 남는 곳은 흐린 배경으로 채움
      const c = Math.max(W / bw, H / bh) * 1.1;
      ctx.filter = "blur(6px) brightness(1.05) saturate(1.2)";
      ctx.drawImage(beauty, (W - bw * c) / 2, (H - bh * c) / 2, bw * c, bh * c);
      ctx.fillStyle = "rgba(255,235,245,.35)"; ctx.fillRect(0, 0, W, H);
    }
    ctx.filter = "brightness(1.12) saturate(1.3) contrast(.96)";
    ctx.drawImage(beauty, Lo.dx, Lo.dy, Lo.dw, Lo.dh);       // 몽글 베이스
    ctx.filter = "brightness(1.1) saturate(1.25)";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(video, Lo.dx, Lo.dy, Lo.dw, Lo.dh);        // 디테일 살리기
    ctx.restore();
    ctx.fillStyle = "rgba(255,170,200,.07)"; // 분홍 광
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
  }
  smoothFaces();
  if (!shown.length) drawGuide(t);   // 얼굴 없으면 가이드 타원
  else shown.forEach((f, i) => {
    const c = char === "random" ? (faceChars[i] || "panda") : char;
    drawMask(ctx, f, c, t, i * 7 + shuffleTick);
  });
  requestAnimationFrame(drawLoop);
}
function drawGuide(t) {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H * 0.42, rx = Math.min(W, H) * 0.26, ry = rx * 1.3;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = Math.max(4, W / 200);
  ctx.setLineDash([18, 12]);
  ctx.lineDashOffset = -t * 0.03;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = `bold ${Math.round(W / 22)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("얼굴을 여기에!", cx, cy + ry + 50);
  ctx.restore();
}

// ---------- 사진 저장 ----------
$("btnShot").onclick = () => {
  if (!video.videoWidth) return toast("카메라 준비 중…");
  // 화면(canvas)에 이미 뽀샤시+가면까지 다 그려져 있으니 그대로 저장
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `gamyun-${Date.now()}.jpg`, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "가면카메라" }); return; } catch {}
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("📸 저장됐어요! 갤러리를 확인하세요");
  }, "image/jpeg", 0.92);
};

// ---------- 시작 ----------
(async function init() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    $("loading").classList.add("hidden");
    $("denied").classList.remove("hidden");
    return;
  }
  const ok = await startCamera();
  $("loading").classList.add("hidden");
  if (!ok) return;
  loadModels();
  requestAnimationFrame(drawLoop);
  requestAnimationFrame(detectLoop);
})();
