let html5QrCode;
let currentCameraId = null;

const $reader = document.getElementById("reader");
const $cameraSelect = document.getElementById("cameraSelect");
const $fpsInput = document.getElementById("fpsInput");
const $result = document.getElementById("result");
const $btnStart = document.getElementById("btnStart");
const $btnStop = document.getElementById("btnStop");

// Carga cámaras disponibles
async function loadCameras() {
  const devices = await Html5Qrcode.getCameras();
  $cameraSelect.innerHTML = "";
  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.label || `Cámara ${i+1}`;
    $cameraSelect.appendChild(opt);
  });
  if (devices[0]) currentCameraId = devices[0].id;
}

$cameraSelect.addEventListener("change", (e) => {
  currentCameraId = e.target.value;
});

function onScanSuccess(decodedText) {
  const ts = new Date().toLocaleString();
  $result.textContent = `✔️ ${decodedText} — ${ts}`;
  // Para test, vibración ligera en móviles:
  if (navigator.vibrate) navigator.vibrate(50);
}

function onScanFailure(err) {
  // Silencioso; no saturar UI
}

async function start() {
  if (!currentCameraId) await loadCameras();
  if (html5QrCode) await html5QrCode.stop().catch(()=>{});
  html5QrCode = new Html5Qrcode("reader");

  const fps = Math.max(1, Math.min(60, parseInt($fpsInput.value || "10", 10)));

  await html5QrCode.start(
    { deviceId: { exact: currentCameraId } },
    { fps, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.7, height: Math.min(vw, vh) * 0.7 }) },
    onScanSuccess,
    onScanFailure
  );

  $btnStart.disabled = true;
  $btnStop.disabled = false;
}

async function stop() {
  if (html5QrCode) {
    await html5QrCode.stop();
    await html5QrCode.clear();
    html5QrCode = null;
  }
  $btnStart.disabled = false;
  $btnStop.disabled = true;
}

document.addEventListener("DOMContentLoaded", async () => {
  try { await loadCameras(); } catch(e) { console.error(e); $result.textContent = "Error listando cámaras. Revisa permisos."; }
});

$btnStart.addEventListener("click", start);
$btnStop.addEventListener("click", stop);
