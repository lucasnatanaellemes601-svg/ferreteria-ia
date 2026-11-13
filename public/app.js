// Frontend del piloto: MODO DUAL (Manual / Automático con Portero Local)
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

// ---------- PALABRAS CLAVE DEL PORTERO (Filtro Inteligente) ----------
const PALABRAS_CLAVE = [
  "no hay", "no tengo", "no me quedan", "se terminó", "falta", "sin stock",
  "se llevó", "vendí", "dame", "cuánto sale", "presupuesto", "cotizame", "tienen",
  "del 8", "pulgadas", "bolsas", "metros", "kilos", "litros", 
  "clavo", "tornillo", "mecha", "cemento", "poxiran", "poxipol", "cable",
  "tuerca", "arandela", "tarugo", "llevo", "buscaba", "necesito", "precio", "cuánto"
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
let analizando = false;

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

// ---------- INYECTAR INTERRUPTOR DUAL ----------
const ptt = $("ptt");
let modoAuto = false;

const toggleDiv = el("div", { style: "display: flex; gap: 15px; justify-content: center; align-items: center; margin-bottom: 25px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid #333;" },
  el("span", { style: "color: #bbb; font-weight: bold; font-size: 0.9em;" }, "👆 Modo Manual"),
  el("input", { type: "checkbox", id: "switch-modo", style: "width: 45px; height: 25px; cursor: pointer; accent-color: #f97316;" }),
  el("span", { style: "color: #bbb; font-weight: bold; font-size: 0.9em;" }, "🤖 Modo Inteligente (Portero)")
);
ptt.parentNode.insertBefore(toggleDiv, ptt);

$("switch-modo").addEventListener("change", (e) => {
  modoAuto = e.target.checked;
  detener();
  pintarBoton(false);
  $("transcripcion").textContent = "";
  setEstado(modoAuto 
    ? "Modo inteligente activo. Hacé clic en el botón para que escuche de fondo." 
    : "Modo manual activo. Mantené apretado el botón mientras hablás.");
});

// ---------- DICTADO DUAL (Web Speech API) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let escuchando = false;
let quiereEscuchar = false; // Flag para modo manual
let autoReiniciar = false;  // Flag para modo auto
let finalTxt = "";
let interimTxt = "";
let errorVoz = "";

function pintarBoton(activo) {
  ptt.setAttribute("aria-pressed", String(activo));
  if (modoAuto) {
    $("ptt-texto").textContent = activo ? "🔴 Escuchando (Clic para pausar)" : "🎤 Activar micrófono inteligente";
    if (activo) ptt.classList.add("grabando"); else ptt.classList.remove("grabando");
  } else {
    $("ptt-texto").textContent = activo ? "Escuchando... soltá al terminar" : "Mantené apretado para hablar";
    ptt.classList.remove("grabando");
  }
}

function iniciar() {
  if (escuchando || rec || analizando) return;
  if (!SR) {
    setEstado("Navegador sin soporte de voz. Usá Chrome o Edge.");
    $("manual").open = true;
    return;
  }
  if (!pin) { mostrarPin(); setEstado("Primero ingresá el PIN."); return; }

  rec = new SR();
  rec.lang = "es-AR";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  finalTxt = ""; interimTxt = ""; errorVoz = "";
  $("transcripcion").textContent = "";
  setEstado("");

  rec.onstart = () => {
    escuchando = true;
    pintarBoton(true);
    if (!modoAuto && !quiereEscuchar) rec.stop(); // Soltó rápido en modo manual
  };

  rec.onresult = (ev) => {
    if (!modoAuto) {
      // Comportamiento Manual
      interimTxt = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript + " ";
        else interimTxt += ev.results[i][0].transcript;
      }
      $("transcripcion").textContent = (finalTxt + interimTxt).trim();
    } else {
      // Comportamiento Auto/Portero
      let tTemp = ""; let tFinal = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) tFinal += ev.results[i][0].transcript + " ";
        else tTemp += ev.results[i][0].transcript;
      }
      $("transcripcion").textContent = (tFinal + tTemp).trim();
      
      // Cuando hay una frase final, se la pasamos al portero
      if (tFinal.trim() !== "") {
        evaluarPortero(tFinal.trim());
      }
    }
  };

  rec.onerror = (ev) => { 
    errorVoz = ev.error || "desconocido"; 
    if (errorVoz === "not-allowed" || errorVoz === "service-not-allowed") {
      autoReiniciar = false; 
    }
  };

  rec.onend = () => {
    escuchando = false;
    rec = null;
    pintarBoton(false);
    
    if (!modoAuto) {
      // En manual, al terminar manda lo que acumuló directo a IA
      const t = (finalTxt + interimTxt).trim();
      if (t) analizar(t);
      else if (errorVoz && errorVoz !== "aborted") setEstado("No te escuché. Mantené apretado mientras hablás.");
    } else {
      // En auto, si no lo pausó el usuario, reinicia para seguir escuchando
      if (autoReiniciar) {
        setTimeout(() => { if (autoReiniciar && !escuchando) iniciar(); }, 300);
      } else if (errorVoz && errorVoz !== "aborted") {
        setEstado("Micrófono pausado.");
      }
    }
  };

  try { rec.start(); } catch { rec = null; setEstado("No pude iniciar el micrófono."); }
}

function detener() { 
  autoReiniciar = false; 
  quiereEscuchar = false;
  if (rec && escuchando) rec.stop(); 
}

// ----- EVENTOS DEL BOTÓN -----
// Para el Modo Manual (Mantiene apretado)
ptt.addEventListener("pointerdown", (e) => { 
  if (modoAuto || e.button !== 0) return; // Si es auto o click derecho, ignora
  e.preventDefault(); 
  ptt.setPointerCapture(e.pointerId); 
  quiereEscuchar = true; 
  iniciar(); 
});
ptt.addEventListener("pointerup", () => { if (!modoAuto) { quiereEscuchar = false; detener(); } });
ptt.addEventListener("pointercancel", () => { if (!modoAuto) { quiereEscuchar = false; detener(); } });

// Para el Modo Auto (Un solo clic)
ptt.addEventListener("click", (e) => {
  if (!modoAuto) return;
  e.preventDefault();
  if (escuchando || autoReiniciar) detener(); 
  else { autoReiniciar = true; iniciar(); }
});

// Soporte barra espaciadora
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.target.matches("input, textarea")) return;
  e.preventDefault();
  if (!modoAuto) { quiereEscuchar = true; iniciar(); }
});
document.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || e.target.matches("input, textarea")) return;
  e.preventDefault();
  if (!modoAuto) { quiereEscuchar = false; detener(); }
  else { if (escuchando || autoReiniciar) detener(); else { autoReiniciar = true; iniciar(); } }
});

// ---------- EL PORTERO LOCAL ----------
function evaluarPortero(texto) {
  const txt = texto.toLowerCase();
  const pasaFiltro = PALABRAS_CLAVE.some(p => txt.includes(p));

  if (pasaFiltro) {
    analizar(texto); // Manda a la IA
  } else {
    registrarDescartado(texto); // Lo guarda como basura
  }
}

// ---------- LLAMADA AL BACKEND ----------
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
      setEstado(`Error del servidor (${r.status}).`);
      return;
    }
    if (!Array.isArray(data.items)) { setEstado("Respuesta inesperada del servidor."); return; }
    
    registrar(texto, data.items);
    $("transcripcion").textContent = ""; 
    setEstado(data.items.length ? "Listo. Revisá el resultado." : "No detecté productos.");
  } catch {
    $("texto-manual").value = texto;
    $("manual").open = true;
    setEstado("Sin conexión con el servidor. Dejé tu texto abajo para reintentar.");
  } finally {
    analizando = false;
  }
}

// ---------- HISTORIAL Y MEDICIÓN ----------
function registrar(texto, items) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-ok`;
  log.unshift({ id, ts: new Date().toISOString(), texto, items, veredicto: null, descartado: false });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  guardarLog(); render();
}

function registrarDescartado(texto) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-basura`;
  log.unshift({ id, ts: new Date().toISOString(), texto, items: [], veredicto: null, descartado: true });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  guardarLog(); render();
}

function marcar(id, valor) {
  const e = log.find((x) => x.id === id);
  if (!e) return;
  e.veredicto = e.veredicto === valor ? null : valor;
  guardarLog(); render();
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
      ? el("span", { class: "linea" }, "¿Es alguno de estos? " + candidatos.map((c) => `${c.nombre} (${Math.round(Number(c.similitud) * 100)} %)`).join(" · "))
      : null,
    it.catalogo_error ? el("span", { class: "linea" }, "No pude consultar el catálogo.") : null,
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
      )
    );
  }

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
      : [el("p", { class: "vacio" }, "Todavía no hay dictados. Elegí un modo arriba del botón.")]),
  );

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
  $("stats").textContent = txt;
}

// ---------- EXPORTAR ----------
function celdaCsv(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;    
  return `"${s.replace(/"/g, '""')}"`;
}
function descargarCsv() {
  const filas = [["fecha", "texto", "veredicto", "items_json", "descartado_por_portero"]];
  for (const e of [...log].reverse()) filas.push([e.ts, e.texto, e.veredicto ?? "", JSON.stringify(e.items), e.descartado ? "SI" : "NO"]);
  const csv = "\uFEFF" + filas.map((f) => f.map(celdaCsv).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `piloto-ferreteria-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- PIN Y CONTROLES ----------
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

$("form-texto").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("texto-manual").value;
  if (!t.trim()) return;
  $("texto-manual").value = "";
  // El texto manual va directo a la IA sin pasar por el portero
  analizar(t);
});
$("csv").addEventListener("click", descargarCsv);
$("borrar").addEventListener("click", () => {
  if (!log.length || !confirm("¿Borrar todo el historial de este navegador? Descargá el CSV antes si lo necesitás.")) return;
  log = [];
  guardarLog();
  render();
});

// ---------- ARRANQUE ----------
if (!pin) mostrarPin();
if (!SR) {
  setEstado("Este navegador no tiene dictado. Usá Chrome o Edge, o escribí abajo.");
  $("manual").open = true;
}
render();