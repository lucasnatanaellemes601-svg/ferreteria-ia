const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const LS_CATALOGO = "ferreteria_catalogo_local_v1";
const LS_BORRADOR = "ferreteria_presupuesto_borrador_v1";
const IVA_PERMITIDOS = [0, 2.5, 5, 10.5, 21, 27];

let catalogo = cargarCatalogo();
let presupuestoListo = false;

function leerLocal(clave, alternativo) {
  try {
    const valor = JSON.parse(localStorage.getItem(clave) || "null");
    return valor ?? alternativo;
  } catch {
    return alternativo;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

function cargarCatalogo() {
  const guardado = leerLocal(LS_CATALOGO, []);
  if (!Array.isArray(guardado)) return [];
  return guardado
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      codigo: String(p.codigo ?? "").trim(),
      descripcion: String(p.descripcion ?? "").trim(),
      unidad: String(p.unidad ?? "").trim(),
      precioNeto: Number(p.precioNeto),
      iva: Number(p.iva),
    }))
    .filter((p) => p.codigo && p.descripcion && Number.isFinite(p.precioNeto) && p.precioNeto >= 0 && IVA_PERMITIDOS.includes(p.iva));
}

function fechaLocal(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nuevaReferencia() {
  const ymd = fechaLocal().replaceAll("-", "");
  const bytes = new Uint8Array(3);
  try { globalThis.crypto?.getRandomValues?.(bytes); } catch { /* usa el fallback */ }
  const sufijo = bytes[0] || bytes[1]
    ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()
    : Math.random().toString(16).slice(2, 8).toUpperCase();
  return `COT-${ymd}-${sufijo}`;
}

function crearInput({ label, value = "", placeholder = "", type = "text", step, min, list }) {
  const input = document.createElement("input");
  input.type = type;
  input.setAttribute("aria-label", label);
  input.placeholder = placeholder;
  input.value = value ?? "";
  if (step) input.step = step;
  if (min != null) input.min = min;
  if (list) input.setAttribute("list", list);
  return input;
}

function crearCelda(parent, child) {
  const td = document.createElement("td");
  td.append(child);
  parent.append(td);
  return td;
}

function crearSelectIva(valor = "") {
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Alícuota de IVA");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Elegir";
  select.append(placeholder);
  for (const tasa of IVA_PERMITIDOS) {
    const option = document.createElement("option");
    option.value = String(tasa);
    option.textContent = `${String(tasa).replace(".", ",")}%`;
    select.append(option);
  }
  select.value = String(valor ?? "");
  return select;
}

function crearFila({ codigo = "", descripcion = "", cantidad = 1, unidad = "", precio = "", iva = "" } = {}) {
  const tr = document.createElement("tr");
  const code = crearInput({ label: "Código", value: codigo, placeholder: "Código" });
  const name = crearInput({ label: "Artículo o descripción", value: descripcion, placeholder: "Descripción" });
  const qty = crearInput({ label: "Cantidad", value: String(cantidad), type: "number", step: "0.01", min: "0.01" });
  const unit = crearInput({ label: "Unidad", value: unidad, placeholder: "un, caja, m" });
  const unitPrice = crearInput({ label: "Precio unitario sin IVA", value: precio, placeholder: "Completar", type: "number", step: "0.01", min: "0" });
  const tax = crearSelectIva(iva);

  crearCelda(tr, code);
  crearCelda(tr, name);
  crearCelda(tr, qty);
  crearCelda(tr, unit);
  crearCelda(tr, unitPrice);
  crearCelda(tr, tax);
  const subtotal = document.createElement("strong");
  subtotal.className = "quote-line-total";
  subtotal.textContent = money.format(0);
  crearCelda(tr, subtotal);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "quote-remove no-print";
  remove.setAttribute("aria-label", "Quitar artículo");
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    tr.remove();
    recalcular();
    guardarBorrador();
  });
  crearCelda(tr, remove).className = "no-print";

  $("quote-items").append(tr);
  recalcular();
  if (presupuestoListo) guardarBorrador();
  return tr;
}

function leerFilas() {
  return Array.from($("quote-items").rows).map((tr) => {
    const inputs = tr.querySelectorAll("input");
    const tax = tr.querySelector("select");
    return {
      tr,
      codigo: inputs[0].value.trim(),
      descripcion: inputs[1].value.trim(),
      cantidadTexto: inputs[2].value.trim(),
      cantidad: Number(inputs[2].value),
      unidad: inputs[3].value.trim(),
      precioTexto: inputs[4].value.trim(),
      precio: Number(inputs[4].value),
      iva: tax.value,
      activo: Boolean(inputs[0].value.trim() || inputs[1].value.trim() || inputs[4].value.trim() || tax.value),
    };
  });
}

function recalcular() {
  if (!$("quote-items")) return;
  let neto = 0;
  let ivaTotal = 0;
  for (const row of leerFilas()) {
    const cantidad = Number.isFinite(row.cantidad) && row.cantidad > 0 ? row.cantidad : 0;
    const precio = Number.isFinite(row.precio) && row.precio >= 0 ? row.precio : 0;
    const base = Math.round((cantidad * precio + Number.EPSILON) * 100) / 100;
    const impuesto = row.iva === "" ? 0 : Math.round((base * Number(row.iva) / 100 + Number.EPSILON) * 100) / 100;
    neto += base;
    ivaTotal += impuesto;
    row.tr.querySelector(".quote-line-total").textContent = money.format(base + impuesto);
  }
  $("quote-net").textContent = money.format(neto);
  $("quote-tax").textContent = money.format(ivaTotal);
  $("quote-total").textContent = money.format(neto + ivaTotal);
  $("quote-empty").hidden = $("quote-items").rows.length > 0;
}

function fechaDeHoyMasDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fechaLocal(fecha);
}

function inicializarCampos() {
  $("quote-date").value = fechaLocal();
  $("quote-valid-until").value = fechaDeHoyMasDias(7);
  $("quote-number").value = nuevaReferencia();
}

function normalizarClave(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizarCodigo(valor) {
  return normalizarClave(valor).replace(/\s+/g, "");
}

function etiquetaProducto(producto) {
  return `${producto.codigo} · ${producto.descripcion}`;
}

function catalogoCoincidente(nombre, detalle = "") {
  const buscado = normalizarClave([nombre, detalle].filter(Boolean).join(" "));
  if (!buscado) return null;
  const coincidencias = catalogo.filter((p) => normalizarClave(p.descripcion) === buscado);
  return coincidencias.length === 1 ? coincidencias[0] : null;
}

function agregarDesdeCatalogo(producto) {
  const fila = crearFila({
    codigo: producto.codigo,
    descripcion: producto.descripcion,
    cantidad: 1,
    unidad: producto.unidad,
    precio: String(producto.precioNeto),
    iva: String(producto.iva),
  });
  $("quote-status").textContent = "Artículo agregado del catálogo local. Confirmá que el precio y el IVA sigan vigentes.";
  fila.querySelector("input[aria-label='Cantidad']").focus({ preventScroll: true });
}

function actualizarCatalogo() {
  const opciones = $("quote-catalog-options");
  opciones.replaceChildren();
  for (const producto of catalogo) {
    const option = document.createElement("option");
    option.value = etiquetaProducto(producto);
    opciones.append(option);
  }
  $("quote-catalog-count").textContent = `${catalogo.length} ${catalogo.length === 1 ? "producto" : "productos"}`;
  $("quote-catalog-hint").textContent = catalogo.length
    ? `Hay ${catalogo.length} productos en el catálogo de esta computadora. Revisá precios antes de cotizar.`
    : "Todavía no cargaste productos. Podés ingresarlos a mano o importar un CSV.";
  renderizarProductosCatalogo();
}

function renderizarProductosCatalogo() {
  const destino = $("quote-catalog-products");
  if (!destino) return;
  const filtro = normalizarClave($("quote-catalog-filter")?.value);
  const productos = catalogo
    .filter((p) => !filtro || normalizarClave(`${p.codigo} ${p.descripcion}`).includes(filtro))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
  destino.replaceChildren();
  for (const producto of productos.slice(0, 300)) {
    const item = document.createElement("article");
    item.className = "quote-catalog-item";
    const info = document.createElement("div");
    info.className = "quote-catalog-item-main";
    const name = document.createElement("strong");
    name.textContent = `${producto.codigo} · ${producto.descripcion}`;
    const detail = document.createElement("span");
    detail.textContent = `${producto.unidad || "sin unidad"} · Neto ${money.format(producto.precioNeto)} · IVA ${String(producto.iva).replace(".", ",")}%`;
    info.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "quote-catalog-item-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => editarProducto(producto.codigo));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Eliminar";
    remove.addEventListener("click", () => eliminarProducto(producto.codigo));
    actions.append(edit, remove);
    item.append(info, actions);
    destino.append(item);
  }
  if (!productos.length) {
    const empty = document.createElement("p");
    empty.className = "quote-empty";
    empty.textContent = catalogo.length ? "No hay coincidencias." : "El catálogo está vacío.";
    destino.append(empty);
  } else if (productos.length > 300) {
    const more = document.createElement("p");
    more.className = "quote-empty";
    more.textContent = "Mostrando 300 productos. Usá el filtro para encontrar el resto.";
    destino.append(more);
  }
}

function editarProducto(codigo) {
  const producto = catalogo.find((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
  if (!producto) return;
  $("quote-product-id").value = producto.codigo;
  $("quote-product-code").value = producto.codigo;
  $("quote-product-name").value = producto.descripcion;
  $("quote-product-unit").value = producto.unidad || "";
  $("quote-product-price").value = String(producto.precioNeto);
  $("quote-product-iva").value = String(producto.iva);
  $("quote-catalog-status").textContent = "Editando producto. Guardá para aplicar los cambios al catálogo.";
  $("quote-product-name").focus();
}

function eliminarProducto(codigo) {
  const producto = catalogo.find((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
  if (!producto || !window.confirm(`¿Eliminar ${producto.descripcion} del catálogo local?`)) return;
  catalogo = catalogo.filter((p) => normalizarCodigo(p.codigo) !== normalizarCodigo(codigo));
  const guardado = guardarLocal(LS_CATALOGO, catalogo);
  actualizarCatalogo();
  $("quote-catalog-status").textContent = guardado ? "Producto eliminado del catálogo." : "No se pudo guardar el cambio en este navegador.";
}

function guardarProducto(event) {
  event.preventDefault();
  const codigo = $("quote-product-code").value.trim();
  const descripcion = $("quote-product-name").value.trim();
  const unidad = $("quote-product-unit").value.trim();
  const precioNeto = Number($("quote-product-price").value);
  const iva = Number($("quote-product-iva").value);
  const editando = $("quote-product-id").value;
  if (!codigo || !descripcion || !Number.isFinite(precioNeto) || precioNeto < 0 || !IVA_PERMITIDOS.includes(iva)) {
    $("quote-catalog-status").textContent = "Completá código, descripción, precio neto e IVA válido.";
    return;
  }
  const codigoDuplicado = catalogo.find((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
  if (editando && codigoDuplicado && normalizarCodigo(codigoDuplicado.codigo) !== normalizarCodigo(editando)) {
    $("quote-catalog-status").textContent = "Ese código ya pertenece a otro producto. Usá un código único.";
    return;
  }
  const producto = { codigo, descripcion, unidad, precioNeto, iva };
  if (editando) {
    const index = catalogo.findIndex((p) => normalizarCodigo(p.codigo) === normalizarCodigo(editando));
    if (index >= 0) catalogo[index] = producto;
    else catalogo.push(producto);
  } else if (codigoDuplicado) {
    const index = catalogo.findIndex((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
    catalogo[index] = producto;
  } else {
    catalogo.push(producto);
  }
  catalogo.sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
  const guardado = guardarLocal(LS_CATALOGO, catalogo);
  actualizarCatalogo();
  $("quote-product-form").reset();
  $("quote-product-id").value = "";
  $("quote-catalog-status").textContent = guardado
    ? "Producto guardado en este navegador."
    : "No se pudo guardar: revisá el almacenamiento del navegador.";
}

function contarDelimitadores(linea, delimitador) {
  let cantidad = 0;
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    if (linea[i] === '"') {
      if (entreComillas && linea[i + 1] === '"') i++;
      else entreComillas = !entreComillas;
    } else if (!entreComillas && linea[i] === delimitador) cantidad++;
  }
  return cantidad;
}

function parsearCsv(texto) {
  const contenido = String(texto).replace(/^\uFEFF/, "");
  const primeraLinea = contenido.split(/\r?\n/, 1)[0] || "";
  const delimitador = contarDelimitadores(primeraLinea, ";") >= contarDelimitadores(primeraLinea, ",") ? ";" : ",";
  const filas = [];
  let fila = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < contenido.length; i++) {
    const caracter = contenido[i];
    if (caracter === '"') {
      if (entreComillas && contenido[i + 1] === '"') { campo += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if (!entreComillas && caracter === delimitador) {
      fila.push(campo); campo = "";
    } else if (!entreComillas && (caracter === "\n" || caracter === "\r")) {
      if (caracter === "\r" && contenido[i + 1] === "\n") i++;
      fila.push(campo);
      if (fila.some((celda) => celda.trim())) filas.push(fila);
      fila = []; campo = "";
    } else {
      campo += caracter;
    }
  }
  fila.push(campo);
  if (fila.some((celda) => celda.trim())) filas.push(fila);
  return filas;
}

function numeroCsv(valor) {
  let texto = String(valor ?? "").trim().replace(/[\s$%]/g, "");
  if (!texto) return NaN;
  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.lastIndexOf(",") > texto.lastIndexOf(".")
      ? texto.replace(/\./g, "").replace(",", ".")
      : texto.replace(/,/g, "");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  return Number(texto);
}

function columna(headers, alias) {
  const normalizados = headers.map((h) => normalizarClave(h).replace(/\s/g, ""));
  return normalizados.findIndex((h) => alias.includes(h));
}

function importarCsv(texto) {
  const filas = parsearCsv(texto);
  if (filas.length < 2) throw new Error("El CSV está vacío o solo contiene encabezados.");
  if (filas.length > 10001) throw new Error("El archivo supera el límite de 10.000 productos.");
  const headers = filas[0];
  const col = {
    codigo: columna(headers, ["codigo", "sku", "code"]),
    descripcion: columna(headers, ["descripcion", "producto", "nombre", "articulo", "name"]),
    unidad: columna(headers, ["unidad", "unit", "unidadmedida"]),
    precio: columna(headers, ["preciosiniva", "preciounitariosiniva", "unitpricesinvat"]),
    iva: columna(headers, ["iva", "alicuota", "tasaiva", "taxrate"]),
  };
  if (col.codigo < 0 || col.descripcion < 0 || col.precio < 0 || col.iva < 0) {
    throw new Error("Faltan columnas requeridas. Usá el formato: codigo;descripcion;unidad;precio_sin_iva;iva");
  }
  let importados = 0;
  let omitidos = 0;
  for (const fila of filas.slice(1)) {
    const codigo = String(fila[col.codigo] ?? "").trim();
    const descripcion = String(fila[col.descripcion] ?? "").trim();
    const unidad = col.unidad < 0 ? "" : String(fila[col.unidad] ?? "").trim();
    const precioNeto = numeroCsv(fila[col.precio]);
    const iva = numeroCsv(fila[col.iva]);
    if (!codigo || !descripcion || !Number.isFinite(precioNeto) || precioNeto < 0 || !IVA_PERMITIDOS.includes(iva)) {
      omitidos++;
      continue;
    }
    const producto = { codigo, descripcion, unidad, precioNeto, iva };
    const index = catalogo.findIndex((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
    if (index >= 0) catalogo[index] = producto;
    else catalogo.push(producto);
    importados++;
  }
  catalogo.sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
  if (!guardarLocal(LS_CATALOGO, catalogo)) throw new Error("No se pudo guardar. El navegador puede estar sin espacio disponible.");
  actualizarCatalogo();
  return { importados, omitidos };
}

function escaparCsv(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function descargarArchivo(nombre, contenido, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nombre;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function descargarPlantillaCsv() {
  const contenido = "\uFEFFcodigo;descripcion;unidad;precio_sin_iva;iva\r\n";
  descargarArchivo("plantilla-catalogo-ferreteria.csv", contenido);
}

function exportarCatalogoCsv() {
  const filas = [["codigo", "descripcion", "unidad", "precio_sin_iva", "iva"]];
  for (const p of catalogo) filas.push([p.codigo, p.descripcion, p.unidad, Number(p.precioNeto).toFixed(2).replace(".", ","), String(p.iva).replace(".", ",")]);
  const contenido = "\uFEFF" + filas.map((fila) => fila.map(escaparCsv).join(";")).join("\r\n");
  descargarArchivo("catalogo-ferreteria-local.csv", contenido);
}

function guardarBorrador() {
  if (!presupuestoListo) return;
  const borrador = {
    numero: $("quote-number").value,
    cliente: $("quote-client").value,
    cuit: $("quote-tax-id").value,
    contacto: $("quote-contact").value,
    vendedor: $("quote-seller").value,
    fecha: $("quote-date").value,
    validoHasta: $("quote-valid-until").value,
    observaciones: $("quote-notes").value,
    items: Array.from($("quote-items").rows).map((tr) => {
      const fields = tr.querySelectorAll("input");
      return {
        codigo: fields[0].value,
        descripcion: fields[1].value,
        cantidad: fields[2].value,
        unidad: fields[3].value,
        precio: fields[4].value,
        iva: tr.querySelector("select").value,
      };
    }),
  };
  if (!guardarLocal(LS_BORRADOR, borrador)) {
    $("quote-status").textContent = "No se pudo guardar el borrador en este navegador. Imprimilo antes de cerrar.";
  }
}

function cargarBorrador() {
  const borrador = leerLocal(LS_BORRADOR, null);
  if (!borrador || typeof borrador !== "object" || Array.isArray(borrador)) return false;
  $("quote-number").value = String(borrador.numero || nuevaReferencia());
  $("quote-client").value = String(borrador.cliente || "");
  $("quote-tax-id").value = String(borrador.cuit || "");
  $("quote-contact").value = String(borrador.contacto || "");
  $("quote-seller").value = String(borrador.vendedor || "");
  $("quote-date").value = String(borrador.fecha || fechaLocal());
  $("quote-valid-until").value = String(borrador.validoHasta || fechaDeHoyMasDias(7));
  $("quote-notes").value = String(borrador.observaciones || "");
  $("quote-items").replaceChildren();
  const items = Array.isArray(borrador.items) ? borrador.items.slice(0, 200) : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    crearFila({
      codigo: String(item.codigo || ""),
      descripcion: String(item.descripcion || ""),
      cantidad: String(item.cantidad || "1"),
      unidad: String(item.unidad || ""),
      precio: String(item.precio || ""),
      iva: String(item.iva ?? ""),
    });
  }
  if (!$("quote-items").rows.length) crearFila();
  return true;
}

function validarAntesDeImprimir() {
  if (!$("quote-client").value.trim()) {
    $("quote-status").textContent = "Completá el nombre del cliente antes de imprimir.";
    $("quote-client").focus();
    return false;
  }
  const rows = leerFilas().filter((row) => row.activo);
  if (!rows.length) {
    $("quote-status").textContent = "Agregá al menos un artículo al presupuesto.";
    return false;
  }
  const incompleto = rows.find((row) => !row.descripcion || !row.cantidadTexto || !Number.isFinite(row.cantidad) || row.cantidad <= 0 || row.precioTexto === "" || !Number.isFinite(row.precio) || row.precio < 0 || row.iva === "");
  if (incompleto) {
    $("quote-status").textContent = "Revisá cada artículo: descripción, cantidad, precio e IVA son obligatorios.";
    incompleto.tr.querySelector("input[aria-label='Artículo o descripción']").focus();
    return false;
  }
  for (const row of Array.from($("quote-items").rows)) {
    if (!row.querySelector("input[aria-label='Artículo o descripción']").value.trim()) row.remove();
  }
  $("quote-status").textContent = "";
  guardarBorrador();
  return true;
}

function nuevoBorrador() {
  const tieneDatos = $("quote-client").value.trim() || leerFilas().some((row) => row.activo);
  if (tieneDatos && !window.confirm("¿Descartar este borrador y empezar uno nuevo?")) return;
  for (const id of ["quote-client", "quote-tax-id", "quote-contact", "quote-seller", "quote-notes"]) $(id).value = "";
  $("quote-items").replaceChildren();
  $("quote-status").textContent = "Nuevo borrador listo.";
  inicializarCampos();
  crearFila();
  $("quote-client").focus();
  guardarBorrador();
}

export function iniciarPresupuestos() {
  if (!$("presupuestos") || !$("quote-items")) return;
  inicializarCampos();
  const borradorRestaurado = cargarBorrador();
  if (!borradorRestaurado) crearFila();
  presupuestoListo = true;
  actualizarCatalogo();
  if (!borradorRestaurado) guardarBorrador();

  $("presupuesto-papel").addEventListener("input", () => { recalcular(); guardarBorrador(); });
  $("presupuesto-papel").addEventListener("change", () => { recalcular(); guardarBorrador(); });
  $("quote-add-row").addEventListener("click", () => crearFila());
  $("quote-add-from-catalog").addEventListener("click", () => {
    const elegido = $("quote-catalog-search").value.trim();
    const producto = catalogo.find((p) => etiquetaProducto(p) === elegido);
    if (!producto) {
      $("quote-status").textContent = "Elegí un producto de la lista del catálogo o cargá una línea manual.";
      return;
    }
    agregarDesdeCatalogo(producto);
    $("quote-catalog-search").value = "";
  });
  $("quote-print").addEventListener("click", () => {
    if (!validarAntesDeImprimir()) return;
    $("presupuestos").open = true;
    document.body.classList.add("print-quote");
    window.print();
  });
  $("quote-new").addEventListener("click", nuevoBorrador);
  $("quote-product-form").addEventListener("submit", guardarProducto);
  $("quote-product-form").addEventListener("reset", () => setTimeout(() => { $("quote-product-id").value = ""; }, 0));
  $("quote-catalog-filter").addEventListener("input", renderizarProductosCatalogo);
  $("quote-catalog-template").addEventListener("click", descargarPlantillaCsv);
  $("quote-catalog-export").addEventListener("click", exportarCatalogoCsv);
  $("quote-catalog-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("El CSV supera el límite de 5 MB.");
      const result = importarCsv(await file.text());
      $("quote-catalog-status").textContent = `${result.importados} productos importados o actualizados${result.omitidos ? `; ${result.omitidos} filas omitidas por datos inválidos` : ""}.`;
    } catch (error) {
      $("quote-catalog-status").textContent = error?.message || "No se pudo importar el CSV.";
    } finally {
      event.target.value = "";
    }
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-quote"));
  if (!guardarLocal(LS_CATALOGO, catalogo)) $("quote-catalog-status").textContent = "El navegador no permite guardar el catálogo local.";
}

export function agregarProductoAlPresupuesto(nombre, cantidad = 1, detalle = "") {
  if (!$("presupuestos")) return;
  const coincidencia = catalogoCoincidente(nombre, detalle);
  const descripcion = coincidencia?.descripcion || [nombre, detalle].filter(Boolean).join(" - ").trim();
  if (!descripcion) return;
  $("presupuestos").open = true;
  const fila = crearFila({
    codigo: coincidencia?.codigo || "",
    descripcion,
    cantidad: Number(cantidad) > 0 ? Number(cantidad) : 1,
    unidad: coincidencia?.unidad || "",
    precio: coincidencia ? String(coincidencia.precioNeto) : "",
    iva: coincidencia ? String(coincidencia.iva) : "",
  });
  $("quote-status").textContent = coincidencia
    ? "Coincidencia exacta del catálogo local agregada. Confirmá el producto y que el precio e IVA sigan vigentes."
    : "Artículo agregado desde voz. Completá el precio y confirmá el IVA antes de imprimir.";
  $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
  fila.querySelector("input[aria-label='Artículo o descripción']").focus({ preventScroll: true });
}
