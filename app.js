// 낙서카메라 — 1단계: 카메라 + 떠다니는 낙서 / 2단계: 얼굴 / 3단계: 사물 / 4단계: 저장·스타일·섞기
import { FaceLandmarker, ObjectDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const $ = (id) => document.getElementById(id);
const video = $("cam"), canvas = $("art"), ctx = canvas.getContext("2d");
const statusEl = $("status"), toastEl = $("toast");

let facing = "environment"; // 후면 시작
let stream = null;
let faceLM = null, objDet = null, visionReady = false;
let faces = [];    // [{box, leye, reye, nose, mouth, top}]
let objects = [];  // [{x,y,w,h,label,score}]
let lastDetect = 0, lastVideoTime = -1;
let style = "crayon";
let faceSeeds = [];   // 얼굴별 랜덤 낙서
let objSeeds = {};    // 사물 id별 랜덤 낙서
let floaters = [];
let startT = performance.now();

const BUBBLES = ["배고파…", "신나!", "안녕!", "히히", "깜찍!", "놀자!"];
const PALETTE = ["#ff5d8f", "#ffb800", "#3ec6ff", "#7ddf5e", "#b388ff", "#ff7a3d"];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mirror = () => facing === "user";

function toast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}
function setStatus(msg) { statusEl.textContent = msg; }

// ---------- 스타일 ----------
const STYLES = {
  crayon: { width: 5, alpha: 0.95, jitter: 2.2 },
  marker: { width: 7, alpha: 1.0, jitter: 1.2 },
  high:   { width: 13, alpha: 0.55, jitter: 1.6 },
};
document.querySelectorAll(".style-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".style-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  style = b.dataset.style;
  toast({ crayon: "🖍️ 크레용!", marker: "🖊️ 매직펜!", high: "✨ 형광펜!" }[style]);
});
function applyStyle() {
  const s = STYLES[style];
  ctx.lineWidth = s.width;
  ctx.globalAlpha = s.alpha;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
}
const wig = (seed, t, amp) => Math.sin(t * 0.008 + seed) * amp + Math.sin(t * 0.021 + seed * 2) * amp * 0.5;

// ---------- 카메라 ----------
async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  } catch (e) {
    console.warn(e);
    if (e.name === "NotAllowedError" || e.name === "SecurityError") {
      $("denied").classList.remove("hidden");
      $("loading").classList.add("hidden");
    } else {
      toast("카메라를 열 수 없어요 😢 " + e.message);
    }
    return false;
  }
  video.srcObject = stream;
  video.classList.toggle("mirror", mirror());
  canvas.classList.toggle("mirror", false); // 좌표로 직접 미러링하므로 CSS 미러 안 씀
  await video.play();
  resizeCanvas();
  $("denied").classList.add("hidden");
  return true;
}
function resizeCanvas() {
  if (!video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}
window.addEventListener("resize", resizeCanvas);
$("btnRetry").onclick = async () => { $("denied").classList.add("hidden"); $("loading").classList.remove("hidden"); await startCamera(); $("loading").classList.add("hidden"); };
$("btnFlip").onclick = async () => {
  facing = facing === "environment" ? "user" : "environment";
  setStatus("📷 카메라 전환 중…");
  await startCamera();
  reshuffle();
  setStatus(visionReady ? "✨ 얼굴·사물을 비춰보세요!" : "🌟 낙서 모드!");
};
$("btnShuffle").onclick = () => { reshuffle(); toast("🎲 낙서 새로 섞기!"); };

// ---------- 랜덤 시드 ----------
function reshuffle() {
  faceSeeds = faces.map(() => newFaceSeed());
  objSeeds = {};
  objects.forEach((_, i) => objSeeds[i] = newObjSeed());
  makeFloaters();
}
function newFaceSeed() {
  return {
    deco: pick(["crown", "sprout", "ribbon"]),   // 머리 위
    mustache: Math.random() < 0.7,
    mustacheStyle: pick(["curly", "rect", "tiny"]),
    blush: Math.random() < 0.85,
    sparkle: Math.random() < 0.8,
    bubble: Math.random() < 0.55 ? pick(BUBBLES) : null,
    color: pick(PALETTE), color2: pick(PALETTE),
    seed: rand(0, 100),
  };
}
function newObjSeed() {
  return {
    mouth: pick(["smile", "open", "w"]),
    armPose: pick(["up", "down", "wave"]),
    color: pick(PALETTE), color2: pick(PALETTE),
    seed: rand(0, 100),
  };
}
function makeFloaters() {
  floaters = [];
  const kinds = ["star", "heart", "cloud", "bug"];
  for (let i = 0; i < 9; i++) {
    floaters.push({ kind: kinds[i % 4], x: Math.random(), y: Math.random(), s: rand(14, 34), ph: rand(0, 9), sp: rand(0.3, 0.9), color: pick(PALETTE) });
  }
}

// ---------- 모델 로딩 (온디바이스, 서버 전송 없음) ----------
async function loadModels() {
  try {
    setStatus("🧠 인식 모델 불러오는 중…");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    faceLM = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 3,
    });
    objDet = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.task", delegate: "GPU" },
      scoreThreshold: 0.35, runningMode: "VIDEO",
    });
    visionReady = true;
    setStatus("✨ 얼굴·사물을 비춰보세요!");
  } catch (e) {
    console.warn("모델 로딩 실패, 낙서 모드로:", e);
    visionReady = false;
    setStatus("🌟 낙서 모드 (모델 없음)");
    toast("인식 모델을 못 받았어요. 별·하트 낙서로 놀아요!");
  }
}

// ---------- 인식 루프 (초당 ~10~15회) ----------
function detectLoop() {
  const now = performance.now();
  if (visionReady && video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect > 90) {
    lastDetect = now; lastVideoTime = video.currentTime;
    const t = video.currentTime * 1000;
    try {
      // 얼굴
      const fr = faceLM.detectForVideo(video, t);
      const W = canvas.width, H = canvas.height;
      faces = (fr.faceLandmarks || []).map(lm => {
        const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
        const leye = avg([P(33), P(133), P(159), P(145)]);
        const reye = avg([P(362), P(263), P(386), P(374)]);
        const nose = P(1), mouth = P(13), top = P(10);
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        lm.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        if (mirror()) {
          const mx = (p) => ({ x: W - p.x, y: p.y });
          return { box: { x: W - maxX * W, y: minY * H, w: (maxX - minX) * W, h: (maxY - minY) * H }, leye: mx(leye), reye: mx(reye), nose: mx(nose), mouth: mx(mouth), top: mx(top) };
        }
        return { box: { x: minX * W, y: minY * H, w: (maxX - minX) * W, h: (maxY - minY) * H }, leye, reye, nose, mouth, top };
      });
      while (faceSeeds.length < faces.length) faceSeeds.push(newFaceSeed());
      // 사물
      const or = objDet.detectForVideo(video, t);
      objects = (or.detections || []).slice(0, 5).map(d => {
        const b = d.boundingBox;
        let x = b.originX, y = b.originY;
        if (mirror()) x = W - x - b.width;
        return { x, y, w: b.width, h: b.height, label: d.categories[0]?.categoryName || "object", score: d.categories[0]?.score || 0 };
      });
      objects.forEach((_, i) => { if (!objSeeds[i]) objSeeds[i] = newObjSeed(); });
    } catch (e) { console.warn(e); }
  }
  requestAnimationFrame(detectLoop);
}
const avg = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

// ---------- 그리기 루프 (초당 30회+) ----------
function drawLoop(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyStyle();
  const hasTarget = faces.length > 0 || objects.length > 0;
  if (!hasTarget) drawFloaters(t);           // 아무것도 없으면 빈 공간 낙서
  else {
    drawFloaters(t, 0.35);                    // 있으면 배경에 살짝
    objects.forEach((o, i) => drawObjectDoodle(o, objSeeds[i] || (objSeeds[i] = newObjSeed()), t));
    faces.forEach((f, i) => drawFaceDoodle(f, faceSeeds[i] || (faceSeeds[i] = newFaceSeed()), t));
  }
  requestAnimationFrame(drawLoop);
}

// ----- 손그림 기본 도형 (wiggle = 선 떨림) -----
function roughEllipse(x, y, rx, ry, color, t, seed, fill = false) {
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.15; a += 0.25) {
    const w = wig(seed + a * 3, t, STYLES[style].jitter);
    const px = x + Math.cos(a) * (rx + w), py = y + Math.sin(a) * (ry + w);
    a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  fill ? ctx.fill() : ctx.stroke();
}
function roughLine(x1, y1, x2, y2, color, t, seed) {
  ctx.strokeStyle = color; ctx.beginPath();
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const px = x1 + (x2 - x1) * i / n + wig(seed + i, t, STYLES[style].jitter);
    const py = y1 + (y2 - y1) * i / n + wig(seed + i * 2, t, STYLES[style].jitter);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ----- 빈 공간 낙서 -----
function drawFloaters(t, alphaMul = 1) {
  const W = canvas.width, H = canvas.height;
  ctx.save(); ctx.globalAlpha *= alphaMul;
  floaters.forEach(f => {
    const x = f.x * W + Math.sin(t * 0.0006 * f.sp + f.ph) * 30;
    const y = f.y * H + Math.cos(t * 0.0008 * f.sp + f.ph) * 30 + wig(f.ph, t, 3);
    if (f.kind === "star") drawStar(x, y, f.s, f.color, t, f.ph);
    if (f.kind === "heart") drawHeart(x, y, f.s, f.color, t, f.ph);
    if (f.kind === "cloud") drawCloud(x, y, f.s, t, f.ph);
    if (f.kind === "bug") drawBug(x, y, f.s, t, f.ph);
  });
  ctx.restore();
}
function drawStar(x, y, s, color, t, seed) {
  ctx.strokeStyle = color; ctx.fillStyle = color + "55"; ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const r = (i % 2 === 0 ? s : s * 0.45) + wig(seed + i, t, 2);
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function drawHeart(x, y, s, color, t, seed) {
  ctx.strokeStyle = color; ctx.fillStyle = color + "66"; ctx.beginPath();
  const w = wig(seed, t, 2);
  ctx.moveTo(x, y + s * 0.6 + w);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.2 + w, x - s * 0.5, y - s, x, y - s * 0.3 + w);
  ctx.bezierCurveTo(x + s * 0.5, y - s, x + s * 1.1, y - s * 0.2 + w, x, y + s * 0.6 + w);
  ctx.fill(); ctx.stroke();
}
function drawCloud(x, y, s, t, seed) {
  const c = "#ffffff";
  [[0, 0, s * .55], [-s * .5, s * .15, s * .38], [s * .5, s * .15, s * .4]].forEach(([ox, oy, r], i) => {
    roughEllipse(x + ox, y + oy + wig(seed + i, t, 2), r, r * .8, c, t, seed + i, true);
  });
  ctx.strokeStyle = "#7cc4ff"; ctx.beginPath();
  ctx.moveTo(x - s * .6, y + s * .5); ctx.lineTo(x + s * .6, y + s * .5); ctx.stroke();
}
function drawBug(x, y, s, t, seed) {
  const w = wig(seed, t, 3);
  roughEllipse(x, y + w, s * .4, s * .55, "#a78bfa", t, seed, true); // 몸통
  roughEllipse(x, y - s * .5 + w, s * .32, s * .3, "#fff", t, seed + 1); // 얼굴
  ctx.fillStyle = "#222";
  ctx.beginPath(); ctx.arc(x - s * .1, y - s * .5 + w, 2.5, 0, 7); ctx.arc(x + s * .1, y - s * .5 + w, 2.5, 0, 7); ctx.fill();
  roughLine(x - s * .4, y, x - s * .8, y - s * .3, "#7c6ff0", t, seed); // 다리
  roughLine(x + s * .4, y, x + s * .8, y - s * .3, "#7c6ff0", t, seed + 2);
  roughLine(x, y - s * .8, x + s * .2, y - s * 1.2, "#7c6ff0", t, seed + 3); // 더듬이
}

// ----- 얼굴 낙서 -----
function drawFaceDoodle(f, s, t) {
  const { box } = f, fw = box.w;
  const u = fw / 200; // 얼굴 크기 단위
  // 머리 위 장식
  const topX = f.top.x + wig(s.seed, t, 3), topY = f.top.y - 10 * u;
  if (s.deco === "crown") drawCrown(topX, box.y - 30 * u, fw * 0.45, "#ffb800", t, s.seed);
  if (s.deco === "sprout") drawSprout(topX, box.y - 10 * u, u, t, s.seed);
  if (s.deco === "ribbon") drawRibbon(topX, box.y - 15 * u, u, s.color, t, s.seed);
  // 반짝 눈
  if (s.sparkle) {
    drawSparkleEye(f.leye.x, f.leye.y, 14 * u, t, s.seed);
    drawSparkleEye(f.reye.x, f.reye.y, 14 * u, t, s.seed + 5);
  }
  // 볼터치
  if (s.blush) {
    roughEllipse(f.leye.x - 28 * u, f.leye.y + 30 * u, 12 * u, 7 * u, "#ff8fb3", t, s.seed + 1, true);
    roughEllipse(f.reye.x + 28 * u, f.reye.y + 30 * u, 12 * u, 7 * u, "#ff8fb3", t, s.seed + 2, true);
  }
  // 콧수염
  if (s.mustache) drawMustache(f.mouth.x, f.mouth.y - 12 * u, u, s.seed, s.mustacheStyle, s.color2);
  // 말풍선
  if (s.bubble) drawBubble(box.x + box.w + 10, box.y - 10, s.bubble, t, s.seed);
}
function drawCrown(x, y, w, color, t, seed) {
  ctx.fillStyle = color; ctx.strokeStyle = "#8a5a00";
  ctx.beginPath();
  const h = w * 0.55, wx = wig(seed, t, 3);
  ctx.moveTo(x - w / 2 + wx, y + h);
  ctx.lineTo(x - w / 2 + wx, y + h * 0.3);
  ctx.lineTo(x - w * 0.25 + wx, y + h * 0.6);
  ctx.lineTo(x + wx, y);
  ctx.lineTo(x + w * 0.25 + wx, y + h * 0.6);
  ctx.lineTo(x + w / 2 + wx, y + h * 0.3);
  ctx.lineTo(x + w / 2 + wx, y + h);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ff5d8f";
  ctx.beginPath(); ctx.arc(x + wx, y + h * 0.55, 4, 0, 7); ctx.fill();
}
function drawSprout(x, y, u, t, seed) {
  const sway = wig(seed, t, 4);
  roughLine(x, y, x + sway, y - 34 * u, "#2f9e44", t, seed);
  roughEllipse(x + sway - 12 * u, y - 28 * u, 12 * u, 7 * u, "#7ddf5e", t, seed + 1, true);
  roughEllipse(x + sway + 12 * u, y - 36 * u, 12 * u, 7 * u, "#7ddf5e", t, seed + 2, true);
}
function drawRibbon(x, y, u, color, t, seed) {
  const w = wig(seed, t, 2);
  roughEllipse(x - 12 * u, y + w, 13 * u, 10 * u, color, t, seed, true);
  roughEllipse(x + 12 * u, y - w, 13 * u, 10 * u, color, t, seed + 1, true);
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 5 * u, 0, 7); ctx.fill();
}
function drawSparkleEye(x, y, r, t, seed) {
  const w = wig(seed, t, 2.5);
  roughEllipse(x, y + w, r, r * 1.15, "#222", t, seed);
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3 + w, r * .32, 0, 7); ctx.fill();
  // 반짝이 4개
  ctx.strokeStyle = "#ffe066";
  [[-r * 1.5, -r], [r * 1.5, -r * .6]].forEach(([ox, oy], i) => {
    const sx = x + ox, sy = y + oy + wig(seed + i, t, 2);
    roughLine(sx - 5, sy, sx + 5, sy, "#ffe066", t, seed + i);
    roughLine(sx, sy - 5, sx, sy + 5, "#ffe066", t, seed + i + 9);
  });
}
function drawMustache(x, y, u, seed, styleM, color) {
  ctx.strokeStyle = "#4a3226"; ctx.fillStyle = styleM === "tiny" ? "#6b4a35" : "#4a3226";
  const w = wig(seed, t, 2), s = (styleM === "tiny" ? 0.6 : 1) * u;
  ctx.beginPath();
  if (styleM === "rect") {
    ctx.moveTo(x - 30 * s, y + w);
    ctx.quadraticCurveTo(x, y + 14 * s, x + 30 * s, y + w);
    ctx.quadraticCurveTo(x, y + 2 * s, x - 30 * s, y + w);
  } else {
    ctx.moveTo(x, y + w);
    ctx.bezierCurveTo(x - 18 * s, y - 10 * s, x - 34 * s, y - 4 * s, x - 38 * s, y - 14 * s + w);
    ctx.bezierCurveTo(x - 30 * s, y + 8 * s, x - 12 * s, y + 10 * s, x, y + w);
    ctx.bezierCurveTo(x + 12 * s, y + 10 * s, x + 30 * s, y + 8 * s, x + 38 * s, y - 14 * s + w);
    ctx.bezierCurveTo(x + 34 * s, y - 4 * s, x + 18 * s, y - 10 * s, x, y + w);
  }
  ctx.fill(); ctx.stroke();
}
function drawBubble(x, y, text, t, seed) {
  ctx.font = "bold 34px Jua, sans-serif";
  const w = ctx.measureText(text).width + 36;
  const bx = Math.min(x, canvas.width - w - 10), by = Math.max(y, 10);
  const jx = wig(seed, t, 2);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#222";
  ctx.beginPath(); ctx.roundRect(bx, by + jx, w, 48, 16); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#222"; ctx.fillText(text, bx + 18, by + 34 + jx);
}

// ----- 사물 낙서: 눈알+입+팔다리 -----
function drawObjectDoodle(o, s, t) {
  const cx = o.x + o.w / 2, topY = o.y;
  const eyeY = topY - 18 + wig(s.seed, t, 3);
  const ex = Math.min(o.w * 0.22, 46);
  // 눈알 두 개
  [[cx - ex, "#fff"], [cx + ex, "#fff"]].forEach(([exx], i) => {
    roughEllipse(exx, eyeY, 20, 24, "#ffffff", t, s.seed + i, true);
    roughEllipse(exx, eyeY, 20, 24, s.color, t, s.seed + i);
    ctx.fillStyle = "#222";
    const px = exx + wig(s.seed + i * 3, t, 4), py = eyeY + wig(s.seed + i, t, 3);
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px - 2, py - 2, 2.2, 0, 7); ctx.fill();
  });
  // 입
  ctx.strokeStyle = s.color2; ctx.lineWidth = STYLES[style].width;
  const my = eyeY + 34;
  ctx.beginPath();
  if (s.mouth === "smile") ctx.arc(cx, my - 8, 16, 0.15 * Math.PI, 0.85 * Math.PI);
  if (s.mouth === "open") roughEllipse(cx, my, 12, 14, s.color2, t, s.seed + 7, true);
  if (s.mouth === "w") { ctx.moveTo(cx - 18, my); ctx.quadraticCurveTo(cx - 9, my + 12, cx, my); ctx.quadraticCurveTo(cx + 9, my + 12, cx + 18, my); }
  ctx.stroke();
  // 팔다리
  const lx = o.x, rx = o.x + o.w, midY = o.y + o.h / 2;
  if (s.armPose === "up") {
    roughLine(lx, midY, lx - 34, midY - 40, s.color, t, s.seed);
    roughLine(rx, midY, rx + 34, midY - 40, s.color, t, s.seed + 1);
  } else if (s.armPose === "wave") {
    roughLine(lx, midY, lx - 30, midY + 10 + wig(s.seed, t, 6), s.color, t, s.seed);
    roughLine(rx, midY, rx + 34, midY - 46, s.color, t, s.seed + 1);
  } else {
    roughLine(lx, midY, lx - 30, midY + 24, s.color, t, s.seed);
    roughLine(rx, midY, rx + 30, midY + 24, s.color, t, s.seed + 1);
  }
  roughLine(cx - 18, o.y + o.h, cx - 24, o.y + o.h + 30, s.color2, t, s.seed + 4); // 다리
  roughLine(cx + 18, o.y + o.h, cx + 24, o.y + o.h + 30, s.color2, t, s.seed + 5);
  // 라벨 꼬리표
  ctx.font = "bold 26px Jua, sans-serif";
  const label = `${o.label} 💫`;
  const lw = ctx.measureText(label).width + 24;
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#222";
  ctx.beginPath(); ctx.roundRect(Math.min(cx - lw / 2, canvas.width - lw - 8), o.y + o.h + 34 + wig(s.seed, t, 2), lw, 38, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#222"; ctx.fillText(label, Math.min(cx - lw / 2, canvas.width - lw - 8) + 12, o.y + o.h + 61 + wig(s.seed, t, 2));
}

// ---------- 사진 저장 (영상+낙서 합성) ----------
$("btnShot").onclick = async () => {
  if (!video.videoWidth) return toast("카메라 준비 중…");
  const out = document.createElement("canvas");
  out.width = video.videoWidth; out.height = video.videoHeight;
  const octx = out.getContext("2d");
  octx.save();
  if (mirror()) { octx.translate(out.width, 0); octx.scale(-1, 1); }
  octx.drawImage(video, 0, 0);
  octx.restore();
  // 낙서 레이어 합성 (미러 해제 상태로 그려진 canvas 그대로)
  octx.drawImage(canvas, 0, 0);
  out.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `nakseo-${Date.now()}.jpg`, { type: "image/jpeg" });
    // 공유 시트 우선 (모바일)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "낙서카메라" }); return; } catch { /* 취소 시 다운로드로 */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("📸 저장됐어요! 갤러리를 확인하세요");
  }, "image/jpeg", 0.92);
};

// ---------- 시작 ----------
(async function init() {
  makeFloaters();
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    $("loading").classList.add("hidden");
    $("denied").classList.remove("hidden");
    return;
  }
  const ok = await startCamera();
  $("loading").classList.add("hidden");
  if (!ok) return;
  loadModels();            // 백그라운드 로딩
  requestAnimationFrame(drawLoop);
  requestAnimationFrame(detectLoop);
})();
