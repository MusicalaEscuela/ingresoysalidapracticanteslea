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
let currentCameraId = null;           // si encontramos una trasera concreta, la usamos
let lastScan = { text: null, time: 0 }; // antirrebote cliente (5s)

// ====== Helpers ======
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $cameraSelect   = $("#cameraSelect");     // seguirá en el DOM pero no lo necesitamos
const $practicante    = $("#practicanteSelect");
const $result         = $("#result");
const $btnStart       = $("#btnStart");
const $btnStop        = $("#btnStop");

const loadState = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
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

// ====== UI ======
function populatePracticantes(){
  $practicante.innerHTML = "";
  PRACTICANTES.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    $practicante.appendChild(opt);
  });
}

// Opcional: ocultar el selector de cámara (no lo usaremos)
if ($cameraSelect) $cameraSelect.style.display = "none";

$practicante.addEventListener("change", () => {
  const st = loadState();
  st.name = $practicante.value;
  saveState(st);
});

// ====== Elección automática de cámara trasera ======
async function pickBackCameraId() {
  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || !devices.length) return null;

    // Buscar por etiqueta "back" / "rear"
    const byLabel = devices.find(d => (d.label||"").toLowerCase().includes("back") || (d.label||"").toLowerCase().includes("rear"));
    if (byLabel) return byLabel.id;

    // Algunos Android exponen trasera última en la lista; probamos heurística:
    if (devices.length > 1) return devices[devices.length - 1].id;

    // Fallback a la primera
    return devices[0].id;
  } catch {
    return null;
  }
}

// ====== Escaneo ======
async function start() {
  try {
    // Pedimos permiso explícito para evitar fallos silenciosos en móviles
    await navigator.mediaDevices.getUserMedia({ video: true });

    // 1) Intento preferido: facingMode 'environment' (abre trasera sin deviceId)
    if (html5QrCode) await html5QrCode.stop().catch(()=>{});
    html5QrCode = new Html5Qrcode("reader");

    const commonConfig = { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.7, height: Math.min(vw, vh) * 0.7 }) };

    try {
      await html5QrCode.start(
        { facingMode: { exact: "environment" } },
        commonConfig,
        onScanSuccess,
        () => {}
      );
    } catch (e1) {
      // 2) Fallback: enumerar y escoger "back/rear" (o la última)
      const backId = currentCameraId || await pickBackCameraId();
      if (!backId) throw e1;

      await html5QrCode.start(
        { deviceId: { exact: backId } },
        commonConfig,
        onScanSuccess,
        () => {}
      );
      currentCameraId = backId; // memoriza
      const st = loadState();
      st.cameraId = backId;
      saveState(st);
    }

    $btnStart.disabled = true;
    $btnStop.disabled  = false;
    $result.textContent = "Cámara lista (trasera). Acerca el código QR.";
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
  $btnStop.disabled  = true;
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
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        mode: "registro",
        payload: {
          date: dateISO,
          name,
          stamp: now.toISOString(),
          raw: decodedText,
          type: tipoDetectado
        }
      })
    });

    const rawText = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${rawText.slice(0, 300)}`);

    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error("Respuesta no-JSON del servidor: " + rawText.slice(0, 300)); }

    if(!data.ok) throw new Error(data.error || "Error desconocido del servidor");

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

async function pauseScanningBriefly(ms=1500){
  if (!html5QrCode) return;
  try{
    await html5QrCode.pause(true);
    await new Promise(r => setTimeout(r, ms));
    await html5QrCode.resume();
  }catch(e){ /* no-op */ }
}

// ====== Init ======
document.addEventListener("DOMContentLoaded", async () => {
  populatePracticantes();

  const st = loadState();
  if (st.name) $practicante.value = st.name;

  // memoriza última cámara “elegida” por fallback (si existió)
  if (st.cameraId) currentCameraId = st.cameraId;

  // No listamos cámaras para UI; dejamos que start() resuelva trasera automáticamente.
  // (Si quieres descubrir dispositivos antes, podrías llamar Html5Qrcode.getCameras() aquí.)
});
