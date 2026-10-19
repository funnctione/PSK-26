import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

const SENSORS_PATH = "smartSportCenter/sensors";
const CONTROL_PATH = "smartSportCenter/control";
const OFFLINE_AFTER_MS = 10000;

const elements = {
  connectionDot: document.getElementById("connectionDot"),
  connectionStatus: document.getElementById("connectionStatus"),
  temperature: document.getElementById("temperature"),
  humidity: document.getElementById("humidity"),
  rfidCount: document.getElementById("rfidCount"),
  touchCount: document.getElementById("touchCount"),
  fanToggle: document.getElementById("fanToggle"),
  fanStatus: document.getElementById("fanStatus"),
  ledToggle: document.getElementById("ledToggle"),
  ledStatus: document.getElementById("ledStatus"),
  motionStatus: document.getElementById("motionStatus"),
  motionIndicator: document.getElementById("motionIndicator"),
  chartTempValue: document.getElementById("chartTempValue"),
  chartHumidityValue: document.getElementById("chartHumidityValue"),
  historyBody: document.getElementById("historyBody"),
  lastUpdated: document.getElementById("lastUpdated"),
  clearHistory: document.getElementById("clearHistory"),
  servoToggle: document.getElementById("servoToggle"),
  servoStatus: document.getElementById("servoStatus"),
  lastRfid: document.getElementById("lastRfid")
};

let isConnected = false;
let lastUpdatedAtValue = null;
let lastChangeLocal = 0;
let previous = {};
const localHistory = [];

function setConnection(connected, message) {
  isConnected = connected;
  elements.connectionStatus.textContent = message;
  elements.connectionDot.classList.toggle("connected", connected);
  elements.connectionDot.classList.toggle("disconnected", !connected);

  // Kontrol hanya aktif jika ESP32 online.
  elements.fanToggle.disabled = !connected;
  elements.ledToggle.disabled = !connected;
  if (elements.servoToggle) elements.servoToggle.disabled = !connected;
}

function setText(element, text) {
  if (element) element.textContent = text;
}

function formatTemperature(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}°C` : "--.-°C";
}

function formatHumidity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}%` : "--%";
}

function setSwitchState(input, value) {
  if (typeof value === "boolean") {
    input.checked = value;
  } else if (value === 1 || value === "ON" || value === "on") {
    input.checked = true;
  } else if (value === 0 || value === "OFF" || value === "off") {
    input.checked = false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[character];
  });
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    elements.historyBody.innerHTML = `
      <tr><td colspan="4" class="empty-row">Belum ada riwayat aktivitas.</td></tr>
    `;
    return;
  }

  const rows = history.slice(-30).reverse();

  elements.historyBody.innerHTML = rows.map((item) => {
    const time = escapeHtml(item.time ?? item.timestamp ?? "--");
    const sensor = escapeHtml(item.sensor ?? item.type ?? "Sensor");
    const activity = escapeHtml(item.activity ?? item.message ?? "--");
    const status = escapeHtml(item.status ?? "Berhasil");

    return `
      <tr>
        <td>${time}</td>
        <td>${sensor}</td>
        <td>${activity}</td>
        <td><span class="status-tag">${status}</span></td>
      </tr>
    `;
  }).join("");
}

// Riwayat dibuat di browser dari perubahan data (ESP32 belum kirim history).
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

function trackChanges(data) {
  if (previous.fan !== undefined && data.fan !== undefined && data.fan !== previous.fan) {
    addHistory("Kipas", data.fan ? "Dinyalakan" : "Dimatikan");
  }
  if (previous.led !== undefined && data.led !== undefined && data.led !== previous.led) {
    addHistory("LED", data.led ? "Dinyalakan" : "Dimatikan");
  }
  if (previous.motion !== undefined && data.motion !== undefined && data.motion !== previous.motion) {
    addHistory("PIR", data.motion ? "Gerakan terdeteksi" : "Gerakan berhenti");
  }
  if (previous.rfidCount !== undefined && data.rfidCount !== undefined && data.rfidCount !== previous.rfidCount) {
    addHistory("RFID", "Kartu terbaca");
  }
  if (previous.touchCount !== undefined && data.touchCount !== undefined && data.touchCount !== previous.touchCount) {
    addHistory("Touch", "Sentuhan terdeteksi");
  }
  if (previous.servo !== undefined && data.servo !== undefined && data.servo !== previous.servo) {
    addHistory("Servo", data.servo ? "Dibuka" : "Ditutup");
  }
  previous = { ...data };
}

function updateDashboard(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Format data status tidak valid.");
  }

  if (data.temperature !== undefined) {
    const t = Number(data.temperature);
    elements.temperature.innerHTML = Number.isFinite(t)
      ? `${t.toFixed(1)}<small>°C</small>`
      : `--.-<small>°C</small>`;
    setText(elements.chartTempValue, formatTemperature(data.temperature));
  }

  if (data.humidity !== undefined) {
    const h = Number(data.humidity);
    elements.humidity.innerHTML = Number.isFinite(h)
      ? `${Math.round(h)}<small>%</small>`
      : `--<small>%</small>`;
    setText(elements.chartHumidityValue, formatHumidity(data.humidity));
  }

  if (data.rfidCount !== undefined) {
    elements.rfidCount.textContent = String(data.rfidCount);
  }

  if (data.lastRfid !== undefined) {
    setText(elements.lastRfid, `Kartu terakhir: ${data.lastRfid}`);
  }

  if (data.touchCount !== undefined) {
    elements.touchCount.textContent = String(data.touchCount);
  }

  if (data.fan !== undefined) {
    setSwitchState(elements.fanToggle, data.fan);
  }
  elements.fanStatus.textContent = elements.fanToggle.checked ? "MENYALA" : "MATI";

  if (data.led !== undefined) {
    setSwitchState(elements.ledToggle, data.led);
  }
  elements.ledStatus.textContent = elements.ledToggle.checked ? "MENYALA" : "MATI";

  if (elements.servoToggle) {
    if (data.servo !== undefined) {
      setSwitchState(elements.servoToggle, data.servo);
    }
    setText(elements.servoStatus, elements.servoToggle.checked ? "TERBUKA" : "TERTUTUP");
  }

  if (data.motion !== undefined) {
    const motionDetected =
      data.motion === true ||
      data.motion === 1 ||
      data.motion === "1" ||
      data.motion === "detected";

    elements.motionStatus.textContent = motionDetected
      ? "Gerakan terdeteksi"
      : "Tidak ada gerakan";

    elements.motionIndicator.classList.toggle("active", motionDetected);
  }

  setText(elements.lastUpdated,
    `Diperbarui ${new Date().toLocaleTimeString("id-ID")}`);
}

// Pengganti fetchStatus(): dengarkan Firebase secara realtime.
function startListening() {
  onValue(ref(db, SENSORS_PATH), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // updatedAt berubah setiap ESP32 mengirim data -> ESP32 hidup.
    if (data.updatedAt !== lastUpdatedAtValue) {
      lastUpdatedAtValue = data.updatedAt;
      lastChangeLocal = Date.now();
      setConnection(true, "ESP32 online");
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
      setConnection(false, "ESP32 offline");
    }
  }, 1000);
}

// Pengganti sendControl(): tulis perintah ke Firebase.
async function sendControl(device, enabled) {
  if (!isConnected) {
    alert("ESP32 belum online.");
    return false;
  }

  try {
    await update(ref(db, CONTROL_PATH), { [device]: enabled });
    return true;
  } catch (error) {
    console.error(`Gagal mengubah ${device}:`, error);
    alert("Gagal mengirim perintah ke Firebase.");
    return false;
  }
}

elements.fanToggle.addEventListener("change", async (event) => {
  const requestedState = event.target.checked;
  const success = await sendControl("fan", requestedState);

  if (!success) {
    event.target.checked = !requestedState;
    elements.fanStatus.textContent = event.target.checked ? "MENYALA" : "MATI";
  }
});

elements.ledToggle.addEventListener("change", async (event) => {
  const requestedState = event.target.checked;
  const success = await sendControl("led", requestedState);

  if (!success) {
    event.target.checked = !requestedState;
    elements.ledStatus.textContent = event.target.checked ? "MENYALA" : "MATI";
  }
});

if (elements.servoToggle) {
  elements.servoToggle.addEventListener("change", async (event) => {
    const requestedState = event.target.checked;
    const success = await sendControl("servo", requestedState);

    if (!success) {
      event.target.checked = !requestedState;
      setText(elements.servoStatus, event.target.checked ? "TERBUKA" : "TERTUTUP");
    }
  });
}

elements.clearHistory.addEventListener("click", () => {
  localHistory.length = 0;
  elements.historyBody.innerHTML = `
    <tr><td colspan="4" class="empty-row">
      Tampilan riwayat dikosongkan. Data di Firebase tidak dihapus.
    </td></tr>
  `;
});

function updateDateTime() {
  const now = new Date();

  document.getElementById("currentDate").textContent =
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(now);

  document.getElementById("currentTime").textContent =
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);
}

updateDateTime();
setInterval(updateDateTime, 1000);

// Mulai
setConnection(false, "Menghubungkan ke Firebase...");
signInAnonymously(auth)
  .then(startListening)
  .catch((error) => {
    console.error("Anonymous sign-in gagal:", error);
    setConnection(false, "Login Firebase gagal");
  });