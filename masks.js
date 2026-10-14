// 캐릭터 가면 그리기 — 얼굴 기준 좌표계(눈 사이 거리 = 1)에서 스티커처럼 그린다
// 고개를 기울이면 같이 기울고, 얼굴 크기에 맞춰 선 굵기까지 같이 커진다.

const INK = "#4a3428";          // 공통 외곽선 (진한 갈색 — 검정보다 부드러움)
const LW = 0.07;                // 공통 선 굵기 (눈 사이 거리 대비)
const wig = (seed, t, amp) => Math.sin(t * 0.004 + seed) * amp + Math.sin(t * 0.011 + seed * 2) * amp * 0.4;

let ctx;

// ---------- 기본 도형 ----------
function ell(x, y, rx, ry, rot, fill, stroke = INK, lw = LW) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
// 광택: 왼쪽 위 흰 하이라이트
function gloss(x, y, r, a = 0.9) {
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, -0.6, 0, Math.PI * 2); ctx.fill();
}
// 몽글한 볼터치 + 빗금 세 줄
function blush(x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(255,120,150,.6)");
  g.addColorStop(0.6, "rgba(255,140,170,.35)");
  g.addColorStop(1, "rgba(255,160,185,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.68, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = r * 0.09; ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const hx = x + i * r * 0.3;
    ctx.moveTo(hx + r * 0.08, y - r * 0.18); ctx.lineTo(hx - r * 0.08, y + r * 0.18);
  }
  ctx.stroke();
}
// 반짝이 별 (네 꼭지 곡선 별)
function star(x, y, r, color = "#ffd84d") {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}
function twinkle(x, y, r, t, seed) {
  const k = 0.7 + 0.3 * Math.sin(t * 0.006 + seed);
  star(x, y, r * k);
  star(x + r * 1.3, y + r * 1.1, r * 0.45 * (1.7 - k), "#ffffff");
}
// 눈가 뽀샤시 광
function eyeGlow(F) {
  [F.el, F.er].forEach(e => {
    const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 0.55);
    g.addColorStop(0, "rgba(255,255,255,.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, 0.55, 0, Math.PI * 2); ctx.fill();
  });
}
// 둥근 삼각형 코 (꼭짓점이 아래)
function triNose(x, y, w, h, fill) {
  ctx.beginPath();
  ctx.moveTo(x - w, y - h * 0.45);
  ctx.quadraticCurveTo(x, y - h * 0.75, x + w, y - h * 0.45);
  ctx.quadraticCurveTo(x + w * 0.9, y + h * 0.05, x, y + h * 0.55);
  ctx.quadraticCurveTo(x - w * 0.9, y + h * 0.05, x - w, y - h * 0.45);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = LW * 0.8; ctx.stroke();
  gloss(x - w * 0.35, y - h * 0.25, w * 0.28);
}
// ω 입 (코 밑에서 양쪽으로 말려 올라감)
function omega(x, y, w, lw = LW * 0.85) {
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.beginPath();
  ctx.moveTo(x, y - w * 0.35); ctx.lineTo(x, y);
  ctx.moveTo(x - w, y - w * 0.15); ctx.quadraticCurveTo(x - w * 0.5, y + w * 0.55, x, y);
  ctx.quadraticCurveTo(x + w * 0.5, y + w * 0.55, x + w, y - w * 0.15);
  ctx.stroke();
}
function whiskers(F, spread, color = "rgba(74,52,40,.75)") {
  ctx.strokeStyle = color; ctx.lineWidth = LW * 0.55;
  [-1, 1].forEach(d => [-0.12, 0.05, 0.22].forEach((k, i) => {
    const x0 = d * 0.42, y0 = F.nose.y + 0.12 + k * 0.6;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(d * (0.42 + spread * 0.5), y0 + k * 0.25 - 0.05, d * (0.42 + spread), y0 + k * 0.9 + (i - 1) * 0.02);
    ctx.stroke();
  }));
}

// ---------- 캐릭터 ----------
// F: 얼굴 좌표 (눈 사이 중점이 원점, 눈 사이 거리 = 1, y는 아래로)
// head: 머리 꼭대기(머리카락 위쪽까지 감안)
function panda(F, t, s) {
  const hy = F.head.y, twitch = wig(s, t, 0.06);
  [-1, 1].forEach(d => {
    const x = F.head.x + d * 0.92, y = hy + 0.32;
    ctx.save(); ctx.translate(x, y); ctx.rotate(d * (0.2 + twitch));
    ell(0, 0, 0.36, 0.33, 0, "#2b2a30");
    gloss(-0.15, -0.14, 0.07, 0.45);
    ctx.restore();
  });
  // 눈 패치: 눈은 뚫어서 실제 눈이 보이게 (아래·바깥으로 처진 판다 모양)
  [[F.el, -1], [F.er, 1]].forEach(([e, d]) => {
    ctx.save(); ctx.translate(e.x + d * 0.04, e.y + 0.07); ctx.rotate(-d * 0.55);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.27, 0.36, 0, 0, Math.PI * 2);
    ctx.ellipse(0.0, -0.06, 0.15, 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(43,42,48,.72)"; ctx.fill("evenodd");
    ctx.restore();
  });
  triNose(F.nose.x, F.nose.y + 0.02, 0.17, 0.2, "#2b2a30");
  omega(F.nose.x, F.nose.y + 0.3, 0.13);
  blush(-0.72, F.nose.y - 0.05, 0.22);
  blush(0.72, F.nose.y - 0.05, 0.22);
  twinkle(F.head.x + 1.35, hy + 0.05, 0.13, t, s);
}

function rabbit(F, t, s) {
  const hy = F.head.y, sway = wig(s, t, 0.08);
  [[-1, -0.16], [1, 0.26]].forEach(([d, tilt]) => {
    ctx.save(); ctx.translate(F.head.x + d * 0.34, hy + 0.15); ctx.rotate(tilt + sway * d);
    ell(0, -0.72, 0.25, 0.78, 0, "#fffaf6");
    ell(0, -0.66, 0.12, 0.58, 0, "#ffc0cf", null);
    gloss(-0.11, -1.1, 0.05, 0.9);
    ctx.restore();
  });
  // 작은 리본 (귀 사이)
  ctx.save(); ctx.translate(F.head.x + 0.62, hy + 0.2); ctx.rotate(0.3);
  [-1, 1].forEach(d => {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(d * 0.32, -0.26, d * 0.3, 0.02); ctx.quadraticCurveTo(d * 0.32, 0.26, 0, 0);
    ctx.fillStyle = "#ff8fb1"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW * 0.7; ctx.stroke();
  });
  ell(0, 0, 0.07, 0.07, 0, "#ff8fb1", INK, LW * 0.7);
  ctx.restore();
  triNose(F.nose.x, F.nose.y + 0.02, 0.12, 0.13, "#ff9fb8");
  // 앞니 두 개 (윗입술에 매달림)
  const tx = F.mouth.x, ty = F.mouth.y - 0.02;
  ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = LW * 0.7;
  ctx.beginPath(); ctx.roundRect(tx - 0.12, ty, 0.24, 0.2, [0, 0, 0.06, 0.06]); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty + 0.2); ctx.stroke();
  ctx.fillStyle = "#ff9fb8";
  [-1, 1].forEach(d => [0, 0.11, 0.22].forEach((k, i) => {
    ctx.beginPath(); ctx.arc(d * (0.4 + (i % 2) * 0.06), F.nose.y + 0.08 + k, 0.03, 0, Math.PI * 2); ctx.fill();
  }));
  blush(-0.72, F.nose.y - 0.02, 0.22);
  blush(0.72, F.nose.y - 0.02, 0.22);
  twinkle(F.head.x - 1.2, hy + 0.2, 0.12, t, s);
}

function cat(F, t, s) {
  const hy = F.head.y, twitch = wig(s, t, 0.05);
  [-1, 1].forEach(d => {
    ctx.save(); ctx.translate(F.head.x + d * 0.78, hy + 0.42); ctx.rotate(d * (0.32 + twitch));
    const ear = (w, h, fill, stroke) => {
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w * 0.55, -h * 0.55, -w * 0.08, -h * 0.97);
      ctx.quadraticCurveTo(0, -h * 1.04, w * 0.08, -h * 0.97);
      ctx.quadraticCurveTo(w * 0.55, -h * 0.55, w, 0);
      ctx.quadraticCurveTo(0, h * 0.12, -w, 0);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke(); }
    };
    ear(0.36, 0.62, "#ffbe7a", true);
    ctx.translate(0, -0.06); ear(0.19, 0.42, "#ffc9d6", false);
    ctx.restore();
  });
  triNose(F.nose.x, F.nose.y + 0.02, 0.1, 0.11, "#ff8fab");
  omega(F.nose.x, F.nose.y + 0.24, 0.12);
  whiskers(F, 0.62);
  blush(-0.7, F.nose.y - 0.08, 0.2);
  blush(0.7, F.nose.y - 0.08, 0.2);
  twinkle(F.head.x + 1.3, hy + 0.1, 0.13, t, s);
}

function bear(F, t, s) {
  const hy = F.head.y, twitch = wig(s, t, 0.05);
  [-1, 1].forEach(d => {
    ctx.save(); ctx.translate(F.head.x + d * 0.9, hy + 0.32); ctx.rotate(d * (0.15 + twitch));
    ell(0, 0, 0.34, 0.32, 0, "#b07445");
    ell(0, 0.03, 0.18, 0.16, 0, "#f3cfa2", null);
    gloss(-0.13, -0.13, 0.07, 0.55);
    ctx.restore();
  });
  // 주둥이: 반투명이라 입술은 비침
  ell(F.nose.x, F.nose.y + 0.22, 0.4, 0.3, 0, "rgba(246,214,176,.55)", null);
  ell(F.nose.x, F.nose.y + 0.04, 0.19, 0.13, 0, "#5a3520", INK, LW * 0.8);
  gloss(F.nose.x - 0.07, F.nose.y - 0.01, 0.055);
  omega(F.nose.x, F.nose.y + 0.32, 0.12);
  blush(-0.72, F.nose.y - 0.06, 0.22);
  blush(0.72, F.nose.y - 0.06, 0.22);
  // 꿀 한 방울
  const hx = F.head.x - 1.45, hyy = hy + 0.25 + wig(s + 4, t, 0.03);
  ctx.beginPath(); ctx.moveTo(hx, hyy - 0.18);
  ctx.quadraticCurveTo(hx + 0.13, hyy, hx + 0.1, hyy + 0.06);
  ctx.arc(hx, hyy + 0.06, 0.1, 0, Math.PI);
  ctx.quadraticCurveTo(hx - 0.13, hyy, hx, hyy - 0.18);
  ctx.fillStyle = "#ffc93c"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW * 0.7; ctx.stroke();
  gloss(hx - 0.04, hyy + 0.02, 0.03);
}

function frog(F, t, s) {
  const hy = F.head.y, pop = 1 + Math.sin(t * 0.005 + s) * 0.04;
  const lookX = Math.sin(t * 0.0013 + s) * 0.07, lookY = Math.cos(t * 0.0017 + s) * 0.04;
  [-1, 1].forEach(d => {
    const x = F.head.x + d * 0.6, y = hy + 0.28;
    ell(x, y, 0.4 * pop, 0.36 * pop, 0, "#8fd16a");
    ell(x, y - 0.02, 0.26, 0.24, 0, "#fff", INK, LW * 0.6);
    ell(x + lookX, y + lookY, 0.13, 0.14, 0, "#2b2a30", null);
    gloss(x + lookX - 0.04, y + lookY - 0.05, 0.045, 1);
  });
  // 왕관
  ctx.save(); ctx.translate(F.head.x, hy + 0.02); ctx.rotate(wig(s, t, 0.05));
  ctx.beginPath();
  ctx.moveTo(-0.22, 0.08); ctx.lineTo(-0.26, -0.18); ctx.lineTo(-0.12, -0.06);
  ctx.lineTo(0, -0.24); ctx.lineTo(0.12, -0.06); ctx.lineTo(0.26, -0.18); ctx.lineTo(0.22, 0.08);
  ctx.closePath();
  ctx.fillStyle = "#ffd54a"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW * 0.7; ctx.stroke();
  ell(0, 0.0, 0.04, 0.04, 0, "#ff7fa0", null);
  ctx.restore();
  // 콧구멍 점 두 개
  ctx.fillStyle = INK;
  [-1, 1].forEach(d => { ctx.beginPath(); ctx.arc(F.nose.x + d * 0.08, F.nose.y + 0.04, 0.035, 0, Math.PI * 2); ctx.fill(); });
  blush(-0.72, F.nose.y - 0.04, 0.22);
  blush(0.72, F.nose.y - 0.04, 0.22);
  twinkle(F.head.x + 1.15, hy + 0.05, 0.12, t, s);
}

const MASKS = { panda, rabbit, cat, bear, frog };
export const CHARS = Object.keys(MASKS);

// f: 화면 좌표의 얼굴 점들 (leye, reye, nose, mouth, top, chin)
export function drawMask(c2d, f, c, t, seed) {
  ctx = c2d;
  const [A, B] = f.leye.x <= f.reye.x ? [f.leye, f.reye] : [f.reye, f.leye];
  const ox = (A.x + B.x) / 2, oy = (A.y + B.y) / 2;
  const ang = Math.atan2(B.y - A.y, B.x - A.x);
  // 고개를 옆으로 돌리면 눈 사이가 좁아지므로 얼굴 길이로도 크기를 잡는다
  const s = Math.max(Math.hypot(B.x - A.x, B.y - A.y), Math.hypot(f.chin.x - f.top.x, f.chin.y - f.top.y) / 2.7);
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const loc = (p) => {
    const dx = p.x - ox, dy = p.y - oy;
    return { x: (dx * cos - dy * sin) / s, y: (dx * sin + dy * cos) / s };
  };
  const F = { el: loc(A), er: loc(B), nose: loc(f.nose), mouth: loc(f.mouth), top: loc(f.top), chin: loc(f.chin) };
  F.head = { x: F.top.x, y: F.top.y - 0.55 }; // 이마 끝(10번) 위로 머리카락만큼
  ctx.save();
  ctx.translate(ox, oy); ctx.rotate(ang); ctx.scale(s, s);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  eyeGlow(F);
  (MASKS[c] || panda)(F, t, seed);
  ctx.restore();
}
