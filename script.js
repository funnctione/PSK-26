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
  tempLine: $("tempLine"),
  tempArea: $("tempArea"),
  humLine: $("humLine"),
  humArea: $("humArea"),
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
const tempSeries = [];
const humSeries = [];

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

/* ---------- Grafik mini (sparkline) ---------- */

function drawSpark(lineEl, areaEl, series) {
  const W = 140, H = 44, PAD = 6;
  if (series.length < 2) {
    const flat = `M0 ${H / 2} L${W} ${H / 2}`;
    lineEl.setAttribute("d", flat);
    areaEl.setAttribute("d", `${flat} L${W} ${H} L0 ${H} Z`);
    return;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const step = W / (series.length - 1);

  const points = series.map((v, i) => {
    const x = i * step;
    const y = max === min ? H / 2 : H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y];
  });

  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  lineEl.setAttribute("d", line);
  areaEl.setAttribute("d", `${line} L${W} ${H} L0 ${H} Z`);
}

function pushSeries(series, value, lineEl, areaEl) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  series.push(n);
  if (series.length > SPARK_POINTS) series.shift();
  drawSpark(lineEl, areaEl, series);
}

/* ---------- Riwayat ---------- */

const ICON_OK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_WARN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f5b50a"/><path d="M12 7v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.4" fill="#fff"/></svg>`;

function toneFor(sensor) {
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
    return `
      <tr class="${toneFor(item.sensor)}">
        <td>${escapeHtml(item.time)}</td>
        <td>${escapeHtml(item.sensor)}</td>
        <td>${escapeHtml(item.activity)}</td>
        <td><span class="status-tag">${warn ? ICON_WARN : ICON_OK}${escapeHtml(item.status)}</span></td>
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
  if (changed("rfidCount", data)) {
    const card = data.lastRfid ? `Kartu terbaca: ${data.lastRfid}` : "Kartu terbaca";
    addHistory("RFID", card);
  }
  if (changed("touchCount", data)) addHistory("Touch", "Akses keluar");
  previous = { ...data };
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
    pushSeries(tempSeries, t, el.tempLine, el.tempArea);
  }

  if (data.humidity !== undefined) {
    const h = Number(data.humidity);
    el.humidity.innerHTML = Number.isFinite(h)
      ? `${Math.round(h)}<small>%</small>` : `--<small>%</small>`;
    pushSeries(humSeries, h, el.humLine, el.humArea);
  }

  if (data.rfidCount !== undefined) el.rfidCount.textContent = String(data.rfidCount);
  if (data.touchCount !== undefined) el.touchCount.textContent = String(data.touchCount);
  updateVisitors(data);

  if (data.fan !== undefined) {
    const on = toBool(data.fan);
    setIndicator(el.fanLamp, el.fanStatus, on, "AKTIF", "MATI");
    el.fanArt.classList.toggle("on", on);
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
  try { localStorage.setItem("theme", next); } catch (e) {}
});

/* ---------- Mulai ---------- */

drawSpark(el.tempLine, el.tempArea, tempSeries);
drawSpark(el.humLine, el.humArea, humSeries);
setConnection(false, "Menghubungkan...");

signInAnonymously(auth)
  .then(startListening)
  .catch((error) => {
    console.error("Anonymous sign-in gagal:", error);
    setConnection(false, "Login Firebase gagal");
  });