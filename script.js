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
const SPARK_POINTS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

const $ = (id) => document.getElementById(id);

const el = {
  connectionDot: $("connectionDot"),
  connectionStatus: $("connectionStatus"),
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
  historyBody: $("historyBody"),
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

function setConnection(connected, message) {
  el.connectionStatus.textContent = message;
  el.connectionDot.classList.toggle("connected", connected);
  el.connectionDot.classList.toggle("disconnected", !connected);
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

function renderChart() {
  const W = Math.max(300, Math.round(chartSvg.getBoundingClientRect().width) || 640);
  chartWidth = W;
  const H = W < 520 ? 240 : 290;
  const L = 40, R = 40, T = 26, B = 30;
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

  let grid = `<text class="chart-text-temp" x="${L - 8}" y="12" text-anchor="end">°C</text>` +
    `<text class="chart-text-hum" x="${W - R + 8}" y="12" text-anchor="start">%</text>`;
  for (let i = 0; i <= 4; i++) {
    const yy = T + plotH * (1 - i / 4);
    grid += `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    if (temps.length) grid += `<text class="chart-text-temp" x="${L - 8}" y="${yy + 4}" text-anchor="end">${tick(tLo + ((tHi - tLo) * i) / 4, tHi - tLo)}</text>`;
    if (hums.length) grid += `<text class="chart-text-hum" x="${W - R + 8}" y="${yy + 4}" text-anchor="start">${tick(hLo + ((hHi - hLo) * i) / 4, hHi - hLo)}</text>`;
  }

  const idx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const anchors = n === 1 ? ["middle"] : ["start", "middle", "end"];
  const xLabels = idx.map((ix, k) =>
    `<text class="chart-text" x="${x(ix)}" y="${H - 8}" text-anchor="${anchors[k]}">${escapeHtml(chartPoints[ix].t)}</text>`
  ).join("");

  const series = (key, y, cls) => {
    let d = "", last = -1;
    chartPoints.forEach((p, i) => {
      if (p[key] === null) return;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)} `;
      last = i;
    });
    if (last < 0) return "";
    return `<path class="chart-line line-${cls}" d="${d.trim()}"/>` +
      `<circle class="chart-dot dotfill-${cls}" cx="${x(last).toFixed(1)}" cy="${y(chartPoints[last][key]).toFixed(1)}" r="5"/>`;
  };

  chartSvg.innerHTML = grid + xLabels + series("hum", yH, "hum") + series("temp", yT, "temp");
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

/* ---------- Riwayat ---------- */

const ICON_OK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_WARN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f5b50a"/><path d="M12 7v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.4" fill="#fff"/></svg>`;

const ICON_DENY = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

function toneFor(sensor, status) {
  if (status === "Ditolak") return "tone-red";
  const s = String(sensor).toLowerCase();
  if (s === "pir") return "tone-amber";
  if (s === "kipas" || s === "led") return "tone-cyan";
  return "tone-green";
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    el.historyBody.innerHTML =
      `<tr><td colspan="4" class="empty-row">Belum ada riwayat aktivitas.</td></tr>`;
    return;
  }

  el.historyBody.innerHTML = history.slice(-30).reverse().map((item) => {
    const warn = item.status === "Aktif";
    const deny = item.status === "Ditolak";
    const icon = deny ? ICON_DENY : (warn ? ICON_WARN : ICON_OK);
    return `
      <tr class="${toneFor(item.sensor, item.status)}">
        <td>${escapeHtml(item.time)}</td>
        <td>${escapeHtml(item.sensor)}</td>
        <td>${escapeHtml(item.activity)}</td>
        <td><span class="status-tag">${icon}${escapeHtml(item.status)}</span></td>
      </tr>`;
  }).join("");
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
const FAN_MAX_SPEED = 900;   // derajat per detik (kecepatan penuh)
let fanAngle = 0;
let fanSpeed = 0;
let fanTarget = 0;
let fanLastTs = 0;
let fanRaf = null;

function fanLoop(ts) {
  const dt = Math.min(0.05, (ts - fanLastTs) / 1000 || 0);
  fanLastTs = ts;

  // naik cepat saat dinyalakan, melambat pelan saat dimatikan
  const easing = fanTarget > fanSpeed ? 3 : 1.2;
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
    el.temperature.innerHTML = Number.isFinite(t)
      ? `${t.toFixed(1)}<small>°C</small>` : `--.-<small>°C</small>`;
  }

  if (data.humidity !== undefined) {
    const h = Number(data.humidity);
    el.humidity.innerHTML = Number.isFinite(h)
      ? `${Math.round(h)}<small>%</small>` : `--<small>%</small>`;
  }

  if (data.rfidCount !== undefined) el.rfidCount.textContent = String(data.rfidCount);
  if (data.touchCount !== undefined) el.touchCount.textContent = String(data.touchCount);
  updateVisitors(data);

  if (data.fan !== undefined) {
    const on = toBool(data.fan);
    setIndicator(el.fanLamp, el.fanStatus, on, "AKTIF", "MATI");
    el.fanArt.classList.toggle("on", on);
    setFanSpinning(on);
  }

  if (data.led !== undefined) {
    const on = toBool(data.led);
    setIndicator(el.ledLamp, el.ledStatus, on, "HIDUP", "MATI");
  }

  if (data.motion !== undefined) {
    const detected = toBool(data.motion);
    el.motionStatus.textContent = detected ? "Ada Gerakan!" : "Tidak ada gerakan";
    el.motionStatus.classList.toggle("warn", detected);
    el.motionIndicator.classList.toggle("on", detected);
  }

  el.lastUpdated.textContent = `Diperbarui ${new Date().toLocaleTimeString("id-ID")}`;
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
      setConnection(true, "ESP32 Online");
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
    setConnection(false, "Gagal membaca Firebase");
  });

  setInterval(() => {
    if (lastChangeLocal && Date.now() - lastChangeLocal > OFFLINE_AFTER_MS) {
      setConnection(false, "ESP32 Offline");
    }
  }, 1000);
}

el.clearHistory.addEventListener("click", () => {
  localHistory.length = 0;
  el.historyBody.innerHTML = `
    <tr><td colspan="4" class="empty-row">
      Tampilan riwayat dikosongkan. Data di Firebase tidak dihapus.
    </td></tr>`;
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

/* ---------- Mode gelap / terang ---------- */

const themeToggle = $("themeToggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#0b1020" : "#f6f8fe");
  const next = theme === "dark" ? "terang" : "gelap";
  themeToggle.setAttribute("aria-label", `Ganti ke mode ${next}`);
  themeToggle.setAttribute("title", `Ganti ke mode ${next}`);
}

applyTheme(currentTheme());

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("theme", next); } catch (e) { }
});

/* ---------- Mulai ---------- */

setConnection(false, "Menghubungkan...");
renderChart();

signInAnonymously(auth)
  .then(startListening)
  .catch((error) => {
    console.error("Anonymous sign-in gagal:", error);
    setConnection(false, "Login Firebase gagal");
  });