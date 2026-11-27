// public/app.js
// Frontend del piloto: graba audio + dictado, identifica al vendedor por voz,
// Enrolamiento de voces, Modo Dual (Manual / Portero), texto manual, CSV y métricas.
// Todo lo que viene del servidor o del dictado se pinta con textContent (nunca innerHTML).

import { agregarProductoAlPresupuesto, actualizarDatosCompartidos, crearPresupuestoDesdeIA, iniciarPresupuestos } from "./presupuesto.js";
import { supabase } from "./supabase.js";

const API = "/api/procesar";
const LS_PIN = "ferreteria_pin";
const LS_LOG = "ferreteria_piloto_v2";
const MAX_LOG = 500;
const MAX_VISIBLES = 20;
const UMBRAL_REVISAR = 0.7;
const MUESTRA_MINIMA = 30;
const OBJETIVO = 85;

// Mientras sea true, SIEMPRE hay que confirmar quién atendió. Así se mide la precisión real de la voz.
// Cuando la voz ya esté validada, pasalo a false (solo pedirá confirmar las dudosas).
const MODO_PRUEBA_VOZ = true;

const CORTE_AUTO_MS = 25000;   // en Portero, corta y manda cada 25 s como máximo (evita audios enormes)
const MIN_MANUAL_MS = 1000;    // en manual, ignora toques de menos de 1 s
const MIN_ENROLAR_MS = 10000;  // el enrolamiento necesita al menos 10 s de voz

const $ = (id) => document.getElementById(id);

// ---------- PALABRAS CLAVE DEL PORTERO ----------
const PALABRAS_CLAVE = [
  "no hay", "no tengo", "no me quedan", "se terminó", "falta", "faltó", "sin stock", "agotado", "no quedó",
  "vendí", "se llevó", "le cobré", "le di", "facturé",
  "dame", "me das", "tenés", "tienen", "busco", "buscaba", "necesito", "quiero", "llevo", "me llevo", "te pido",
  "cuánto", "precio", "sale", "vale", "presupuesto", "cotizame", "cobrame",
  "kilo", "metro", "litro", "bolsa", "caja", "paquete", "unidad", "pulgada", "milímetro", "centímetro", "docena", "par", "lata", "pomo",
];

// ---------- ALMACENAMIENTO ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

let pin = store.get(LS_PIN) || "";
let log = cargarLog();
let textoPendiente = null;
let enCurso = 0; // envíos al servidor en vuelo
let modoSupabase = false;
let perfilActual = null;
let espacioIniciado = false;

function cargarLog() {
  try {
    const v = JSON.parse(store.get(LS_LOG) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function guardarLog() {
  if (!store.set(LS_LOG, JSON.stringify(log))) {
    setEstado("No pude guardar el historial. Descargá el CSV antes de cerrar.");
  }
}

// ---------- HELPERS DE DOM ----------
function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const h of hijos.flat()) if (h != null) n.append(h);
  return n;
}
function setEstado(t) { $("estado").textContent = t; }

// ---------- INYECTAR BOTONES: ENROLAR + MODO DUAL ----------
const ptt = $("ptt");
let modoAuto = false;
let modoEnrolamiento = false;

const divEnrolar = el("div", { style: "text-align: center; margin-bottom: 15px;" },
  el("button", {
    type: "button",
    style: "background: #333; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em;",
    onclick: () => {
      modoEnrolamiento = !modoEnrolamiento;
      if (modoEnrolamiento) {
        autoReiniciar = false;
        clearTimeout(timerReinicio);
        detenerGrabacion();
        modoAuto = false;
        if ($("switch-modo")) $("switch-modo").checked = false;
      }
      setEstado(modoEnrolamiento
        ? "MODO ENROLAR: mantené apretado y hablá natural al menos 10 segundos."
        : "Modo mostrador normal.");
      pintarBoton();
    },
  }, "👤 Activar/Desactivar Enrolamiento"),
);
ptt.parentNode.insertBefore(divEnrolar, ptt);

const toggleDiv = el("div", { style: "display: flex; gap: 15px; justify-content: center; align-items: center; margin-bottom: 25px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid #333;" },
  el("span", { style: "color: #bbb; font-weight: bold; font-size: 0.9em;" }, "👆 Modo Manual"),
  el("input", { type: "checkbox", id: "switch-modo", style: "width: 45px; height: 25px; cursor: pointer; accent-color: #f97316;" }),
  el("span", { style: "color: #bbb; font-weight: bold; font-size: 0.9em;" }, "🤖 Modo Inteligente (Portero)"),
);
ptt.parentNode.insertBefore(toggleDiv, ptt);

$("switch-modo").addEventListener("change", (e) => {
  if (modoEnrolamiento) { e.target.checked = false; alert("Desactivá el modo enrolamiento primero."); return; }
  mantenerGrabacion = false;
  autoReiniciar = false;
  clearTimeout(timerReinicio);
  detenerGrabacion();
  modoAuto = e.target.checked;
  $("transcripcion").textContent = "";
  setEstado(modoAuto
    ? "Modo inteligente activo. Hacé clic en el botón para que escuche de fondo."
    : "Modo manual activo. Mantené apretado el botón mientras hablás.");
  pintarBoton();
});

// ---------- GRABACIÓN (MediaRecorder) + DICTADO (Web Speech) ----------
let mediaRecorder = null;
let streamMicrofono = null;
let finalizandoGrabacion = false;
let mimeGrabacion = "";
let audioChunks = [];
let grabando = false;
let mantenerGrabacion = false;
let autoReiniciar = false;
let timerReinicio = null;
let timerCorte = null;
let inicioGrabacion = 0;

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocedor = SR ? new SR() : null;
let textoIntermedio = "";
let textoFinal = "";

function pintarBoton() {
  ptt.setAttribute("aria-pressed", String(grabando));
  ptt.classList.toggle("grabando", grabando);
  let t;
  if (modoEnrolamiento) t = grabando ? "🔴 Grabando huella vocal..." : "🎤 Mantené para Enrolar Voz";
  else if (modoAuto) t = grabando || autoReiniciar ? "🔴 Escuchando de fondo (Clic para pausar)" : "🎤 Activar micrófono inteligente";
  else t = grabando ? "🔴 Grabando... soltá al terminar" : "Mantené apretado para hablar";
  $("ptt-texto").textContent = t;
}

function elegirMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
function extensionDe(mime) {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "audio";
}

function liberarMicrofono() {
  if (streamMicrofono) {
    for (const track of streamMicrofono.getTracks()) track.stop();
  }
  streamMicrofono = null;
  mediaRecorder = null;
  mimeGrabacion = "";
}

window.addEventListener("pagehide", () => {
  mantenerGrabacion = false;
  autoReiniciar = false;
  clearTimeout(timerReinicio);
  clearTimeout(timerCorte);
  if (reconocedor) { try { reconocedor.stop(); } catch { /* nada */ } }
  if (mediaRecorder) {
    mediaRecorder.onstop = null;
    if (mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch { /* nada */ }
    }
  }
  liberarMicrofono();
});

async function inicializarMic() {
  if (mediaRecorder && streamMicrofono?.active) return true;
  liberarMicrofono();
  const mime = elegirMime();
  if (mime === null) { setEstado("Este navegador no puede grabar audio."); return false; }
  try {
    streamMicrofono = await navigator.mediaDevices.getUserMedia({ audio: true });
    mimeGrabacion = mime;
    mediaRecorder = mime ? new MediaRecorder(streamMicrofono, { mimeType: mime }) : new MediaRecorder(streamMicrofono);
    if (!mimeGrabacion) mimeGrabacion = mediaRecorder.mimeType || "audio/webm";

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      finalizandoGrabacion = false;
      try { alTerminarGrabacion(); }
      finally { if (!modoAuto || !autoReiniciar) liberarMicrofono(); }
    };
    return true;
  } catch {
    liberarMicrofono();
    setEstado("No pude acceder al micrófono. Revisá los permisos del navegador.");
    return false;
  }
}

function alTerminarGrabacion() {
  const audioBlob = new Blob(audioChunks, { type: mimeGrabacion });
  const txt = (textoFinal + textoIntermedio).trim();
  const duracion = Date.now() - inicioGrabacion;

  if (modoEnrolamiento) {
    if (duracion < MIN_ENROLAR_MS) setEstado("⚠️ Grabá al menos 10 segundos para que la huella vocal sirva.");
    else descargarAudioEnrolamiento(audioBlob, extensionDe(mimeGrabacion));
    return;
  }

  if (!modoAuto) {
    if (duracion < MIN_MANUAL_MS) { setEstado("Muy corto. Mantené apretado mientras hablás."); return; }
    enviarABackend(audioBlob, mimeGrabacion, txt);
    return;
  }

  // Portero local: solo manda a la IA lo que pasa el filtro de palabras clave
  if (txt) {
    const min = txt.toLowerCase();
    if (PALABRAS_CLAVE.some((p) => min.includes(p))) enviarABackend(audioBlob, mimeGrabacion, txt);
    else registrarDescartado(txt);
  }
  if (autoReiniciar) timerReinicio = setTimeout(iniciarGrabacion, 300);
}

async function iniciarGrabacion() {
  if (grabando || finalizandoGrabacion) return;
  if (modoSupabase && !supabase.hasSession()) { mostrarLogin(); setEstado("Primero iniciá sesión."); return; }
  if (!modoSupabase && !pin) { mostrarPin(); setEstado("Primero ingresá el PIN."); return; }

  const listo = await inicializarMic();
  if (!listo) return;
  if ((modoAuto && !autoReiniciar) || (!modoAuto && !mantenerGrabacion)) {
    liberarMicrofono();
    return;
  }
  if (mediaRecorder.state !== "inactive") return; // todavía cerrando la grabación anterior

  audioChunks = [];
  textoIntermedio = "";
  textoFinal = "";
  inicioGrabacion = Date.now();
  $("transcripcion").textContent = "";

  // En enrolamiento no hace falta transcribir
  if (reconocedor && !modoEnrolamiento) {
    reconocedor.lang = "es-AR";
    reconocedor.continuous = true;
    reconocedor.interimResults = true;
    reconocedor.onresult = (ev) => {
      let tFinal = "";
      let tTemp = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) tFinal += ev.results[i][0].transcript + " ";
        else tTemp += ev.results[i][0].transcript;
      }
      if (modoAuto) { textoFinal = tFinal; textoIntermedio = tTemp; }
      else { textoFinal += tFinal; textoIntermedio = tTemp; }
      $("transcripcion").textContent = (textoFinal + textoIntermedio).trim();

      // Portero: cuando termina una frase, corta y evalúa
      if (modoAuto && tFinal.trim() !== "") detenerGrabacion();
    };
    reconocedor.onerror = () => { /* se ignora: el audio igual se graba */ };
    try { reconocedor.start(); }
    catch { setTimeout(() => { try { reconocedor.start(); } catch { /* nada */ } }, 300); }
  }

  try {
    mediaRecorder.start();
  } catch {
    if (reconocedor && !modoEnrolamiento) { try { reconocedor.stop(); } catch { /* nada */ } }
    liberarMicrofono();
    setEstado("No pude iniciar la grabación de audio.");
    return;
  }
  grabando = true;

  // Portero: corte por tiempo, para no acumular minutos de silencio
  clearTimeout(timerCorte);
  if (modoAuto) timerCorte = setTimeout(() => { if (grabando) detenerGrabacion(); }, CORTE_AUTO_MS);

  pintarBoton();
  setEstado("");
}

function detenerGrabacion() {
  clearTimeout(timerCorte);
  if (!grabando) {
    if (!finalizandoGrabacion && (!modoAuto || !autoReiniciar)) liberarMicrofono();
    return;
  }
  grabando = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    finalizandoGrabacion = true;
    mediaRecorder.stop();
  } else if (!modoAuto || !autoReiniciar) {
    liberarMicrofono();
  }
  if (reconocedor && !modoEnrolamiento) { try { reconocedor.stop(); } catch { /* nada */ } }
  pintarBoton();
}

// ----- EVENTOS DEL BOTÓN -----
// Manual y enrolamiento: mantener apretado
ptt.addEventListener("pointerdown", (e) => {
  if (modoAuto || e.button !== 0) return;
  e.preventDefault();
  ptt.setPointerCapture(e.pointerId);
  mantenerGrabacion = true;
  iniciarGrabacion();
});
ptt.addEventListener("pointerup", () => {
  if (!modoAuto) { mantenerGrabacion = false; detenerGrabacion(); }
});
ptt.addEventListener("pointercancel", () => {
  if (!modoAuto) { mantenerGrabacion = false; detenerGrabacion(); }
});

// Portero: un clic activa, otro clic pausa (también durante la pausa de 300 ms entre tramos)
function alternarAuto() {
  if (autoReiniciar) {
    autoReiniciar = false;
    clearTimeout(timerReinicio);
    detenerGrabacion();
    pintarBoton();
  } else {
    autoReiniciar = true;
    iniciarGrabacion();
  }
}
ptt.addEventListener("click", (e) => {
  if (!modoAuto) return;
  e.preventDefault();
  alternarAuto();
});

// Barra espaciadora
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.target.matches("input, textarea, button")) return;
  e.preventDefault();
  if (!modoAuto) { mantenerGrabacion = true; iniciarGrabacion(); }
});
document.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || e.target.matches("input, textarea, button")) return;
  e.preventDefault();
  if (!modoAuto) { mantenerGrabacion = false; detenerGrabacion(); }
  else alternarAuto();
});

// ---------- ENROLAMIENTO ----------
function descargarAudioEnrolamiento(blob, ext) {
  const nombre = (prompt("¡Audio capturado! ¿De qué vendedor es esta voz? (Ej: Marta, Marcos)") || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "");
  if (!nombre) { setEstado("Enrolamiento cancelado."); return; }

  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `${nombre}.${ext}`, style: "display:none" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setEstado(`Audio de ${nombre} descargado. Copialo a la carpeta 'voces' del proyecto y hacé git push.`);
}

// ---------- ENVÍO AL BACKEND ----------
function blobABase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// blob = null → solo texto (formulario manual)
async function enviarABackend(blob, mimeType, textoCrudo) {
  const texto = String(textoCrudo || "").replace(/\s+/g, " ").trim();
  if (!blob && texto.length < 2) return;
  if (modoSupabase && !supabase.hasSession()) {
    if (!blob) textoPendiente = texto;
    mostrarLogin();
    setEstado("Primero iniciá sesión.");
    return;
  }
  if (!modoSupabase && !pin) {
    if (!blob) textoPendiente = texto;
    mostrarPin();
    setEstado("Primero ingresá el PIN.");
    return;
  }

  enCurso++;
  setEstado(blob ? "Analizando audio y voz con IA…" : "Analizando con IA…");
  try {
    const cuerpo = blob
      ? { audioBase64: await blobABase64(blob), mimeType, texto }
      : { texto };

    const authHeaders = modoSupabase
      ? { Authorization: `Bearer ${await supabase.accessToken()}` }
      : { "x-app-pin": pin };
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(cuerpo),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      if (modoSupabase && (data.error === "login_requerido" || data.error === "sesion_invalida")) {
        if (!blob) textoPendiente = texto;
        await supabase.signOut();
        mostrarLogin();
      } else if (!modoSupabase && data.error === "pin_incorrecto") {
        pin = "";
        store.del(LS_PIN);
        if (!blob) textoPendiente = texto;
        mostrarPin();
      }
      setEstado(`Error del servidor (${r.status}): ${data.error || "desconocido"}${data.detalle ? " — " + data.detalle : ""}`);
      return;
    }
    if (!Array.isArray(data.items)) { setEstado("Respuesta inesperada del servidor."); return; }

    registrar(texto, data);
    const presupuestoCreado = data.solicita_presupuesto === true && crearPresupuestoDesdeIA(data.items);
    $("transcripcion").textContent = "";
    setEstado(presupuestoCreado
      ? "Presupuesto preliminar armado. Revisá el catálogo, completá los datos y confirmá antes de imprimir."
      : data.solicita_presupuesto
        ? "Detecté un pedido de presupuesto; mirá el mensaje del módulo para completar el dictado."
        : data.items.length ? "Listo. Revisá el resultado." : "No detecté productos.");
  } catch {
    if (!blob) {
      $("texto-manual").value = texto;
      const det = $("manual");
      if (det) det.open = true;
      setEstado("Sin conexión con el servidor. Dejé tu texto abajo para reintentar.");
    } else {
      setEstado("Sin conexión con el servidor. Ese audio no se envió.");
    }
  } finally {
    enCurso--;
  }
}

// ---------- HISTORIAL Y MEDICIÓN ----------
function nuevoId(sufijo) {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sufijo}`;
}

function registrar(texto, data) {
  log.unshift({ id: nuevoId("ok"), ts: new Date().toISOString(), texto, data, veredicto: null, descartado: false });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  guardarLog();
  render();
}

function registrarDescartado(texto) {
  log.unshift({ id: nuevoId("basura"), ts: new Date().toISOString(), texto, data: null, veredicto: null, descartado: true });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  guardarLog();
  render();
}

function marcar(id, valor) {
  const e = log.find((x) => x.id === id);
  if (!e) return;
  e.veredicto = e.veredicto === valor ? null : valor;
  guardarLog();
  render();
}

// Guarda lo que creyó la IA para poder medir aciertos de voz
function confirmarEmpleado(id, nombreReal) {
  const e = log.find((x) => x.id === id);
  if (!e?.data?.empleado) return;
  const emp = e.data.empleado;
  if (emp.ia_original === undefined) emp.ia_original = emp.nombre;
  emp.nombre = nombreReal;
  emp.confirmado = true;
  e.data.requiere_confirmacion = false;
  guardarLog();
  render();
}

const CLASE_INTENCION = { FALTANTE: "i-faltante", VENTA: "i-venta", CONSULTA: "i-consulta" };
const ETIQUETA_INTENCION = { FALTANTE: "Faltante", VENTA: "Venta", CONSULTA: "Consulta" };
const COLOR_HABLANTE = { EMPLEADO: "#3b82f6", CLIENTE: "#10b981", DESCONOCIDO: "#6b7280" };

function pintarItem(it) {
  const alt = it.alternativa_ofrecida
    ? `Ofrecido: ${it.alternativa_ofrecida} (${it.alternativa_aceptada === true ? "aceptado" : it.alternativa_aceptada === false ? "rechazado" : "sin dato"})`
    : null;
  const conf = Number(it.confianza);
  const candidatos = Array.isArray(it.candidatos) ? it.candidatos : [];

  return el("li", { class: `item ${CLASE_INTENCION[it.intencion] || ""}` },
    it.hablante
      ? el("span", { class: "badge", style: `background-color: ${COLOR_HABLANTE[it.hablante] || "#6b7280"}; font-size: 0.7em; margin-right: 8px; color: white;` }, String(it.hablante))
      : null,
    el("span", { class: "badge" }, ETIQUETA_INTENCION[it.intencion] || String(it.intencion)),
    el("strong", {}, String(it.producto_estandarizado ?? "")),
    el("span", {}, `× ${it.cantidad}`),
    it.medida_o_detalle ? el("span", { class: "muted" }, String(it.medida_o_detalle)) : null,
    Number.isFinite(conf) && conf < UMBRAL_REVISAR ? el("span", { class: "revisar" }, "Revisar") : null,
    alt ? el("span", { class: "linea" }, alt) : null,
    Number.isFinite(conf) ? el("span", { class: "linea" }, `Confianza: ${Math.round(conf * 100)} %`) : null,
    candidatos.length
      ? el("span", { class: "linea" }, "¿Es alguno de estos? " + candidatos.map((c) => `${c.nombre} (${Math.round(Number(c.similitud) * 100)} %)`).join(" · "))
      : null,
    it.catalogo_error ? el("span", { class: "linea" }, "No pude consultar el catálogo.") : null,
    it.intencion === "CONSULTA"
      ? el("button", {
          type: "button",
          class: "quote-add",
          onclick: () => agregarProductoAlPresupuesto(it.producto_estandarizado, it.cantidad, it.medida_o_detalle),
        }, "Agregar al presupuesto")
      : null,
  );
}

function pintarEntrada(e) {
  const hora = new Date(e.ts).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

  if (e.descartado) {
    return el("article", { class: "card entrada", style: "opacity: 0.6; border-left: 4px solid #666;" },
      el("div", { class: "cabecera" }, el("span", {}, hora + " - 🚫 Descartado por el Portero")),
      el("blockquote", {}, e.texto),
      el("div", { class: "veredicto" },
        el("span", {}, "¿Era charla basura nomás?"),
        el("button", { type: "button", "aria-pressed": String(e.veredicto === "ok"), onclick: () => marcar(e.id, "ok") }, "✔ Sí, era basura"),
        el("button", { type: "button", "aria-pressed": String(e.veredicto === "mal"), onclick: () => marcar(e.id, "mal") }, "✘ No, era una venta"),
      ),
    );
  }

  const { empleado, items, requiere_confirmacion, empleados_posibles } = e.data || {};
  const conVoz = Boolean(empleado && Array.isArray(empleados_posibles)); // solo si la entrada vino con audio

  let btnConfirmacion = null;
  if (conVoz && (requiere_confirmacion || MODO_PRUEBA_VOZ) && !empleado.confirmado) {
    const opcionesEmpleado = [
      { valor: "Desconocido", etiqueta: "No es ninguno / desconocido" },
      ...empleados_posibles
        .filter((nombre) => nombre !== "Desconocido")
        .map((nombre) => ({ valor: nombre, etiqueta: nombre })),
    ];
    btnConfirmacion = el("div", { style: "margin-top: 10px; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 8px;" },
      el("strong", { style: "color: #ef4444; display: block; margin-bottom: 5px;" },
        requiere_confirmacion ? "⚠️ Voz dudosa. ¿Quién atendió?" : "Confirmá quién atendió (prueba de voz)"),
      ...opcionesEmpleado.map(({ valor, etiqueta }) =>
        el("button", { type: "button", onclick: () => confirmarEmpleado(e.id, valor), style: "margin-right: 5px; padding: 5px 10px; cursor: pointer;" }, etiqueta)),
    );
  }

  const listaItems = Array.isArray(items) ? items : [];
  return el("article", { class: "card entrada" },
    el("div", { class: "cabecera" },
      el("span", {}, hora),
      conVoz
        ? el("strong", { style: "color: #f97316;" },
            `👤 Vendedor: ${empleado.nombre}${empleado.confirmado ? " ✔" : ` (${Math.round(Number(empleado.confianza) * 100)}%)`}`)
        : null,
    ),
    e.texto ? el("blockquote", {}, e.texto) : null,
    btnConfirmacion,
    listaItems.length
      ? el("ul", { class: "items" }, listaItems.map(pintarItem))
      : el("p", { class: "vacio" }, "No se detectaron productos."),
    el("div", { class: "veredicto" },
      el("span", {}, "¿Salieron bien los productos?"),
      el("button", { type: "button", "aria-pressed": String(e.veredicto === "ok"), onclick: () => marcar(e.id, "ok") }, "✔ Sí"),
      el("button", { type: "button", "aria-pressed": String(e.veredicto === "mal"), onclick: () => marcar(e.id, "mal") }, "✘ No"),
    ),
  );
}

function render() {
  $("lista").replaceChildren(
    ...(log.length
      ? log.slice(0, MAX_VISIBLES).map(pintarEntrada)
      : [el("p", { class: "vacio" }, "Todavía no hay dictados. Elegí un modo arriba del botón.")]),
  );

  // Métrica de productos
  const evaluadas = log.filter((e) => e.veredicto);
  const bien = evaluadas.filter((e) => e.veredicto === "ok").length;
  let txt;
  if (!evaluadas.length) {
    txt = `Marcá ✔ o ✘ en cada resultado para medir. Objetivo: ${OBJETIVO} % con ${MUESTRA_MINIMA} frases.`;
  } else {
    const pct = Math.round((bien / evaluadas.length) * 100);
    txt = `${bien} de ${evaluadas.length} salieron bien (${pct} %). Objetivo: ${OBJETIVO} %.`;
    if (evaluadas.length < MUESTRA_MINIMA) txt += ` Faltan ${MUESTRA_MINIMA - evaluadas.length} frases.`;
    else txt += pct >= OBJETIVO ? " Objetivo alcanzado." : " Por debajo del objetivo.";
  }

  // Métrica de voz: solo cuenta las entradas donde confirmaste quién habló
  const vozEvaluada = log.filter((e) => e.data?.empleado?.confirmado);
  if (vozEvaluada.length) {
    const aciertos = vozEvaluada.filter((e) => e.data.empleado.ia_original === e.data.empleado.nombre).length;
    txt += ` | Aciertos de voz: ${aciertos}/${vozEvaluada.length} (${Math.round((aciertos / vozEvaluada.length) * 100)} %)`;
  }

  const st = $("stats");
  if (st) st.textContent = txt;
}

// ---------- EXPORTAR ----------
function celdaCsv(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
function descargarCsv() {
  const filas = [["fecha", "texto", "veredicto", "items_json", "descartado_por_portero", "vendedor_ia", "vendedor_confirmado"]];
  for (const e of [...log].reverse()) {
    const emp = e.data?.empleado;
    const ia = emp ? (emp.ia_original ?? emp.nombre ?? "") : "";
    const confirmado = emp?.confirmado ? emp.nombre : "";
    filas.push([e.ts, e.texto || "", e.veredicto ?? "", JSON.stringify(e.data?.items || []), e.descartado ? "SI" : "NO", ia, confirmado]);
  }
  const csv = "﻿" + filas.map((f) => f.map(celdaCsv).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `piloto-ferreteria-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- PIN Y CONTROLES ----------
function mostrarPin() { $("pin-box").hidden = false; $("pin").focus(); }
function mostrarLogin() {
  $("app-main").hidden = true;
  $("account-box").hidden = true;
  $("auth-main").hidden = false;
  $("auth-email").focus();
}

async function abrirEspacio() {
  $("auth-main").hidden = true;
  $("app-main").hidden = false;
  $("account-box").hidden = !modoSupabase;
  $("pin-box").hidden = modoSupabase || Boolean(pin);
  $("cambiar-pin").hidden = modoSupabase;
  if (modoSupabase) {
    const persona = perfilActual?.nombre || perfilActual?.email || "Usuario";
    const rol = perfilActual?.rol === "admin" ? "Administrador" : "Vendedor";
    $("account-label").textContent = `${persona} · ${rol}`;
  }
  if (!espacioIniciado) {
    espacioIniciado = true;
    await iniciarPresupuestos({ perfil: perfilActual, remoto: modoSupabase });
  }
  if (textoPendiente) {
    const pendiente = textoPendiente;
    textoPendiente = null;
    enviarABackend(null, null, pendiente);
  }
}

$("form-auth").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("auth-submit");
  submit.disabled = true;
  $("auth-status").textContent = "Iniciando sesión…";
  try {
    await supabase.signIn($("auth-email").value.trim(), $("auth-password").value);
    perfilActual = await supabase.getProfile();
    $("auth-password").value = "";
    $("auth-status").textContent = "";
    await abrirEspacio();
  } catch (error) {
    $("auth-status").textContent = error?.message || "No pude iniciar sesión.";
  } finally {
    submit.disabled = false;
  }
});

$("auth-logout").addEventListener("click", async () => {
  mantenerGrabacion = false;
  autoReiniciar = false;
  clearTimeout(timerReinicio);
  detenerGrabacion();
  await supabase.signOut();
  window.location.reload();
});

$("refresh-shared-data").addEventListener("click", async () => {
  const boton = $("refresh-shared-data");
  const estado = $("account-status");
  boton.disabled = true;
  estado.textContent = "Actualizando catálogo y presupuestos…";
  try {
    const resultado = await actualizarDatosCompartidos();
    estado.textContent = resultado.ok
      ? `Actualizado: ${resultado.productos} productos y ${resultado.presupuestos} presupuestos.`
      : "No pude actualizar. Revisá la conexión y volvé a intentar.";
  } catch (error) {
    estado.textContent = error?.message || "No pude actualizar los datos compartidos.";
  } finally {
    boton.disabled = false;
  }
});

$("form-pin").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("pin").value.trim();
  if (!v) return;
  pin = v;
  store.set(LS_PIN, pin);
  $("pin").value = "";
  $("pin-box").hidden = true;
  setEstado("PIN guardado.");
  if (textoPendiente) { const t = textoPendiente; textoPendiente = null; enviarABackend(null, null, t); }
});
$("cambiar-pin").addEventListener("click", () => { pin = ""; store.del(LS_PIN); mostrarPin(); });

$("form-texto").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("texto-manual").value;
  if (!t.trim()) return;
  $("texto-manual").value = "";
  // El texto manual va directo a la IA, sin portero y sin voz
  enviarABackend(null, null, t);
});
$("csv").addEventListener("click", descargarCsv);
$("borrar").addEventListener("click", () => {
  if (!log.length || !confirm("¿Borrar todo el historial de este navegador? Descargá el CSV antes si lo necesitás.")) return;
  log = [];
  guardarLog();
  render();
});

// ---------- ARRANQUE ----------
if (!SR) {
  setEstado("Este navegador no tiene dictado nativo. Podés grabar audio (modo manual) o escribir abajo.");
  const det = $("manual");
  if (det) det.open = true;
}
pintarBoton();
render();

async function iniciarApp() {
  modoSupabase = await supabase.initialize();
  if (!modoSupabase) {
    perfilActual = null;
    await abrirEspacio();
    if (!pin) mostrarPin();
    return;
  }
  $("pin-box").hidden = true;
  $("cambiar-pin").hidden = true;
  if (!supabase.hasSession()) {
    mostrarLogin();
    return;
  }
  try {
    perfilActual = await supabase.getProfile();
    await abrirEspacio();
  } catch (error) {
    await supabase.signOut();
    $("auth-status").textContent = error?.message || "La sesión no está lista; iniciá sesión de nuevo.";
    mostrarLogin();
  }
}

iniciarApp();
