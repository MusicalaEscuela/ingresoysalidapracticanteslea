// ====== Config ======
const GAS_URL = "https://script.google.com/macros/s/AKfycbwheAS_RBS-o_axbH3fQG4bf4zghRb0xUVZa76pvycWgne3T48BS1e-iGKcDFpO2nsQxA/exec"; // /exec de tu Web App
const PRACTICANTES = [
  "Laura Sánchez",
  "Juliana Rodríguez",
  "Laura Díaz",
  "Dannia Carrero",
  "Evelyn Montes"
];
const LS_KEY = "lea.qr.v1"; // { name, cameraId }

// ====== Estado global ======
let html5QrCode = null;
let currentCameraId = null;
let lastScan = { text: null, time: 0 }; // antirrebote cliente (5s)

// ====== Helpers ======
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $reader = $("#reader");
const $cameraSelect = $("#cameraSelect");
const $practicante = $("#practicanteSelect");
const $result = $("#result");
const $btnStart = $("#btnStart");
const $btnStop = $("#btnStop");

const loadState = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
};
const saveState = (data) => localStorage.setItem(LS_KEY, JSON.stringify(data));

function todayKey(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function fmtTime(d = new Date()){
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}

// ====== UI Setup ======
function populatePracticantes(){
  $practicante.innerHTML = "";
  PRACTICANTES.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    $practicante.appendChild(opt);
  });
}

async function loadCameras() {
  const devices = await Html5Qrcode.getCameras();
  $cameraSelect.innerHTML = "";
  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.label || `Cámara ${i+1}`;
    $cameraSelect.appendChild(opt);
  });
  if (devices[0] && !currentCameraId) currentCameraId = devices[0].id;
  if (currentCameraId) $cameraSelect.value = currentCameraId;
}

$cameraSelect.addEventListener("change", (e) => {
  currentCameraId = e.target.value;
  const st = loadState();
  st.cameraId = currentCameraId;
  saveState(st);
});

$practicante.addEventListener("change", () => {
  const st = loadState();
  st.name = $practicante.value;
  saveState(st);
});

// ====== Escaneo ======
async function start() {
  try {
    // Pedimos permiso explícito antes de iniciar para evitar fallos silenciosos
    await navigator.mediaDevices.getUserMedia({ video: true });

    if (!currentCameraId) await loadCameras();
    if (html5QrCode) await html5QrCode.stop().catch(()=>{});
    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { deviceId: { exact: currentCameraId } },
      { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.7, height: Math.min(vw, vh) * 0.7 }) },
      onScanSuccess,
      () => {} // onScanFailure silencioso
    );

    $btnStart.disabled = true;
    $btnStop.disabled = false;
    $result.textContent = "Cámara lista. Acerca el código QR.";
  } catch (err) {
    console.error(err);
    $result.textContent = "⚠️ Error al acceder a la cámara. Revisa permisos o usa HTTPS.";
  }
}

async function stop() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      await html5QrCode.clear();
    } catch(e){ /* no-op */ }
    html5QrCode = null;
  }
  $btnStart.disabled = false;
  $btnStop.disabled = true;
  $result.textContent = "Cámara detenida.";
}

$btnStart.addEventListener("click", start);
$btnStop.addEventListener("click", stop);

// Detección tipo desde texto QR
function detectTypeFromText(txt="") {
  const t = String(txt).toUpperCase();
  if (t.includes("SALIDA")) return "salida";
  if (t.includes("INGRESO") || t.includes("LLEGADA")) return "ingreso";
  return ""; // indeterminado -> el servidor decide
}

async function onScanSuccess(decodedText) {
  // Antirrebote en cliente: ignora el mismo código por 5s
  const nowMs = Date.now();
  if (decodedText === lastScan.text && nowMs - lastScan.time < 5000) return;
  lastScan = { text: decodedText, time: nowMs };

  if (navigator.vibrate) navigator.vibrate(40);

  const name = $practicante.value || PRACTICANTES[0];
  const now = new Date();
  const dateISO = todayKey(now);
  const timeHHMM = fmtTime(now);

  // Detectar tipo según QR (ADM-INGRESO / ADM-SALIDA)
  const tipoDetectado = detectTypeFromText(decodedText);

  // Mensaje optimista
  $result.textContent = `Leyó: “${decodedText}” — ${dateISO} ${timeHHMM} — Enviando…`;

  try{
    // Enviar como text/plain para evitar preflight CORS
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        mode: "registro",
        payload: {
          date: dateISO,             // YYYY-MM-DD
          name,                      // practicante
          stamp: now.toISOString(),  // sello exacto
          raw: decodedText,          // texto del QR
          type: tipoDetectado        // "ingreso"/"salida" (opcional; server decide si viene vacío)
        }
      })
    });

    // Leemos SIEMPRE el cuerpo para poder mostrar el motivo real de error
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${rawText.slice(0, 300)}`);
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error("Respuesta no-JSON del servidor: " + rawText.slice(0, 300)); }

    if(!data.ok){
      throw new Error(data.error || "Error desconocido del servidor");
    }

    // Interpretar respuesta del servidor
    const serverType = data.type; // ingreso | salida | duplicado_ingreso | duplicado_salida | cooldown
    let msg = "";
    if (serverType === "ingreso") {
      msg = `✔️ ${name} — Ingreso registrado: ${dateISO} ${timeHHMM}`;
      await pauseScanningBriefly();
    } else if (serverType === "salida") {
      msg = `✔️ ${name} — Salida registrada: ${dateISO} ${timeHHMM}`;
      await pauseScanningBriefly();
    } else if (serverType === "duplicado_ingreso") {
      msg = `ℹ️ ${name} — El ingreso de hoy ya estaba registrado.`;
      await pauseScanningBriefly(1200);
    } else if (serverType === "duplicado_salida") {
      msg = `ℹ️ ${name} — La salida de hoy ya estaba registrada.`;
      await pauseScanningBriefly(1200);
    } else if (serverType === "cooldown") {
      const left = data.secondsRemaining ?? 0;
      msg = `⏳ Demasiado rápido. Intenta de nuevo en ~${left}s.`;
    } else {
      msg = `✔️ Operación realizada (${serverType}).`;
    }

    $result.textContent = msg;

  }catch(err){
    console.error(err);
    $result.textContent = `❌ ${String(err).replace(/^Error:\s*/, "")}`;
  }
}

// Pausar/reanudar escaneo brevemente para evitar lecturas en ráfaga
async function pauseScanningBriefly(ms=1500){
  if (!html5QrCode) return;
  try{
    await html5QrCode.pause(true); // true = pause scan, keep stream
    await new Promise(r => setTimeout(r, ms));
    await html5QrCode.resume();
  }catch(e){ /* no-op */ }
}

// ====== Init ======
document.addEventListener("DOMContentLoaded", async () => {
  populatePracticantes();

  const st = loadState();
  if (st.name) $practicante.value = st.name;
  if (st.cameraId) currentCameraId = st.cameraId;

  try {
    // Intentamos listar cámaras; si no hay permisos, el usuario los concede al dar clic en "Iniciar"
    await loadCameras().catch(() => {});
  } catch(e) {
    console.error(e);
    $result.textContent = "Error listando cámaras. Pulsa «Iniciar cámara» y acepta permisos.";
  }
});
