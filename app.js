// 가면카메라 — 얼굴에 판다/토끼/고양이/곰/개구리 가면을 씌운다
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

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
const CHARS = ["panda", "rabbit", "cat", "bear", "frog"];
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
  $("denied").classList.add("hidden");
  switching = false;
  return true;
}
function resizeCanvas() {
  if (video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
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
      const W = canvas.width, H = canvas.height;
      faces = (fr.faceLandmarks || []).map(lm => {
        const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
        const avg = (a) => ({ x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length });
        let f = {
          leye: avg([P(33), P(133), P(159), P(145)]),
          reye: avg([P(362), P(263), P(386), P(374)]),
          nose: P(1), mouth: P(13), top: P(10), chin: P(152),
        };
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (const p of lm) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
        f.box = { x: minX * W, y: minY * H, w: (maxX - minX) * W, h: (maxY - minY) * H };
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
const wig = (seed, t, amp) => Math.sin(t * 0.008 + seed) * amp + Math.sin(t * 0.021 + seed * 2) * amp * 0.4;
// 눈周 뽀샤시 광 + 십자 반짝이
function eyeGlow(f) {
  const ed = Math.hypot(f.leye.x - f.reye.x, f.leye.y - f.reye.y);
  [f.leye, f.reye].forEach(e => {
    const g = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, ed);
    g.addColorStop(0, "rgba(255,255,255,.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(e.x, e.y, ed, 0, 7); ctx.fill();
  });
}
function plusSparkle(x, y, r, color) {
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, r * 0.45); ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, 7); ctx.fill();
}
function heartNose(x, y, s, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x, y + s * 0.6);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.25);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.1, y - s * 0.1, x, y + s * 0.6);
  ctx.fill();
}
function drawLoop(t) {
  const W = canvas.width, H = canvas.height;
  // ----- 뽀샤시 베이스: 몽글 + 밝게 + 분홍 광 (저장되는 사진과 똑같이 보임) -----
  if (video.readyState >= 2 && video.videoWidth) {
    const bw = 240, bh = Math.max(2, Math.round(240 * H / W));
    if (beauty.width !== bw || beauty.height !== bh) { beauty.width = bw; beauty.height = bh; }
    bctx.drawImage(video, 0, 0, bw, bh);
    ctx.save();
    if (mirror()) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.filter = "brightness(1.12) saturate(1.3) contrast(.96)";
    ctx.drawImage(beauty, 0, 0, W, H);       // 몽글 베이스
    ctx.filter = "brightness(1.1) saturate(1.25)";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(video, 0, 0, W, H);        // 디테일 살리기
    ctx.restore();
    ctx.fillStyle = "rgba(255,170,200,.07)"; // 분홍 광
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
  }
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (!faces.length) drawGuide(t);   // 얼굴 없으면 가이드 타원
  else faces.forEach((f, i) => {
    const c = char === "random" ? (faceChars[i] || "panda") : char;
    drawMask(f, c, t, i * 7 + shuffleTick);
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
function drawMask(f, c, t, seed) {
  ctx.save();
  const wob = wig(seed, t, 0.03);
  const cx = f.box.x + f.box.w / 2, cy = f.box.y + f.box.h / 2;
  ctx.translate(cx, cy); ctx.rotate(wob); ctx.translate(-cx, -cy);
  eyeGlow(f);
  if (c === "panda") maskPanda(f, t, seed);
  else if (c === "rabbit") maskRabbit(f, t, seed);
  else if (c === "cat") maskCat(f, t, seed);
  else if (c === "bear") maskBear(f, t, seed);
  else maskFrog(f, t, seed);
  ctx.restore();
}
const E = (x, y, rx, ry, fill, stroke, lw = 6) => {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
};
function sparkle(x, y, r) {
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, 7); ctx.fill();
}
function blush(x, y, r) { E(x, y, r, r * 0.65, "rgba(255,120,160,.75)", null); }

// 판다
function maskPanda(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const jx = wig(s, t, box.w * 0.008);
  E(cx - box.w * 0.42 + jx, box.y + box.h * 0.04, box.w * 0.19, box.h * 0.17, "#2b2b2b", "#111", 5);
  E(cx + box.w * 0.42 + jx, box.y + box.h * 0.04, box.w * 0.19, box.h * 0.17, "#2b2b2b", "#111", 5);
  // 얼굴은 가리지 않고 눈 패치만
  const ang = 0.5;
  [[f.leye, -1], [f.reye, 1]].forEach(([e]) => {
    ctx.save(); ctx.translate(e.x + jx, e.y); ctx.rotate(ang * (e === f.leye ? 1 : -1));
    E(0, 0, box.w * 0.155, box.h * 0.185, "rgba(43,43,43,.95)", null);
    sparkle(0, -box.h * 0.03, box.w * 0.045);
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(box.w * 0.05, box.h * 0.05, box.w * 0.016, 0, 7); ctx.fill();
    ctx.restore();
  });
  plusSparkle(cx + box.w * 0.52 + jx, box.y - box.h * 0.04 + wig(s + 9, t, 4), box.w * 0.035, "#ffe066");
  const nx = f.nose.x + jx, ny = f.nose.y + box.h * 0.06;
  E(nx, ny, box.w * 0.075, box.h * 0.058, "#2b2b2b", null); // 코 (큼+광)
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath(); ctx.arc(nx - box.w * 0.022, ny - box.h * 0.016, box.w * 0.015, 0, 7); ctx.fill();
  ctx.strokeStyle = "#2b2b2b"; ctx.lineWidth = 6; ctx.beginPath(); // ω 입
  const my = f.mouth.y;
  ctx.moveTo(nx, ny + box.h * 0.05);
  ctx.quadraticCurveTo(nx - box.w * 0.045, my - 2, nx - box.w * 0.088, my + 3);
  ctx.moveTo(nx, ny + box.h * 0.05);
  ctx.quadraticCurveTo(nx + box.w * 0.045, my - 2, nx + box.w * 0.088, my + 3);
  ctx.stroke();
  blush(f.leye.x - box.w * 0.17 + jx, f.leye.y + box.h * 0.2, box.w * 0.075);
  blush(f.reye.x + box.w * 0.17 + jx, f.reye.y + box.h * 0.2, box.w * 0.075);
}
// 토끼
function maskRabbit(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2;
  const sway = wig(s, t, box.w * 0.02);
  [[-1], [1]].forEach(([d]) => { // 긴 귀 (큼+광)
    const ex = cx + d * box.w * 0.2 + sway * d, ey = box.y - box.h * 0.42;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(d * 0.12 + sway * 0.01);
    E(0, 0, box.w * 0.125, box.h * 0.37, "#fdfdfd", "#222", 7);
    E(0, box.h * 0.03, box.w * 0.058, box.h * 0.22, "#ffb3c7", null);
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(-box.w * 0.07, -box.h * 0.25); ctx.quadraticCurveTo(-box.w * 0.09, 0, -box.w * 0.06, box.h * 0.2); ctx.stroke();
    ctx.restore();
  });
  const cy = box.y + box.h / 2, jx = wig(s + 3, t, box.w * 0.008);
  // 얼굴은 가리지 않고 코·이빨·수염만
  // 눈은 가리지 않고 눈꼬리 반짝이만
  [[f.leye, -1], [f.reye, 1]].forEach(([e, d]) => {
    const sx = e.x + d * box.w * 0.09 + jx, sy = e.y - box.h * 0.06;
    ctx.strokeStyle = "#ffb800"; ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy);
    ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7); ctx.stroke();
    sparkle(sx + d * 10, sy + 8, box.w * 0.012);
  });
  heartNose(f.nose.x + jx, f.nose.y + box.h * 0.04, box.w * 0.055, "#ff7fa0"); // 하트 코
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath(); ctx.arc(f.nose.x - box.w * 0.015 + jx, f.nose.y + box.h * 0.02, box.w * 0.012, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#222"; ctx.lineWidth = 5; // 앞니 (큼)
  const tw = box.w * 0.11, th = box.h * 0.11, tx = f.mouth.x - tw / 2 + jx, ty = f.mouth.y;
  ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx + tw / 2, ty); ctx.lineTo(tx + tw / 2, ty + th); ctx.stroke();
  ctx.fillStyle = "#ff9db8"; // 수염점
  [-1, 1].forEach(d => [0.1, 0.16, 0.22].forEach(k => {
    ctx.beginPath(); ctx.arc(f.nose.x + d * box.w * 0.19 + jx, f.nose.y + box.h * k, 2.6, 0, 7); ctx.fill();
  }));
  blush(f.leye.x - box.w * 0.16 + jx, f.leye.y + box.h * 0.18, box.w * 0.07);
  blush(f.reye.x + box.w * 0.16 + jx, f.reye.y + box.h * 0.18, box.w * 0.07);
}
// 고양이
function maskCat(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const jx = wig(s, t, box.w * 0.008);
  [[-1], [1]].forEach(([d]) => { // 삼각귀 (큼+광)
    const bx = cx + d * box.w * 0.34 + jx, by = box.y + box.h * 0.06;
    ctx.fillStyle = "#f5a742"; ctx.strokeStyle = "#222"; ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bx - box.w * 0.155, by + box.h * 0.12);
    ctx.lineTo(bx + d * box.w * 0.02, by - box.h * 0.25);
    ctx.lineTo(bx + box.w * 0.175, by + box.h * 0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffc7d6";
    ctx.beginPath();
    ctx.moveTo(bx - box.w * 0.055, by + box.h * 0.06);
    ctx.lineTo(bx + d * box.w * 0.02, by - box.h * 0.11);
    ctx.lineTo(bx + box.w * 0.075, by + box.h * 0.05);
    ctx.closePath(); ctx.fill();
  });
  // 얼굴은 가리지 않고 귀·줄무늬·아이라인만
  ctx.fillStyle = "#7a4a12"; // 이마 줄무늬 (동글)
  [-0.2, 0, 0.2].forEach(k => {
    E(cx + box.w * k + jx, box.y + box.h * 0.08, box.w * 0.028, box.h * 0.05, "#7a4a12", null);
  });
  // 눈은 가리지 않고 아이라인만 (눈 위 선 + 눈꼬리 삐침)
  [[f.leye, -1], [f.reye, 1]].forEach(([e, d]) => {
    ctx.strokeStyle = "#222"; ctx.lineWidth = Math.max(3, box.w * 0.014); ctx.beginPath();
    ctx.moveTo(e.x - box.w * 0.055 + jx, e.y - box.h * 0.045);
    ctx.quadraticCurveTo(e.x + jx, e.y - box.h * 0.075, e.x + box.w * 0.055 + jx, e.y - box.h * 0.04);
    ctx.lineTo(e.x + d * box.w * 0.085 + jx, e.y - box.h * 0.075); // 삐침
    ctx.stroke();
    sparkle(e.x - d * box.w * 0.07 + jx, e.y - box.h * 0.09, box.w * 0.013);
  });
  heartNose(f.nose.x + jx, f.nose.y + box.h * 0.04, box.w * 0.05, "#e05585"); // 하트 코
  ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.beginPath(); // ω 입
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.09);
  ctx.quadraticCurveTo(f.nose.x - box.w * 0.05 + jx, f.mouth.y, f.nose.x - box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.09);
  ctx.quadraticCurveTo(f.nose.x + box.w * 0.05 + jx, f.mouth.y, f.nose.x + box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.stroke();
  blush(f.leye.x - box.w * 0.16 + jx, f.nose.y + box.h * 0.16, box.w * 0.06);
  blush(f.reye.x + box.w * 0.16 + jx, f.nose.y + box.h * 0.16, box.w * 0.06);
  ctx.strokeStyle = "rgba(60,60,60,.9)"; ctx.lineWidth = 3; // 수염
  [-1, 1].forEach(d => [0.12, 0.2].forEach((k, i) => {
    ctx.beginPath();
    ctx.moveTo(f.nose.x + d * box.w * 0.2 + jx, f.nose.y + box.h * k);
    ctx.lineTo(f.nose.x + d * box.w * 0.48 + jx, f.nose.y + box.h * (k - 0.04 + i * 0.06));
    ctx.stroke();
  }));
}
// 곰
function maskBear(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const jx = wig(s, t, box.w * 0.008);
  [[-1], [1]].forEach(([d]) => { // 둥근 귀 (큼+광)
    E(cx + d * box.w * 0.4 + jx, box.y + box.h * 0.05, box.w * 0.17, box.h * 0.15, "#8a5a2b", "#222", 7);
    E(cx + d * box.w * 0.4 + jx, box.y + box.h * 0.05, box.w * 0.08, box.h * 0.07, "#e8c39a", null);
  });
  // 얼굴은 가리지 않고 귀·주둥이(입 주변만)만
  E(cx + jx, f.mouth.y - box.h * 0.06, box.w * 0.22, box.h * 0.2, "rgba(232,195,154,.95)", null); // 주둥이
  // 눈은 가리지 않고 눈 밑 꿀 반짝이만
  [f.leye, f.reye].forEach(e => sparkle(e.x + jx + box.w * 0.05, e.y + box.h * 0.07, box.w * 0.016));
  E(f.nose.x + jx, f.nose.y + box.h * 0.04, box.w * 0.08, box.h * 0.058, "#3a2410", null); // 코 (큼+광)
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath(); ctx.arc(f.nose.x - box.w * 0.022 + jx, f.nose.y + box.h * 0.022, box.w * 0.015, 0, 7); ctx.fill();
  ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 5; ctx.beginPath();
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.09);
  ctx.lineTo(f.nose.x + jx, f.mouth.y);
  ctx.moveTo(f.nose.x + jx, f.mouth.y);
  ctx.quadraticCurveTo(f.nose.x - box.w * 0.06 + jx, f.mouth.y + 4, f.nose.x - box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.moveTo(f.nose.x + jx, f.mouth.y);
  ctx.quadraticCurveTo(f.nose.x + box.w * 0.06 + jx, f.mouth.y + 4, f.nose.x + box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.stroke();
}
// 개구리
function maskFrog(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const jx = wig(s, t, box.w * 0.01), pop = 1 + Math.sin(t * 0.004 + s) * 0.05;
  [[f.leye, -1], [f.reye, 1]].forEach(([e]) => { // 눈툭튀 (큼+광)
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.15 * pop, box.h * 0.15 * pop, "#4caf50", "#222", 7);
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.085, box.h * 0.085, "#fff", "#222", 4);
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.036, box.h * 0.036, "#222", null);
    sparkle(e.x + jx - 5, box.y - box.h * 0.06, box.w * 0.018);
  });
  // 얼굴은 가리지 않고 눈툭튀·웃음·볼터치만
  ctx.strokeStyle = "#1d5c22"; ctx.lineWidth = 7; ctx.beginPath(); // 활짝 웃음 (굵게)
  ctx.arc(cx + jx, f.mouth.y - box.h * 0.12, box.w * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  blush(f.leye.x - box.w * 0.18 + jx, f.mouth.y - box.h * 0.08, box.w * 0.07);
  blush(f.reye.x + box.w * 0.18 + jx, f.mouth.y - box.h * 0.08, box.w * 0.07);
  E(cx - box.w * 0.3 + jx, box.y + box.h * 0.3, box.w * 0.03, box.h * 0.03, "#2e7d32", null); // 점박이
  E(cx + box.w * 0.32 + jx, box.y + box.h * 0.45, box.w * 0.025, box.h * 0.025, "#2e7d32", null);
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
