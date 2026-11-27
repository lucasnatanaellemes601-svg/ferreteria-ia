const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const cantidadFormato = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const LS_CATALOGO = "ferreteria_catalogo_local_v1";
const LS_BORRADOR = "ferreteria_presupuesto_borrador_v1";
const LS_ARCHIVO = "ferreteria_presupuestos_anteriores_v1";
const IVA_PERMITIDOS = [0, 2.5, 5, 10.5, 21, 27];
const IVA_INCLUIDO_GESTION = "INCLUIDO_GESTION";

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

function numeroOpcional(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function cargarCatalogo() {
  const guardado = leerLocal(LS_CATALOGO, []);
  if (!Array.isArray(guardado)) return [];
  return guardado
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      codigo: String(p.codigo ?? "").trim(),
      descripcion: String(p.descripcion ?? "").trim(),
      alias: String(p.alias ?? "").trim(),
      unidad: String(p.unidad ?? "").trim(),
      precioNeto: numeroOpcional(p.precioNeto),
      iva: numeroOpcional(p.iva),
      precioLista1ConIva: numeroOpcional(p.precioLista1ConIva),
      codigoIva: String(p.codigoIva ?? "").trim(),
      stock: numeroOpcional(p.stock),
      estadoStock: String(p.estadoStock ?? "").trim(),
      deposito: String(p.deposito ?? "").trim(),
      fechaStock: String(p.fechaStock ?? "").trim(),
      origen: String(p.origen ?? "").trim(),
    }))
    .filter((p) => p.codigo && p.descripcion && (
      (Number.isFinite(p.precioNeto) && p.precioNeto >= 0 && IVA_PERMITIDOS.includes(p.iva)) ||
      (Number.isFinite(p.precioLista1ConIva) && p.precioLista1ConIva >= 0) ||
      Number.isFinite(p.stock) || p.estadoStock
    ));
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
  const incluido = document.createElement("option");
  incluido.value = IVA_INCLUIDO_GESTION;
  incluido.textContent = "Incluido (Gestión)";
  select.append(incluido);
  for (const tasa of IVA_PERMITIDOS) {
    const option = document.createElement("option");
    option.value = String(tasa);
    option.textContent = `${String(tasa).replace(".", ",")}%`;
    select.append(option);
  }
  select.value = String(valor ?? "");
  return select;
}

function crearFila({ codigo = "", descripcion = "", cantidad = 1, unidad = "", precio = "", iva = "", stockTexto = "No vinculado al catálogo", stockFuente: fuente = "", stockCantidad = null, stockUnidad = unidad, stockFaltanteManual = false, sinStock = false, entrega = "" } = {}) {
  const tr = document.createElement("tr");
  const code = crearInput({ label: "Código", value: codigo, placeholder: "Código" });
  const name = crearInput({ label: "Artículo o descripción", value: descripcion, placeholder: "Descripción" });
  name.addEventListener("change", () => vincularPresupuestoConCatalogo());
  const qty = crearInput({ label: "Cantidad", value: String(cantidad), type: "number", step: "0.01", min: "0.01" });
  const unit = crearInput({ label: "Unidad", value: unidad, placeholder: "un, caja, m" });
  const unitPrice = crearInput({ label: "Precio unitario", value: precio, placeholder: iva === IVA_INCLUIDO_GESTION ? "Precio Gestión" : "Completar", type: "number", step: "0.01", min: "0" });
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

  const stockCell = document.createElement("td");
  stockCell.className = "quote-stock-cell";
  stockCell.dataset.source = fuente;
  stockCell.dataset.stock = Number.isFinite(stockCantidad) ? String(stockCantidad) : "";
  stockCell.dataset.unit = stockUnidad || "unidades";
  stockCell.dataset.manualShortage = stockFaltanteManual ? "true" : "false";
  const stockInfo = document.createElement("span");
  stockInfo.className = "quote-stock-text";
  stockInfo.textContent = stockTexto;
  const faltaLabel = document.createElement("label");
  faltaLabel.className = "quote-stock-check";
  const falta = document.createElement("input");
  falta.type = "checkbox";
  falta.setAttribute("aria-label", "Marcar faltante o stock insuficiente");
  falta.checked = Boolean(sinStock);
  const faltaTexto = document.createElement("span");
  faltaTexto.textContent = "Hay faltante";
  faltaLabel.append(falta, faltaTexto);
  const entregaInput = crearInput({ label: "Reposición o llegada", value: entrega, placeholder: "Reposición / llegada" });
  entregaInput.className = "quote-arrival";
  entregaInput.maxLength = 100;
  falta.addEventListener("change", () => {
    stockCell.dataset.manualShortage = "true";
    if (falta.checked && !entregaInput.value.trim()) entregaInput.value = "A confirmar";
    else if (!falta.checked && entregaInput.value.trim() === "A confirmar") entregaInput.value = "";
  });
  stockCell.append(stockInfo, faltaLabel, entregaInput);
  tr.append(stockCell);

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
      stockTexto: tr.querySelector(".quote-stock-text")?.textContent || "No verificado",
      stockFuente: tr.querySelector(".quote-stock-cell")?.dataset.source || "",
      sinStock: Boolean(tr.querySelector("input[aria-label='Marcar faltante o stock insuficiente']")?.checked),
      entrega: tr.querySelector("input[aria-label='Reposición o llegada']")?.value.trim() || "",
      activo: Boolean(inputs[0].value.trim() || inputs[1].value.trim() || inputs[4].value.trim() || tax.value),
    };
  });
}

function recalcular() {
  if (!$("quote-items")) return;
  let neto = 0;
  let ivaTotal = 0;
  let precioGestionIncluido = false;
  const fuentesStock = new Set();
  for (const row of leerFilas()) {
    const cantidad = Number.isFinite(row.cantidad) && row.cantidad > 0 ? row.cantidad : 0;
    actualizarStockFila(row.tr, cantidad);
    const precio = Number.isFinite(row.precio) && row.precio >= 0 ? row.precio : 0;
    const base = Math.round((cantidad * precio + Number.EPSILON) * 100) / 100;
    const incluido = row.iva === IVA_INCLUIDO_GESTION;
    if (incluido) precioGestionIncluido = true;
    if (row.stockFuente) fuentesStock.add(row.stockFuente);
    const impuesto = row.iva === "" || incluido ? 0 : Math.round((base * Number(row.iva) / 100 + Number.EPSILON) * 100) / 100;
    neto += base;
    ivaTotal += impuesto;
    row.tr.querySelector(".quote-line-total").textContent = money.format(base + impuesto);
  }
  $("quote-net").textContent = money.format(neto);
  $("quote-tax").textContent = money.format(ivaTotal);
  $("quote-total").textContent = money.format(neto + ivaTotal);
  $("quote-net-row").hidden = precioGestionIncluido;
  $("quote-tax-row").hidden = precioGestionIncluido;
  $("quote-tax-included-note").hidden = !precioGestionIncluido;
  if (precioGestionIncluido) {
    $("quote-tax-included-note").textContent = "El precio de lista 1 de Gestión ya incluye IVA. El Excel informa un código CIVA, pero no la alícuota; por eso no se desglosa ni se suma IVA otra vez. El total suma los importes finales mostrados.";
  }
  $("quote-stock-note").hidden = fuentesStock.size === 0;
  $("quote-stock-note").textContent = fuentesStock.size
    ? `Stock según exportación de ${Array.from(fuentesStock).join("; ")}. Es una foto del momento de exportación; confirmá disponibilidad antes de cerrar la venta.`
    : "";
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
    .replace(/\b(\d+)\s+(\d+)\s*\/\s*(\d+)\b/g, "$1$2/$3")
    .replace(/\b(\d+)\s*\/\s*(\d+)\b/g, "$1f$2")
    .replace(/\b([a-z])\s*-\s*([a-z])\b/g, "$1$2")
    .replace(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/g, (_, numero, unidad) => `${numero.replace(",", ".")}${unidad}`)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizarCodigo(valor) {
  return normalizarClave(valor).replace(/\s+/g, "");
}

function etiquetaProducto(producto) {
  return `${producto.codigo} · ${producto.descripcion}`;
}

function textoStock(producto, cantidadSolicitada = 1) {
  if (!producto) return "No vinculado al catálogo";
  if (!Number.isFinite(producto.stock)) return "Stock no informado en el archivo";
  const stock = producto.stock;
  const unidad = producto.unidad || "unidades";
  if (stock < 0) return `Stock negativo en Gestión: ${cantidadFormato.format(stock)} ${unidad}`;
  if (stock === 0) return "Sin stock según Gestión";
  if (stock < Number(cantidadSolicitada || 1)) return `Parcial: hay ${cantidadFormato.format(stock)} ${unidad}`;
  return `Hay ${cantidadFormato.format(stock)} ${unidad}`;
}

function actualizarStockFila(tr, cantidadSolicitada) {
  const celda = tr.querySelector(".quote-stock-cell");
  if (!celda || celda.dataset.stock === "") return;
  const stock = Number(celda.dataset.stock);
  if (!Number.isFinite(stock)) return;
  const unidad = celda.dataset.unit || "unidades";
  const texto = tr.querySelector(".quote-stock-text");
  const falta = celda.querySelector("input[aria-label='Marcar faltante o stock insuficiente']");
  const llegada = celda.querySelector("input[aria-label='Reposición o llegada']");
  if (stock < 0) texto.textContent = `Stock negativo en Gestión: ${cantidadFormato.format(stock)} ${unidad}`;
  else if (stock === 0) texto.textContent = "Sin stock según Gestión";
  else if (stock < cantidadSolicitada) texto.textContent = `Parcial: hay ${cantidadFormato.format(stock)} ${unidad}`;
  else texto.textContent = `Hay ${cantidadFormato.format(stock)} ${unidad}`;
  if (celda.dataset.manualShortage !== "true") {
    falta.checked = stock < cantidadSolicitada;
    if (falta.checked && !llegada.value.trim()) llegada.value = "A confirmar";
    else if (!falta.checked && llegada.value.trim() === "A confirmar") llegada.value = "";
  }
}

function fuenteStock(producto) {
  if (!producto || (!producto.origen && !producto.fechaStock && !producto.deposito)) return "";
  return [producto.origen || "Gestión", producto.deposito, producto.fechaStock].filter(Boolean).join(" · ");
}

function catalogoCoincidente(nombre, detalle = "") {
  const buscado = normalizarClave([nombre, detalle].filter(Boolean).join(" "));
  if (!buscado) return null;
  const coincidenciasExactas = catalogo.filter((p) =>
    normalizarClave(p.descripcion) === buscado || (p.alias && normalizarClave(p.alias) === buscado),
  );
  if (coincidenciasExactas.length === 1) return coincidenciasExactas[0];
  if (coincidenciasExactas.length > 1) return null;

  const stopWords = new Set(["de", "del", "para", "por", "con", "el", "la", "los", "las", "un", "una", "y", "pulg", "pulgada", "pulgadas", "mm", "cm", "m", "metro", "metros", "unidad", "unidades"]);
  const terminos = buscado.split(" ").filter((t) => t.length > 1 && !stopWords.has(t)).map((t) => t === "pp" ? "ppn" : t);
  if (!terminos.length) return null;
  const candidatas = catalogo.filter((p) => {
    const texto = new Set(normalizarClave(`${p.descripcion} ${p.alias || ""}`).split(" "));
    return terminos.every((termino) => texto.has(termino));
  });
  return candidatas.length === 1 ? candidatas[0] : null;
}

function vincularPresupuestoConCatalogo() {
  if (!catalogo.length || !$("quote-items")) return 0;
  let actualizadas = 0;
  for (const tr of Array.from($("quote-items").rows)) {
    const inputs = tr.querySelectorAll("input");
    const codigo = inputs[0]?.value.trim() || "";
    const descripcion = inputs[1]?.value.trim() || "";
    const producto = codigo
      ? catalogo.find((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo))
      : catalogoCoincidente(descripcion);
    if (!producto) continue;

    let cambio = false;
    const completar = (campo, valor) => {
      if (campo && valor && campo.value.trim() !== String(valor)) {
        campo.value = String(valor);
        cambio = true;
      }
    };
    completar(inputs[0], producto.codigo);
    if (!descripcion) completar(inputs[1], producto.descripcion);
    completar(inputs[3], producto.unidad);

    const iva = tr.querySelector("select");
    if (!inputs[4]?.value.trim()) {
      if (Number.isFinite(producto.precioNeto) && IVA_PERMITIDOS.includes(producto.iva)) {
        completar(inputs[4], producto.precioNeto);
        if (iva.value !== String(producto.iva)) { iva.value = String(producto.iva); cambio = true; }
      } else if (Number.isFinite(producto.precioLista1ConIva)) {
        completar(inputs[4], producto.precioLista1ConIva);
        if (iva.value !== IVA_INCLUIDO_GESTION) { iva.value = IVA_INCLUIDO_GESTION; cambio = true; }
      }
    }

    const celda = tr.querySelector(".quote-stock-cell");
    if (celda) {
      const yaTeniaStockVinculado = Boolean(celda.dataset.source) || celda.dataset.stock !== "";
      if (!yaTeniaStockVinculado && celda.dataset.manualShortage === "true") {
        celda.dataset.manualShortage = "false";
        cambio = true;
      }
      const fuente = fuenteStock(producto);
      const stock = Number.isFinite(producto.stock) ? String(producto.stock) : "";
      if (celda.dataset.source !== fuente || celda.dataset.stock !== stock || celda.dataset.unit !== (producto.unidad || "unidades")) cambio = true;
      celda.dataset.source = fuente;
      celda.dataset.stock = stock;
      celda.dataset.unit = producto.unidad || "unidades";
      const cantidad = Number(inputs[2]?.value) > 0 ? Number(inputs[2].value) : 1;
      const etiqueta = textoStock(producto, cantidad);
      const texto = celda.querySelector(".quote-stock-text");
      if (texto && texto.textContent !== etiqueta) { texto.textContent = etiqueta; cambio = true; }
    }
    if (cambio) actualizadas++;
  }
  if (actualizadas) {
    recalcular();
    guardarBorrador();
    $("quote-status").textContent = actualizadas + " artículo(s) vinculados o actualizados desde el catálogo. Revisá precios, IVA incluido y stock del corte importado.";
  }
  return actualizadas;
}

function agregarDesdeCatalogo(producto) {
  const tieneNeto = Number.isFinite(producto.precioNeto) && IVA_PERMITIDOS.includes(producto.iva);
  const precio = tieneNeto ? String(producto.precioNeto) : Number.isFinite(producto.precioLista1ConIva) ? String(producto.precioLista1ConIva) : "";
  const iva = tieneNeto ? String(producto.iva) : precio ? IVA_INCLUIDO_GESTION : "";
  const fila = crearFila({
    codigo: producto.codigo,
    descripcion: producto.descripcion,
    cantidad: 1,
    unidad: producto.unidad,
    precio,
    iva,
    stockTexto: textoStock(producto),
    stockFuente: fuenteStock(producto),
    stockCantidad: producto.stock,
    stockUnidad: producto.unidad,
    sinStock: Number.isFinite(producto.stock) && producto.stock < 1,
    entrega: Number.isFinite(producto.stock) && producto.stock < 1 ? "A confirmar" : "",
  });
  $("quote-status").textContent = tieneNeto
    ? "Artículo agregado del catálogo local. Confirmá que el precio y el IVA sigan vigentes."
    : "Artículo agregado desde Gestión. El precio de lista 1 ya incluye IVA; revisá la disponibilidad del stock exportado.";
  fila.querySelector("input[aria-label='Cantidad']").focus({ preventScroll: true });
}

function actualizarCatalogo() {
  const opciones = $("quote-catalog-options");
  opciones.replaceChildren();
  const filtro = normalizarClave($("quote-catalog-search")?.value || "");
  const sugerencias = catalogo.filter((producto) => !filtro || normalizarClave(`${producto.codigo} ${producto.descripcion} ${producto.alias}`).includes(filtro)).slice(0, 120);
  for (const producto of sugerencias) {
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
    .filter((p) => !filtro || normalizarClave(`${p.codigo} ${p.descripcion} ${p.alias}`).includes(filtro))
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
    const datos = [producto.unidad || "sin unidad"];
    if (Number.isFinite(producto.precioNeto) && IVA_PERMITIDOS.includes(producto.iva)) {
      datos.push(`Neto ${money.format(producto.precioNeto)} · IVA ${String(producto.iva).replace(".", ",")}%`);
    }
    if (Number.isFinite(producto.precioLista1ConIva)) {
      datos.push(`Gestión lista 1 ${money.format(producto.precioLista1ConIva)} IVA incluido${producto.codigoIva ? ` · CIVA ${producto.codigoIva}` : ""}`);
    }
    datos.push(textoStock(producto));
    if (producto.deposito) datos.push(producto.deposito);
    if (producto.fechaStock) datos.push(`Exportado ${producto.fechaStock}`);
    detail.textContent = datos.join(" · ");
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
  $("quote-product-price").value = Number.isFinite(producto.precioNeto) ? String(producto.precioNeto) : "";
  $("quote-product-iva").value = IVA_PERMITIDOS.includes(producto.iva) ? String(producto.iva) : "";
  $("quote-catalog-status").textContent = Number.isFinite(producto.precioLista1ConIva)
    ? "Si cargás un precio sin IVA, quedará como precio manual prioritario. Se conserva el precio de Gestión como referencia."
    : "Editando producto. Guardá para aplicar los cambios al catálogo.";
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
  const previo = catalogo.find((p) => normalizarCodigo(p.codigo) === normalizarCodigo(codigo));
  const producto = { ...previo, codigo, descripcion, unidad, precioNeto, iva };
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
    codigo: columna(headers, ["codigo", "carticulo", "sku", "code"]),
    descripcion: columna(headers, ["descripcion", "articulolargo", "producto", "nombre", "articulo", "name"]),
    alias: columna(headers, ["alias", "articulocorto"]),
    unidad: columna(headers, ["unidad", "unit", "unidadmedida"]),
    precio: columna(headers, ["preciosiniva", "preciounitariosiniva", "unitpricesinvat"]),
    iva: columna(headers, ["iva", "alicuota", "tasaiva", "taxrate"]),
    precioGestion: columna(headers, ["preciolista1coniva", "preciogestionconiva", "puconiva1"]),
    codigoIva: columna(headers, ["codigoiva", "civa"]),
    stock: columna(headers, ["stock", "cantidad", "existencia"]),
    estadoStock: columna(headers, ["estadostock", "estadoregistro"]),
    deposito: columna(headers, ["deposito"]),
    fechaStock: columna(headers, ["fechastock", "actualizado", "corte"]),
    origen: columna(headers, ["origen"]),
  };
  if (col.codigo < 0 || col.descripcion < 0) {
    throw new Error("Faltan columnas requeridas. Incluí al menos codigo y descripcion.");
  }
  let importados = 0;
  let omitidos = 0;
  for (const fila of filas.slice(1)) {
    const codigo = String(fila[col.codigo] ?? "").trim();
    const descripcion = String(fila[col.descripcion] ?? "").trim();
    const alias = col.alias < 0 ? "" : String(fila[col.alias] ?? "").trim();
    const unidad = col.unidad < 0 ? "" : String(fila[col.unidad] ?? "").trim();
    const precioNeto = col.precio < 0 ? NaN : numeroCsv(fila[col.precio]);
    const iva = col.iva < 0 ? NaN : numeroCsv(fila[col.iva]);
    const precioLista1ConIva = col.precioGestion < 0 ? NaN : numeroCsv(fila[col.precioGestion]);
    const codigoIva = col.codigoIva < 0 ? "" : String(fila[col.codigoIva] ?? "").trim();
    const stock = col.stock < 0 ? NaN : numeroCsv(fila[col.stock]);
    const estadoStock = col.estadoStock < 0 ? "" : String(fila[col.estadoStock] ?? "").trim();
    const deposito = col.deposito < 0 ? "" : String(fila[col.deposito] ?? "").trim();
    const fechaStock = col.fechaStock < 0 ? "" : String(fila[col.fechaStock] ?? "").trim();
    const origen = col.origen < 0 ? "" : String(fila[col.origen] ?? "").trim();
    const precioNetoValido = Number.isFinite(precioNeto) && precioNeto >= 0 && IVA_PERMITIDOS.includes(iva);
    const precioGestionValido = Number.isFinite(precioLista1ConIva) && precioLista1ConIva >= 0;
    const stockInformado = Number.isFinite(stock) || Boolean(estadoStock);
    if (!codigo || !descripcion || (!precioNetoValido && !precioGestionValido && !stockInformado)) {
      omitidos++;
      continue;
    }
    const producto = {
      codigo, descripcion, alias, unidad,
      precioNeto: precioNetoValido ? precioNeto : null,
      iva: precioNetoValido ? iva : null,
      precioLista1ConIva: precioGestionValido ? precioLista1ConIva : null,
      codigoIva, stock: Number.isFinite(stock) ? stock : null,
      estadoStock, deposito, fechaStock, origen,
    };
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
  const contenido = "\uFEFFcodigo;descripcion;alias;unidad;precio_sin_iva;iva;precio_lista1_con_iva;codigo_iva;stock;estado_stock;deposito;fecha_stock;origen\r\n";
  descargarArchivo("plantilla-catalogo-ferreteria.csv", contenido);
}

function exportarCatalogoCsv() {
  const filas = [["codigo", "descripcion", "alias", "unidad", "precio_sin_iva", "iva", "precio_lista1_con_iva", "codigo_iva", "stock", "estado_stock", "deposito", "fecha_stock", "origen"]];
  for (const p of catalogo) filas.push([
    p.codigo, p.descripcion, p.alias, p.unidad,
    Number.isFinite(p.precioNeto) ? p.precioNeto.toFixed(2).replace(".", ",") : "",
    IVA_PERMITIDOS.includes(p.iva) ? String(p.iva).replace(".", ",") : "",
    Number.isFinite(p.precioLista1ConIva) ? p.precioLista1ConIva.toFixed(2).replace(".", ",") : "",
    p.codigoIva, Number.isFinite(p.stock) ? String(p.stock).replace(".", ",") : "",
    p.estadoStock, p.deposito, p.fechaStock, p.origen,
  ]);
  const contenido = "\uFEFF" + filas.map((fila) => fila.map(escaparCsv).join(";")).join("\r\n");
  descargarArchivo("catalogo-ferreteria-local.csv", contenido);
}

function obtenerBorrador() {
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
        stockTexto: tr.querySelector(".quote-stock-text")?.textContent || "No verificado",
        stockFuente: tr.querySelector(".quote-stock-cell")?.dataset.source || "",
        stockCantidad: tr.querySelector(".quote-stock-cell")?.dataset.stock === "" ? null : numeroOpcional(tr.querySelector(".quote-stock-cell")?.dataset.stock),
        stockUnidad: tr.querySelector(".quote-stock-cell")?.dataset.unit || "",
        stockFaltanteManual: tr.querySelector(".quote-stock-cell")?.dataset.manualShortage === "true",
        sinStock: Boolean(tr.querySelector("input[aria-label='Marcar faltante o stock insuficiente']")?.checked),
        entrega: tr.querySelector("input[aria-label='Reposición o llegada']")?.value || "",
      };
    }),
  };
  return borrador;
}

function guardarBorrador() {
  if (!presupuestoListo) return;
  const borrador = obtenerBorrador();
  if (!guardarLocal(LS_BORRADOR, borrador)) {
    $("quote-status").textContent = "No se pudo guardar el borrador en este navegador. Imprimilo antes de cerrar.";
  }
}

function borradorTieneContenido(borrador) {
  return Boolean(borrador && (
    borrador.cliente || borrador.cuit || borrador.contacto || borrador.vendedor || borrador.observaciones ||
    (Array.isArray(borrador.items) && borrador.items.some((item) => item?.descripcion || item?.codigo || item?.precio))
  ));
}

function archivarBorrador(borrador) {
  if (!borradorTieneContenido(borrador)) return false;
  const guardados = leerLocal(LS_ARCHIVO, []);
  const lista = Array.isArray(guardados) ? guardados : [];
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  lista.unshift({ id, fecha: new Date().toISOString(), borrador });
  if (!guardarLocal(LS_ARCHIVO, lista.slice(0, 20))) return false;
  renderizarArchivados();
  return true;
}

function aplicarBorrador(borrador) {
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
      stockTexto: String(item.stockTexto || "No verificado"),
      stockFuente: String(item.stockFuente || ""),
      stockCantidad: numeroOpcional(item.stockCantidad),
      stockUnidad: String(item.stockUnidad || item.unidad || ""),
      stockFaltanteManual: Boolean(item.stockFaltanteManual),
      sinStock: Boolean(item.sinStock),
      entrega: String(item.entrega || ""),
    });
  }
  if (!$("quote-items").rows.length) crearFila();
  return true;
}

function cargarBorrador() {
  return aplicarBorrador(leerLocal(LS_BORRADOR, null));
}

function renderizarArchivados() {
  const destino = $("quote-archive-list");
  const contador = $("quote-archive-count");
  if (!destino || !contador) return;
  const archivo = leerLocal(LS_ARCHIVO, []);
  const lista = Array.isArray(archivo) ? archivo : [];
  contador.textContent = String(lista.length);
  destino.replaceChildren();
  if (!lista.length) {
    const vacio = document.createElement("p");
    vacio.className = "quote-empty";
    vacio.textContent = "Todavia no hay presupuestos guardados.";
    destino.append(vacio);
    return;
  }
  for (const entrada of lista) {
    if (!entrada?.borrador) continue;
    const fila = document.createElement("div");
    fila.className = "quote-archive-item";
    const titulo = document.createElement("span");
    const fecha = new Date(entrada.fecha || "").toLocaleDateString("es-AR");
    titulo.textContent = `${entrada.borrador.numero || "Presupuesto"} | ${entrada.borrador.cliente || "Sin cliente"} | ${fecha}`;
    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.textContent = "Abrir";
    abrir.addEventListener("click", () => {
      const actual = obtenerBorrador();
      if (borradorTieneContenido(actual) && !archivarBorrador(actual)) {
        $("quote-status").textContent = "No pude guardar el borrador actual; no lo reemplacé.";
        return;
      }
      aplicarBorrador(entrada.borrador);
      guardarBorrador();
      $("presupuestos").open = true;
      $("quote-status").textContent = "Borrador anterior recuperado.";
      $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    fila.append(titulo, abrir);
    destino.append(fila);
  }
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
    const faltantes = [];
    if (!incompleto.descripcion) faltantes.push("descripción");
    if (!incompleto.cantidadTexto || !Number.isFinite(incompleto.cantidad) || incompleto.cantidad <= 0) faltantes.push("cantidad");
    if (incompleto.precioTexto === "" || !Number.isFinite(incompleto.precio) || incompleto.precio < 0) faltantes.push("precio");
    if (incompleto.iva === "") faltantes.push("IVA");
    const datos = faltantes.length > 1
      ? `${faltantes.slice(0, -1).join(", ")} e ${faltantes[faltantes.length - 1]}`
      : faltantes[0];
    $("quote-status").textContent = `No se imprimió: a “${incompleto.descripcion || "este artículo"}” le falta ${datos}.`;
    const campo = !incompleto.descripcion
      ? incompleto.tr.querySelector("input[aria-label='Artículo o descripción']")
      : !incompleto.cantidadTexto || !Number.isFinite(incompleto.cantidad) || incompleto.cantidad <= 0
        ? incompleto.tr.querySelector("input[aria-label='Cantidad']")
        : incompleto.precioTexto === "" || !Number.isFinite(incompleto.precio) || incompleto.precio < 0
          ? incompleto.tr.querySelector("input[aria-label='Precio unitario']")
          : incompleto.tr.querySelector("select");
    campo?.focus();
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
  vincularPresupuestoConCatalogo();
  actualizarCatalogo();
  renderizarArchivados();
  if (!borradorRestaurado) guardarBorrador();

  $("presupuesto-papel").addEventListener("input", () => { recalcular(); guardarBorrador(); });
  $("presupuesto-papel").addEventListener("change", () => { recalcular(); guardarBorrador(); });
  $("quote-add-row").addEventListener("click", () => crearFila());
  $("quote-catalog-search").addEventListener("input", actualizarCatalogo);
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
      vincularPresupuestoConCatalogo();
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

export function crearPresupuestoDesdeIA(items = []) {
  if (!presupuestoListo || !Array.isArray(items)) return false;
  const solicitados = items
    .filter((item) => item && item.intencion === "CONSULTA" && typeof item.producto_estandarizado === "string" && item.producto_estandarizado.trim())
    .slice(0, 20);
  if (!solicitados.length) {
    $("presupuestos").open = true;
    $("quote-status").textContent = "La IA detectó un pedido de presupuesto, pero no pudo identificar artículos. Dictá los productos y cantidades con más detalle.";
    $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
    return false;
  }

  const borradorActual = obtenerBorrador();
  const tieneBorradorActual = borradorTieneContenido(borradorActual);
  const archivado = tieneBorradorActual && archivarBorrador(borradorActual);
  if (tieneBorradorActual && !archivado) {
    $("presupuestos").open = true;
    $("quote-status").textContent = "No pude guardar el borrador actual en Presupuestos anteriores; no lo reemplacé. Guardá una copia o liberá espacio y volvé a intentarlo.";
    $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
    return false;
  }
  for (const id of ["quote-client", "quote-tax-id", "quote-contact", "quote-seller", "quote-notes"]) $(id).value = "";
  $("quote-items").replaceChildren();
  inicializarCampos();

  let encontrados = 0;
  for (const item of solicitados) {
    const nombre = item.producto_estandarizado.trim();
    const detalle = typeof item.medida_o_detalle === "string" ? item.medida_o_detalle.trim() : "";
    const cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
    const coincidencia = catalogoCoincidente(nombre, detalle);
    if (coincidencia) encontrados++;
    const tieneNeto = coincidencia && Number.isFinite(coincidencia.precioNeto) && IVA_PERMITIDOS.includes(coincidencia.iva);
    const tieneGestion = coincidencia && Number.isFinite(coincidencia.precioLista1ConIva);
    const precio = tieneNeto ? String(coincidencia.precioNeto) : tieneGestion ? String(coincidencia.precioLista1ConIva) : "";
    const iva = tieneNeto ? String(coincidencia.iva) : tieneGestion ? IVA_INCLUIDO_GESTION : "";
    crearFila({
      codigo: coincidencia?.codigo || "",
      descripcion: coincidencia?.descripcion || [nombre, detalle].filter(Boolean).join(" - "),
      cantidad,
      unidad: coincidencia?.unidad || "",
      precio,
      iva,
      stockTexto: coincidencia ? textoStock(coincidencia, cantidad) : "No vinculado al catálogo",
      stockFuente: fuenteStock(coincidencia),
      stockCantidad: coincidencia?.stock ?? null,
      stockUnidad: coincidencia?.unidad || "",
      sinStock: Boolean(coincidencia && Number.isFinite(coincidencia.stock) && coincidencia.stock < cantidad),
      entrega: coincidencia && Number.isFinite(coincidencia.stock) && coincidencia.stock < cantidad ? "A confirmar" : "",
    });
  }
  $("presupuestos").open = true;
  const pendientes = solicitados.length - encontrados;
  $("quote-status").textContent = `Borrador creado desde voz/texto: ${solicitados.length} articulo(s). ${encontrados} productos se vincularon a una coincidencia unica del catalogo${pendientes ? `; completa precio e IVA en ${pendientes} pendiente(s)` : "; revisa precios y datos del cliente"}.${archivado ? " El borrador anterior quedo guardado en Presupuestos anteriores." : ""}`;
  guardarBorrador();
  $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
  const primeroIncompleto = Array.from($("quote-items").rows).find((fila) => !fila.querySelector("input[aria-label='Precio unitario']").value);
  if (primeroIncompleto) primeroIncompleto.querySelector("input[aria-label='Precio unitario']").focus({ preventScroll: true });
  return true;
}

export function agregarProductoAlPresupuesto(nombre, cantidad = 1, detalle = "") {
  if (!$("presupuestos")) return;
  const coincidencia = catalogoCoincidente(nombre, detalle);
  const descripcion = coincidencia?.descripcion || [nombre, detalle].filter(Boolean).join(" - ").trim();
  if (!descripcion) return;
  $("presupuestos").open = true;
  const tieneNeto = coincidencia && Number.isFinite(coincidencia.precioNeto) && IVA_PERMITIDOS.includes(coincidencia.iva);
  const tieneGestion = coincidencia && Number.isFinite(coincidencia.precioLista1ConIva);
  const precio = tieneNeto ? String(coincidencia.precioNeto) : tieneGestion ? String(coincidencia.precioLista1ConIva) : "";
  const iva = tieneNeto ? String(coincidencia.iva) : tieneGestion ? IVA_INCLUIDO_GESTION : "";
  const cantidadFinal = Number(cantidad) > 0 ? Number(cantidad) : 1;
  const fila = crearFila({
    codigo: coincidencia?.codigo || "",
    descripcion,
    cantidad: cantidadFinal,
    unidad: coincidencia?.unidad || "",
    precio,
    iva,
    stockTexto: coincidencia ? textoStock(coincidencia, cantidadFinal) : "No vinculado al catálogo",
    stockFuente: fuenteStock(coincidencia),
    stockCantidad: coincidencia?.stock ?? null,
    stockUnidad: coincidencia?.unidad || "",
    sinStock: Boolean(coincidencia && Number.isFinite(coincidencia.stock) && coincidencia.stock < cantidadFinal),
    entrega: coincidencia && Number.isFinite(coincidencia.stock) && coincidencia.stock < cantidadFinal ? "A confirmar" : "",
  });
  $("quote-status").textContent = !coincidencia
    ? "Artículo agregado desde voz. Completá precio e IVA y marcá si falta stock."
    : tieneGestion && !tieneNeto
      ? "Producto vinculado a Gestión. El precio de lista 1 incluye IVA; revisá el stock exportado y ajustá el precio si hace falta."
      : "Producto vinculado al catálogo local. Confirmá descripción, precio, IVA y disponibilidad.";
  $("presupuestos").scrollIntoView({ behavior: "smooth", block: "start" });
  fila.querySelector("input[aria-label='Artículo o descripción']").focus({ preventScroll: true });
}
