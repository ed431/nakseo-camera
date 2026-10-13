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
  try { await video.play(); } catch {}
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
const wig = (seed, t, amp) => Math.sin(t * 0.008 + seed) * amp + Math.sin(t * 0.021 + seed * 2) * amp * 0.4;
function drawLoop(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  if (c === "panda") maskPanda(f, t, seed);
  else if (c === "rabbit") maskRabbit(f, t, seed);
  else if (c === "cat") maskCat(f, t, seed);
  else if (c === "bear") maskBear(f, t, seed);
  else maskFrog(f, t, seed);
  ctx.restore();
}
const E = (x, y, rx, ry, fill, stroke, lw = 5) => {
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
  E(cx - box.w * 0.42 + jx, box.y + box.h * 0.04, box.w * 0.17, box.h * 0.15, "#2b2b2b", "#111", 4); // 귀
  E(cx + box.w * 0.42 + jx, box.y + box.h * 0.04, box.w * 0.17, box.h * 0.15, "#2b2b2b", "#111", 4);
  E(cx + jx, cy, box.w * 0.62, box.h * 0.68, "rgba(255,255,255,.96)", "#222", 6); // 얼굴
  const ang = 0.5;
  [[f.leye, -1], [f.reye, 1]].forEach(([e]) => {
    ctx.save(); ctx.translate(e.x + jx, e.y); ctx.rotate(ang * (e === f.leye ? 1 : -1));
    E(0, 0, box.w * 0.14, box.h * 0.17, "#2b2b2b", null);
    sparkle(0, 0, box.w * 0.035);
    ctx.restore();
  });
  E(f.nose.x + jx, f.nose.y + box.h * 0.06, box.w * 0.06, box.h * 0.045, "#2b2b2b", null); // 코입
  ctx.strokeStyle = "#2b2b2b"; ctx.lineWidth = 5; ctx.beginPath();
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.1);
  ctx.quadraticCurveTo(f.nose.x - box.w * 0.06 + jx, f.mouth.y, f.nose.x - box.w * 0.1 + jx, f.mouth.y);
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.1);
  ctx.quadraticCurveTo(f.nose.x + box.w * 0.06 + jx, f.mouth.y, f.nose.x + box.w * 0.1 + jx, f.mouth.y);
  ctx.stroke();
  blush(f.leye.x - box.w * 0.16 + jx, f.leye.y + box.h * 0.2, box.w * 0.06);
  blush(f.reye.x + box.w * 0.16 + jx, f.reye.y + box.h * 0.2, box.w * 0.06);
}
// 토끼
function maskRabbit(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2;
  const sway = wig(s, t, box.w * 0.02);
  [[-1], [1]].forEach(([d]) => { // 긴 귀
    const ex = cx + d * box.w * 0.2 + sway * d, ey = box.y - box.h * 0.42;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(d * 0.12 + sway * 0.01);
    E(0, 0, box.w * 0.11, box.h * 0.34, "#f5f5f5", "#222", 6);
    E(0, box.h * 0.03, box.w * 0.05, box.h * 0.2, "#ffb3c7", null);
    ctx.restore();
  });
  const cy = box.y + box.h / 2, jx = wig(s + 3, t, box.w * 0.008);
  E(cx + jx, cy, box.w * 0.58, box.h * 0.64, "rgba(255,255,255,.96)", "#222", 6);
  [f.leye, f.reye].forEach(e => { E(e.x + jx, e.y, box.w * 0.045, box.h * 0.05, "#222", null); sparkle(e.x + jx - 3, e.y - 4, box.w * 0.016); });
  E(f.nose.x + jx, f.nose.y + box.h * 0.05, box.w * 0.045, box.h * 0.035, "#ff8fb3", "#e05585", 3); // 분홍코
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#222"; ctx.lineWidth = 4; // 앞니
  const tw = box.w * 0.09, th = box.h * 0.09, tx = f.mouth.x - tw / 2 + jx, ty = f.mouth.y;
  ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 5); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx + tw / 2, ty); ctx.lineTo(tx + tw / 2, ty + th); ctx.stroke();
  blush(f.leye.x - box.w * 0.15 + jx, f.leye.y + box.h * 0.18, box.w * 0.06);
  blush(f.reye.x + box.w * 0.15 + jx, f.reye.y + box.h * 0.18, box.w * 0.06);
}
// 고양이
function maskCat(f, t, s) {
  const { box } = f, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const jx = wig(s, t, box.w * 0.008);
  [[-1], [1]].forEach(([d]) => { // 삼각귀
    const bx = cx + d * box.w * 0.34 + jx, by = box.y + box.h * 0.06;
    ctx.fillStyle = "#f5a742"; ctx.strokeStyle = "#222"; ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(bx - box.w * 0.14, by + box.h * 0.12);
    ctx.lineTo(bx + d * box.w * 0.02, by - box.h * 0.22);
    ctx.lineTo(bx + box.w * 0.16, by + box.h * 0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffb3c7";
    ctx.beginPath();
    ctx.moveTo(bx - box.w * 0.05, by + box.h * 0.06);
    ctx.lineTo(bx + d * box.w * 0.02, by - box.h * 0.1);
    ctx.lineTo(bx + box.w * 0.07, by + box.h * 0.05);
    ctx.closePath(); ctx.fill();
  });
  E(cx + jx, cy, box.w * 0.6, box.h * 0.66, "rgba(245,167,66,.94)", "#222", 6);
  ctx.strokeStyle = "#7a4a12"; ctx.lineWidth = 5; // 줄무늬
  [-0.2, 0, 0.2].forEach(k => {
    ctx.beginPath(); ctx.moveTo(cx + box.w * k + jx, box.y + box.h * 0.02);
    ctx.lineTo(cx + box.w * k + jx, box.y + box.h * 0.14); ctx.stroke();
  });
  [f.leye, f.reye].forEach(e => { // 눈 (세로동공)
    E(e.x + jx, e.y, box.w * 0.05, box.h * 0.06, "#2f7a3d", "#222", 3);
    E(e.x + jx, e.y, box.w * 0.012, box.h * 0.045, "#111", null);
    sparkle(e.x + jx - 4, e.y - 5, box.w * 0.014);
  });
  E(f.nose.x + jx, f.nose.y + box.h * 0.05, box.w * 0.04, box.h * 0.03, "#e05585", null); // 코+입
  ctx.strokeStyle = "#222"; ctx.lineWidth = 4; ctx.beginPath();
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.08);
  ctx.quadraticCurveTo(f.nose.x - box.w * 0.05 + jx, f.mouth.y, f.nose.x - box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.moveTo(f.nose.x + jx, f.nose.y + box.h * 0.08);
  ctx.quadraticCurveTo(f.nose.x + box.w * 0.05 + jx, f.mouth.y, f.nose.x + box.w * 0.09 + jx, f.mouth.y - 2);
  ctx.stroke();
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
  [[-1], [1]].forEach(([d]) => { // 둥근 귀
    E(cx + d * box.w * 0.4 + jx, box.y + box.h * 0.05, box.w * 0.15, box.h * 0.13, "#8a5a2b", "#222", 6);
    E(cx + d * box.w * 0.4 + jx, box.y + box.h * 0.05, box.w * 0.07, box.h * 0.06, "#e8c39a", null);
  });
  E(cx + jx, cy, box.w * 0.6, box.h * 0.66, "rgba(160,110,60,.95)", "#222", 6);
  E(cx + jx, f.mouth.y - box.h * 0.06, box.w * 0.22, box.h * 0.2, "rgba(232,195,154,.95)", null); // 주둥이
  [f.leye, f.reye].forEach(e => { E(e.x + jx, e.y, box.w * 0.042, box.h * 0.048, "#222", null); sparkle(e.x + jx - 3, e.y - 4, box.w * 0.015); });
  E(f.nose.x + jx, f.nose.y + box.h * 0.04, box.w * 0.07, box.h * 0.05, "#3a2410", null);
  ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 4; ctx.beginPath();
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
  [[f.leye, -1], [f.reye, 1]].forEach(([e]) => { // 눈툭튀
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.13 * pop, box.h * 0.13 * pop, "#4caf50", "#222", 6);
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.075, box.h * 0.075, "#fff", "#222", 3);
    E(e.x + jx, box.y - box.h * 0.02, box.w * 0.032, box.h * 0.032, "#222", null);
    sparkle(e.x + jx - 4, box.y - box.h * 0.05, box.w * 0.014);
  });
  E(cx + jx, cy + box.h * 0.05, box.w * 0.6, box.h * 0.62, "rgba(76,175,80,.93)", "#222", 6);
  ctx.strokeStyle = "#1d5c22"; ctx.lineWidth = 6; ctx.beginPath(); // 활짝 웃음
  ctx.arc(cx + jx, f.mouth.y - box.h * 0.12, box.w * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  blush(f.leye.x - box.w * 0.17 + jx, f.mouth.y - box.h * 0.08, box.w * 0.06);
  blush(f.reye.x + box.w * 0.17 + jx, f.mouth.y - box.h * 0.08, box.w * 0.06);
  E(cx - box.w * 0.3 + jx, box.y + box.h * 0.3, box.w * 0.03, box.h * 0.03, "#2e7d32", null); // 점박이
  E(cx + box.w * 0.32 + jx, box.y + box.h * 0.45, box.w * 0.025, box.h * 0.025, "#2e7d32", null);
}

// ---------- 사진 저장 ----------
$("btnShot").onclick = () => {
  if (!video.videoWidth) return toast("카메라 준비 중…");
  const out = document.createElement("canvas");
  out.width = video.videoWidth; out.height = video.videoHeight;
  const o = out.getContext("2d");
  o.save();
  if (mirror()) { o.translate(out.width, 0); o.scale(-1, 1); }
  o.drawImage(video, 0, 0);
  o.restore();
  o.drawImage(canvas, 0, 0);
  out.toBlob(async (blob) => {
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
