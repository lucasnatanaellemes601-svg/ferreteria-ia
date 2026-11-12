// Frontend del piloto: micrófono automático continuo + análisis con /api/procesar + medición de aciertos.
// JavaScript puro, sin dependencias. Todo lo que viene del servidor o del dictado
// se pinta con textContent (nunca innerHTML).

const API = "/api/procesar";
const LS_PIN = "ferreteria_pin";
const LS_LOG = "ferreteria_piloto_v1";
const MAX_LOG = 500;          // entradas guardadas en el navegador
const MAX_VISIBLES = 20;      // entradas dibujadas
const UMBRAL_REVISAR = 0.7;   // confianza por debajo de esto → "Revisar"
const MUESTRA_MINIMA = 30;    // frases evaluadas para fiarse del porcentaje
const OBJETIVO = 85;          // % de aciertos que pide el piloto

const $ = (id) => document.getElementById(id);

// ---------- almacenamiento (puede fallar en modo privado) ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

let pin = store.get(LS_PIN) || "";
let log = cargarLog();
let textoPendiente = null;
let analizando = false;

function cargarLog() {
  try {
    const v = JSON.parse(store.get(LS_LOG) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function guardarLog() {
  if (!store.set(LS_LOG, JSON.stringify(log))) {
    setEstado("No pude guardar el historial en este navegador (¿modo privado?). Descargá el CSV antes de cerrar.");
  }
}

// ---------- helpers de DOM ----------
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

// ---------- dictado CONTINUO (Web Speech API) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let escuchando = false;
let autoReiniciar = false; // Mantiene el mic encendido
let errorVoz = "";

const MENSAJES_VOZ = {
  "not-allowed": "Permití el micrófono en el navegador y probá de nuevo.",
  "service-not-allowed": "El navegador no deja usar el dictado en esta página.",
  "audio-capture": "No encuentro un micrófono conectado.",
  "network": "El dictado necesita internet (Chrome envía el audio a Google).",
  "no-speech": "Silencio detectado. Reiniciando...",
};

function pintarBoton(activo) {
  const ptt = $("ptt");
  ptt.setAttribute("aria-pressed", String(activo));
  $("ptt-texto").textContent = activo ? "🔴 Escuchando (Clic para pausar)" : "🎤 Activar micrófono";
  if (activo) ptt.classList.add("grabando"); else ptt.classList.remove("grabando");
}

function iniciar() {
  if (escuchando || rec || analizando) return;
  if (!SR) {
    setEstado("Este navegador no tiene dictado. Usá Chrome o Edge, o escribí abajo.");
    $("manual").open = true;
    return;
  }
  if (!pin) { mostrarPin(); setEstado("Primero ingresá el PIN."); return; }

  rec = new SR();
  rec.lang = "es-AR";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  errorVoz = "";
  autoReiniciar = true;
  $("transcripcion").textContent = "";
  setEstado("");

  rec.onstart = () => {
    escuchando = true;
    pintarBoton(true);
  };
  
  rec.onresult = (ev) => {
    let textoTemporal = "";
    let textoFinal = "";

    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) textoFinal += r[0].transcript + " ";
      else textoTemporal += r[0].transcript;
    }

    $("transcripcion").textContent = (textoFinal + textoTemporal).trim();

    // Enviar a la IA automáticamente cuando se detecta una frase terminada
    if (textoFinal.trim() !== "") {
      analizar(textoFinal.trim());
    }
  };
  
  rec.onerror = (ev) => { 
      errorVoz = ev.error || "desconocido"; 
      if (errorVoz === "not-allowed" || errorVoz === "service-not-allowed") {
          autoReiniciar = false; // Apagar si no hay permisos
      }
  };
  
  rec.onend = () => {
    escuchando = false;
    rec = null;
    pintarBoton(false);
    
    // Reinicio automático si no lo pausó el usuario
    if (autoReiniciar) {
      setTimeout(() => { if (autoReiniciar && !escuchando) iniciar(); }, 300);
    } else if (errorVoz && errorVoz !== "aborted") {
      setEstado(MENSAJES_VOZ[errorVoz] || "Micrófono pausado.");
    }
  };

  try { rec.start(); } catch { rec = null; setEstado("No pude iniciar el micrófono. Probá de nuevo."); }
}

function detener() { 
    autoReiniciar = false; 
    if (rec && escuchando) rec.stop(); 
}

// Botón: prende y apaga con un solo clic
const ptt = $("ptt");
ptt.addEventListener("click", (e) => { 
    e.preventDefault(); 
    if (escuchando || autoReiniciar) detener(); 
    else iniciar(); 
});

// ---------- llamada al backend ----------
const MENSAJES_API = {
  pin_incorrecto: "PIN incorrecto. Probá de nuevo.",
  login_requerido: "El servidor exige iniciar sesión (Supabase). Fase 2.",
  sesion_invalida: "Sesión inválida de Supabase. Fase 2.",
  servidor_sin_configurar: "Falta configurar el servidor en Vercel.",
  cuota_ia_agotada: "Se agotó la cuota de Gemini por ahora. Probá en un rato.",
  texto_invalido: "El texto es muy corto o muy largo.",
  respuesta_ia_invalida: "La IA devolvió algo que no pude leer. Probá de nuevo.",
  ia_no_disponible: "La IA no respondió. Probá de nuevo en un momento.",
};

async function analizar(textoCrudo) {
  const texto = textoCrudo.replace(/\s+/g, " ").trim();
  if (texto.length < 2) return;
  if (!pin) { textoPendiente = texto; mostrarPin(); setEstado("Primero ingresá el PIN."); return; }

  analizando = true;
  setEstado("Analizando con IA…");
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-pin": pin },
      body: JSON.stringify({ texto }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (data.error === "pin_incorrecto") { pin = ""; store.del(LS_PIN); textoPendiente = texto; mostrarPin(); }
      setEstado(MENSAJES_API[data.error] || `Error del servidor (${r.status}).`);
      return;
    }
    if (!Array.isArray(data.items)) { setEstado("Respuesta inesperada del servidor."); return; }
    
    registrar(texto, data.items);
    $("transcripcion").textContent = ""; // Limpiar para escuchar la siguiente frase
    setEstado(data.items.length ? "Listo. Revisá el resultado." : "No detecté productos.");
  } catch {
    $("texto-manual").value = texto;
    $("manual").open = true;
    setEstado("Sin conexión con el servidor. Dejé tu texto abajo para reintentar.");
  } finally {
    analizando = false;
  }
}

// ---------- historial y medición ----------
function registrar(texto, items) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  log.unshift({ id, ts: new Date().toISOString(), texto, items, veredicto: null });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  guardarLog();
  render();
}

function marcar(id, valor) {
  const e = log.find((x) => x.id === id);
  if (!e) return;
  e.veredicto = e.veredicto === valor ? null : valor;   // tocar de nuevo = deshacer
  guardarLog();
  render();
}

const CLASE_INTENCION = { FALTANTE: "i-faltante", VENTA: "i-venta", CONSULTA: "i-consulta" };
const ETIQUETA_INTENCION = { FALTANTE: "Faltante", VENTA: "Venta", CONSULTA: "Consulta" };

function pintarItem(it) {
  const alt = it.alternativa_ofrecida
    ? `Ofrecido: ${it.alternativa_ofrecida} (${it.alternativa_aceptada === true ? "aceptado" : it.alternativa_aceptada === false ? "rechazado" : "sin dato"})`
    : null;
  const conf = Number(it.confianza);
  const candidatos = Array.isArray(it.candidatos) ? it.candidatos : [];

  return el("li", { class: `item ${CLASE_INTENCION[it.intencion] || ""}` },
    el("span", { class: "badge" }, ETIQUETA_INTENCION[it.intencion] || String(it.intencion)),
    el("strong", {}, String(it.producto_estandarizado)),
    el("span", {}, `× ${it.cantidad}`),
    it.medida_o_detalle ? el("span", { class: "muted" }, String(it.medida_o_detalle)) : null,
    Number.isFinite(conf) && conf < UMBRAL_REVISAR ? el("span", { class: "revisar" }, "Revisar") : null,
    alt ? el("span", { class: "linea" }, alt) : null,
    Number.isFinite(conf) ? el("span", { class: "linea" }, `Confianza: ${Math.round(conf * 100)} %`) : null,
    candidatos.length
      ? el("span", { class: "linea" }, "¿Es alguno de estos? " +
          candidatos.map((c) => `${c.nombre} (${Math.round(Number(c.similitud) * 100)} %)`).join(" · "))
      : null,
    it.catalogo_error ? el("span", { class: "linea" }, "No pude consultar el catálogo.") : null,
  );
}

function pintarEntrada(e) {
  const hora = new Date(e.ts).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  return el("article", { class: "card entrada" },
    el("div", { class: "cabecera" }, el("span", {}, hora)),
    el("blockquote", {}, e.texto),
    e.items.length
      ? el("ul", { class: "items" }, e.items.map(pintarItem))
      : el("p", { class: "vacio" }, "No se detectaron productos."),
    el("div", { class: "veredicto" },
      el("span", {}, "¿Salió bien?"),
      el("button", { type: "button", "aria-pressed": String(e.veredicto === "ok"), onclick: () => marcar(e.id, "ok") }, "✔ Sí"),
      el("button", { type: "button", "aria-pressed": String(e.veredicto === "mal"), onclick: () => marcar(e.id, "mal") }, "✘ No"),
    ),
  );
}

function render() {
  const lista = $("lista");
  lista.replaceChildren(
    ...(log.length
      ? log.slice(0, MAX_VISIBLES).map(pintarEntrada)
      : [el("p", { class: "vacio" }, "Todavía no hay dictados. Hacé clic en Activar Micrófono.")]),
  );

  const evaluadas = log.filter((e) => e.veredicto);
  const bien = evaluadas.filter((e) => e.veredicto === "ok").length;
  let txt;
  if (!evaluadas.length) {
    txt = `Marcá ✔ o ✘ en cada resultado para medir la precisión. Objetivo: ${OBJETIVO} % con al menos ${MUESTRA_MINIMA} frases.`;
  } else {
    const pct = Math.round((bien / evaluadas.length) * 100);
    txt = `${bien} de ${evaluadas.length} salieron bien (${pct} %). Objetivo: ${OBJETIVO} %.`;
    if (evaluadas.length < MUESTRA_MINIMA) txt += ` Faltan ${MUESTRA_MINIMA - evaluadas.length} frases.`;
    else txt += pct >= OBJETIVO ? " Objetivo alcanzado." : " Todavía por debajo del objetivo.";
  }
  $("stats").textContent = txt;
}

// ---------- exportar ----------
function celdaCsv(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;    
  return `"${s.replace(/"/g, '""')}"`;
}
function descargarCsv() {
  const filas = [["fecha", "texto", "veredicto", "items_json"]];
  for (const e of [...log].reverse()) filas.push([e.ts, e.texto, e.veredicto ?? "", JSON.stringify(e.items)]);
  const csv = "\uFEFF" + filas.map((f) => f.map(celdaCsv).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `piloto-ferreteria-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- PIN ----------
function mostrarPin() { $("pin-box").hidden = false; $("pin").focus(); }

$("form-pin").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("pin").value.trim();
  if (!v) return;
  pin = v;
  store.set(LS_PIN, pin);
  $("pin").value = "";
  $("pin-box").hidden = true;
  setEstado("PIN guardado.");
  if (textoPendiente) { const t = textoPendiente; textoPendiente = null; analizar(t); }
});
$("cambiar-pin").addEventListener("click", () => { pin = ""; store.del(LS_PIN); mostrarPin(); });

// ---------- resto de los controles ----------
$("form-texto").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("texto-manual").value;
  if (!t.trim()) return;
  $("texto-manual").value = "";
  analizar(t);
});
$("csv").addEventListener("click", descargarCsv);
$("borrar").addEventListener("click", () => {
  if (!log.length || !confirm("¿Borrar todo el historial de este navegador? Descargá el CSV antes si lo necesitás.")) return;
  log = [];
  guardarLog();
  render();
});

// ---------- arranque ----------
if (!pin) mostrarPin();
if (!SR) {
  setEstado("Este navegador no tiene dictado. Usá Chrome o Edge, o escribí abajo.");
  $("manual").open = true;
}
render();
