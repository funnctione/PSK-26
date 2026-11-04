import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtbTmLhfZP1rwSxYzD3k7CiUMVbbjANxw",
  authDomain: "proyek-sistem-a60d6.firebaseapp.com",
  databaseURL: "https://proyek-sistem-a60d6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "proyek-sistem-a60d6",
  storageBucket: "proyek-sistem-a60d6.firebasestorage.app",
  messagingSenderId: "369239306710",
  appId: "1:369239306710:web:88b9f9bca5112df2c0b477"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Dashboard ini hanya MEMBACA data (tidak ada kontrol dari web).
const SENSORS_PATH = "smartSportCenter/sensors";
const OFFLINE_AFTER_MS = 10000;
const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

const $ = (id) => document.getElementById(id);

const el = {
  esp: $("esp"),
  espText: $("esp-t"),
  espState: $("espState"),
  temperature: $("temperature"),
  humidity: $("humidity"),
  rfidCount: $("rfidCount"),
  touchCount: $("touchCount"),
  activeCount: $("activeCount"),
  ringValue: $("ringValue"),
  fanStatus: $("fanStatus"),
  fanLamp: $("fanLamp"),
  fanArt: $("fanArt"),
  ledStatus: $("ledStatus"),
  ledLamp: $("ledLamp"),
  motionStatus: $("motionStatus"),
  motionIndicator: $("motionIndicator"),
  log: $("log"),
  lastUpdated: $("lastUpdated"),
  clearHistory: $("clearHistory")
};

let lastUpdatedAtValue = null;
let lastChangeLocal = 0;
let previous = {};
const localHistory = [];

/* ---------- Utilitas ---------- */

function toBool(value) {
  return value === true || value === 1 || value === "1" ||
    value === "ON" || value === "on" || value === "true" || value === "detected";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

// state: "ok" | "off" | "wait"
function setConnection(state, message) {
  el.esp.dataset.s = state;
  el.espText.textContent = message;
  el.espState.textContent = state === "ok" ? "Online" : state === "off" ? "Offline" : "Menunggu data";
  el.espState.className = state === "ok" ? "" : state;
  document.body.classList.toggle("offline", state === "off");
}

/* ---------- Grafik DHT22 (suhu + kelembapan) ---------- */

const CHART_POINTS = 60;
const chartPoints = [];
let lastTemp = null;
let lastHum = null;
let chartWidth = 0;
const chartSvg = $("dhtChart");

function axisRange(vals, minStep, pad, round, low, high) {
  const min = Math.min(...vals) - pad;
  const max = Math.max(...vals) + pad;
  let lo = Math.floor(min / round) * round;
  const step = Math.max(minStep, Math.ceil((max - lo) / 4 / round) * round);
  let hi = lo + step * 4;
  if (high !== null && hi > high) { hi = high; lo = hi - step * 4; }
  if (low !== null && lo < low) { lo = low; hi = Math.min(high ?? Infinity, lo + step * 4); }
  return [lo, hi];
}

function tick(v, range) {
  return v.toFixed(Number.isInteger(range / 4) ? 0 : 1);
}

function setStats(prefix, vals, digits, unit) {
  const ids = ["Now", "Min", "Max", "Avg"].map((k) => $(prefix + k));
  if (!vals.length) { ids.forEach((e) => { e.textContent = "--"; }); return; }
  const f = (v) => `${v.toFixed(digits)}${unit}`;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  ids[0].textContent = f(vals[vals.length - 1]);
  ids[1].textContent = f(Math.min(...vals));
  ids[2].textContent = f(Math.max(...vals));
  ids[3].textContent = f(avg);
}

// Kurva halus (Catmull-Rom -> Bezier), y dibatasi agar tidak keluar area plot.
function smoothPath(pts, yMin, yMax) {
  const cl = (y) => Math.min(yMax, Math.max(yMin, y));
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const t = 0.35 / 3;
    const c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = cl(p1[1] + (p2[1] - p0[1]) * t);
    const c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = cl(p2[1] - (p3[1] - p1[1]) * t);
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function renderChart() {
  const W = Math.max(300, Math.round(chartSvg.getBoundingClientRect().width) || 640);
  chartWidth = W;
  const H = W < 520 ? 176 : 168;
  const L = 38, R = 38, T = 18, B = 26;
  chartSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const n = chartPoints.length;
  const temps = chartPoints.map((p) => p.temp).filter((v) => v !== null);
  const hums = chartPoints.map((p) => p.hum).filter((v) => v !== null);
  setStats("temp", temps, 1, "°C");
  setStats("hum", hums, 0, "%");

  if (!n) {
    chartSvg.innerHTML = `<text class="chart-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Menunggu data dari ESP32...</text>`;
    return;
  }

  const plotW = W - L - R, plotH = H - T - B;
  const [tLo, tHi] = temps.length ? axisRange(temps, 1, 0.5, 1, null, null) : [0, 4];
  const [hLo, hHi] = hums.length ? axisRange(hums, 5, 2, 5, 0, 100) : [0, 20];
  const x = (i) => (n === 1 ? L + plotW / 2 : L + (i * plotW) / (n - 1));
  const yT = (v) => T + (1 - (v - tLo) / (tHi - tLo)) * plotH;
  const yH = (v) => T + (1 - (v - hLo) / (hHi - hLo)) * plotH;

  let grid = `<text class="unit-1" x="${L - 8}" y="9" text-anchor="end">°C</text>` +
    `<text class="unit-2" x="${W - R + 8}" y="9" text-anchor="start">%</text>`;
  for (let i = 0; i <= 4; i++) {
    const yy = T + plotH * (1 - i / 4);
    grid += `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    if (temps.length) grid += `<text class="chart-text" x="${L - 8}" y="${yy + 3.5}" text-anchor="end">${tick(tLo + ((tHi - tLo) * i) / 4, tHi - tLo)}</text>`;
    if (hums.length) grid += `<text class="chart-text" x="${W - R + 8}" y="${yy + 3.5}" text-anchor="start">${tick(hLo + ((hHi - hLo) * i) / 4, hHi - hLo)}</text>`;
  }

  // label waktu sumbu X (3 label di layar kecil, 5 di layar lebar)
  const labelCount = n === 1 ? 1 : (W < 520 ? 3 : 5);
  const idx = labelCount === 1 ? [0]
    : Array.from({ length: Math.min(labelCount, n) }, (_, k) => Math.round((k * (n - 1)) / (Math.min(labelCount, n) - 1)));
  const xLabels = [...new Set(idx)].map((ix, k, arr) => {
    const anchor = arr.length === 1 ? "middle" : k === 0 ? "start" : k === arr.length - 1 ? "end" : "middle";
    return `<text class="chart-text" x="${x(ix)}" y="${H - 7}" text-anchor="${anchor}">${escapeHtml(chartPoints[ix].t)}</text>`;
  }).join("");

  const baseY = T + plotH;
  const series = (key, y, cls, withArea) => {
    const pts = [];
    chartPoints.forEach((p, i) => { if (p[key] !== null) pts.push([x(i), y(p[key])]); });
    if (!pts.length) return "";
    let out = "";
    if (pts.length > 1) {
      const d = smoothPath(pts, T, baseY);
      if (withArea) out += `<path class="area-${cls}" d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${baseY}L${pts[0][0].toFixed(1)} ${baseY}Z"/>`;
      out += `<path class="chart-line line-${cls}" d="${d}"/>`;
    }
    const showAll = pts.length <= 30;
    pts.forEach((p, i) => {
      if (showAll || i === pts.length - 1) out += `<circle class="pt-${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"/>`;
    });
    return out;
  };

  chartSvg.innerHTML = grid + xLabels + series("temp", yT, "1", true) + series("hum", yH, "2", false);
}

// Satu titik grafik per kiriman data ESP32.
function pushChartPoint(data) {
  const t = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  if (data.temperature != null && Number.isFinite(Number(data.temperature))) lastTemp = Number(data.temperature);
  if (data.humidity != null && Number.isFinite(Number(data.humidity))) lastHum = Number(data.humidity);
  if (lastTemp === null && lastHum === null) return;
  chartPoints.push({ t, temp: lastTemp, hum: lastHum });
  if (chartPoints.length > CHART_POINTS) chartPoints.shift();
  renderChart();
}

// Gambar ulang saat lebar layar berubah (HP, tablet, rotasi).
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    const w = Math.round(chartSvg.getBoundingClientRect().width);
    if (w && Math.abs(w - chartWidth) > 1) renderChart();
  }).observe(chartSvg.parentElement);
}

/* ---------- Riwayat (gaya log) ---------- */

// Berhasil -> INFO (biru), Aktif -> WARN (kuning), Ditolak -> ALERT (merah)
function levelFor(status) {
  if (status === "Ditolak") return "ALERT";
  if (status === "Aktif") return "WARN";
  return "INFO";
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    el.log.innerHTML = `<li class="kosong">Belum ada riwayat aktivitas.</li>`;
    return;
  }

  el.log.innerHTML = history.slice(-30).reverse().map((item) =>
    `<li><time>[${escapeHtml(item.time)}]</time><b class="lv ${levelFor(item.status)}">[${escapeHtml(item.sensor)}]</b><span>${escapeHtml(item.activity)}</span></li>`
  ).join("");
}

// Riwayat dibuat di browser dari perubahan data (ESP32 belum mengirim history).
function addHistory(sensor, activity, status = "Berhasil") {
  localHistory.push({
    time: new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }),
    sensor,
    activity,
    status
  });
  if (localHistory.length > 30) localHistory.shift();
  renderHistory(localHistory);
}

function changed(key, data) {
  return previous[key] !== undefined && data[key] !== undefined && data[key] !== previous[key];
}

function trackChanges(data) {
  if (changed("fan", data)) addHistory("Kipas", toBool(data.fan) ? "Kipas dinyalakan" : "Kipas dimatikan");
  if (changed("led", data)) addHistory("LED", toBool(data.led) ? "Lampu dinyalakan" : "Lampu dimatikan");
  if (changed("motion", data)) {
    if (toBool(data.motion)) addHistory("PIR", "Gerakan terdeteksi", "Aktif");
    else addHistory("PIR", "Gerakan berhenti");
  }
  // Kartu terdaftar (UID 1 atau 2) -> akses masuk diizinkan
  if (changed("rfidCount", data)) {
    const uid = data.lastRfid ? ` (${data.lastRfid})` : "";
    const id = data.lastRfidId ? `ID ${data.lastRfidId}` : "terdaftar";
    addHistory("RFID", `Kartu ${id}${uid} - akses masuk diizinkan`);
  }
  // Kartu tidak terdaftar -> akses ditolak
  if (changed("deniedCount", data)) {
    const uid = data.lastRfid ? `: ${data.lastRfid}` : "";
    addHistory("RFID", `UID tidak terdaftar${uid} - akses ditolak`, "Ditolak");
  }
  if (changed("touchCount", data)) addHistory("Touch", "Akses keluar");
  previous = { ...data };
}

/* ---------- Putaran kipas (mengikuti kipas fisik) ---------- */

const fanBlades = el.fanArt.querySelector(".fan-blades");
const FAN_MAX_SPEED = 1200;   // derajat per detik (kecepatan penuh; jangan di atas 3000)
const FAN_SPIN_UP = 2;        // makin besar = makin cepat mencapai kecepatan penuh
const FAN_SPIN_DOWN = 1.2;    // makin kecil = makin lama berhenti
let fanAngle = 0;
let fanSpeed = 0;
let fanTarget = 0;
let fanLastTs = 0;
let fanRaf = null;

function fanLoop(ts) {
  const dt = Math.min(0.05, (ts - fanLastTs) / 1000 || 0);
  fanLastTs = ts;

  // naik cepat saat dinyalakan, melambat pelan saat dimatikan
  const easing = fanTarget > fanSpeed ? FAN_SPIN_UP : FAN_SPIN_DOWN;
  fanSpeed += (fanTarget - fanSpeed) * Math.min(1, easing * dt);
  if (fanTarget === 0 && fanSpeed < 2) fanSpeed = 0;

  fanAngle = (fanAngle + fanSpeed * dt) % 360;
  fanBlades.setAttribute("transform", `rotate(${fanAngle.toFixed(1)} 50 50)`);

  fanRaf = (fanSpeed > 0 || fanTarget > 0) ? requestAnimationFrame(fanLoop) : null;
}

function setFanSpinning(on) {
  fanTarget = on ? FAN_MAX_SPEED : 0;
  if (!fanRaf) {
    fanLastTs = performance.now();
    fanRaf = requestAnimationFrame(fanLoop);
  }
}

/* ---------- Pembaruan tampilan ---------- */

function setIndicator(lamp, statusEl, on, textOn, textOff) {
  lamp.classList.toggle("on", on);
  statusEl.textContent = on ? textOn : textOff;
  statusEl.classList.toggle("on", on);
}

function updateVisitors(data) {
  const entered = Number(data.rfidCount);
  const exited = Number(data.touchCount);
  if (!Number.isFinite(entered) || !Number.isFinite(exited)) return;

  const active = Math.max(0, entered - exited);
  el.activeCount.textContent = String(active);

  const ratio = entered > 0 ? Math.min(1, active / entered) : 0;
  el.ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ratio));
}

function updateDashboard(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Format data status tidak valid.");
  }

  if (data.temperature !== undefined) {
    const t = Number(data.temperature);
    el.temperature.textContent = Number.isFinite(t) ? t.toFixed(1) : "--.-";
  }

  if (data.humidity !== undefined) {
    const h = Number(data.humidity);
    el.humidity.textContent = Number.isFinite(h) ? String(Math.round(h)) : "--";
  }

  if (data.rfidCount !== undefined) el.rfidCount.textContent = String(data.rfidCount);
  if (data.touchCount !== undefined) el.touchCount.textContent = String(data.touchCount);
  updateVisitors(data);

  if (data.fan !== undefined) {
    const on = toBool(data.fan);
    setIndicator(el.fanLamp, el.fanStatus, on, "Berputar", "Berhenti");
    el.fanArt.classList.toggle("on", on);
    setFanSpinning(on);
  }

  if (data.led !== undefined) {
    const on = toBool(data.led);
    setIndicator(el.ledLamp, el.ledStatus, on, "Menyala", "Mati");
  }

  if (data.motion !== undefined) {
    const detected = toBool(data.motion);
    el.motionStatus.textContent = detected ? "Ada gerakan!" : "Tidak ada gerakan";
    el.motionStatus.classList.toggle("warn", detected);
    el.motionIndicator.classList.toggle("on", detected);
  }

  el.lastUpdated.textContent = new Date().toLocaleTimeString("id-ID");
}

/* ---------- Firebase ---------- */

function startListening() {
  onValue(ref(db, SENSORS_PATH), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // updatedAt berubah setiap ESP32 mengirim data -> ESP32 hidup.
    if (data.updatedAt !== lastUpdatedAtValue) {
      lastUpdatedAtValue = data.updatedAt;
      lastChangeLocal = Date.now();
      setConnection("ok", "ESP32 Online");
      pushChartPoint(data);
    }

    try {
      updateDashboard(data);
      trackChanges(data);
    } catch (error) {
      console.error(error);
    }
  }, (error) => {
    console.error("Gagal membaca Firebase:", error);
    setConnection("off", "Gagal membaca Firebase");
  });

  setInterval(() => {
    if (lastChangeLocal && Date.now() - lastChangeLocal > OFFLINE_AFTER_MS) {
      setConnection("off", "ESP32 Offline");
    }
  }, 1000);
}

el.clearHistory.addEventListener("click", () => {
  localHistory.length = 0;
  el.log.innerHTML = `<li class="kosong">Tampilan riwayat dikosongkan. Data di Firebase tidak dihapus.</li>`;
});

/* ---------- Tanggal & jam ---------- */

function updateDateTime() {
  const now = new Date();
  $("currentDate").textContent = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  }).format(now);

  $("currentTime").textContent = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(now);
}

updateDateTime();
setInterval(updateDateTime, 1000);

/* ---------- Tema gelap / terang & navigasi ---------- */

const temaBtn = $("tema");
const themeMeta = document.querySelector('meta[name="theme-color"]');

function setTema(t) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem("tema", t); } catch (e) { }
  temaBtn.innerHTML = `<svg class="ic"><use href="#${t === "gelap" ? "i-sun" : "i-moon"}"/></svg>`;
  const next = t === "gelap" ? "terang" : "gelap";
  temaBtn.setAttribute("aria-label", `Ganti ke mode ${next}`);
  temaBtn.setAttribute("title", `Ganti ke mode ${next}`);
  if (themeMeta) themeMeta.setAttribute("content", t === "gelap" ? "#0D1218" : "#E8F1F7");
}

temaBtn.onclick = () => setTema(document.documentElement.dataset.tema === "gelap" ? "terang" : "gelap");
setTema(document.documentElement.dataset.tema === "terang" ? "terang" : "gelap");

document.querySelectorAll(".side nav a").forEach((a) => a.addEventListener("click", () => {
  document.querySelectorAll(".side nav a").forEach((x) => x.classList.remove("act"));
  a.classList.add("act");
}));

/* ---------- Mulai ---------- */

setConnection("wait", "Menghubungkan...");
renderChart();

signInAnonymously(auth)
  .then(startListening)
  .catch((error) => {
    console.error("Anonymous sign-in gagal:", error);
    setConnection("off", "Login Firebase gagal");
  });