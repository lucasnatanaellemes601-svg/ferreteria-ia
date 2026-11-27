const STORAGE_KEY = "ferreteria_auth_session_v1";
let config = null;
let session = null;
let refreshInFlight = null;

function leerSesion() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value?.access_token && value?.refresh_token ? value : null;
  } catch {
    return null;
  }
}

function guardarSesion(value) {
  if (!value?.access_token || !value?.refresh_token) {
    session = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return;
  }
  session = {
    ...value,
    expires_at: Number(value.expires_at) || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch {}
}

async function respuestaJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || data.error_description || data.error || `Error ${response.status}`);
    error.status = response.status;
    error.code = data.code || data.error_code || "";
    throw error;
  }
  return data;
}

async function authFetch(path, body, token = "") {
  const headers = { "Content-Type": "application/json", apikey: config.anonKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  return respuestaJson(response);
}

async function renovarSesion() {
  if (refreshInFlight) return refreshInFlight;
  if (!session?.refresh_token) throw new Error("La sesión venció. Volvé a iniciar sesión.");
  refreshInFlight = authFetch("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
    .then((value) => { guardarSesion(value); return session; })
    .catch((error) => { guardarSesion(null); throw error; })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function tokenVigente() {
  if (!session?.access_token) throw new Error("Iniciá sesión para continuar.");
  if (Number(session.expires_at) <= Math.floor(Date.now() / 1000) + 60) await renovarSesion();
  return session.access_token;
}

async function rest(path, { method = "GET", body, prefer, headers: extraHeaders = {}, reintentar = true } = {}) {
  const token = await tokenVigente();
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && reintentar) {
    await renovarSesion();
    return rest(path, { method, body, prefer, headers: extraHeaders, reintentar: false });
  }
  if (response.status === 204) return null;
  return respuestaJson(response);
}

export const supabase = {
  async initialize() {
    try {
      const response = await fetch("/api/supabase-config", { cache: "no-store" });
      const data = await respuestaJson(response);
      config = data.enabled && data.url && data.anonKey
        ? { url: data.url.replace(/\/+$/, ""), anonKey: data.anonKey }
        : null;
    } catch {
      config = null;
    }
    session = leerSesion();
    if (!config) { guardarSesion(null); return false; }
    if (session) {
      try { await tokenVigente(); }
      catch { guardarSesion(null); }
    }
    return true;
  },

  enabled() { return Boolean(config); },
  hasSession() { return Boolean(session?.access_token); },
  currentSession() { return session ? { user: session.user } : null; },
  accessToken: tokenVigente,

  async signIn(email, password) {
    const value = await authFetch("token?grant_type=password", { email, password });
    guardarSesion(value);
    return session;
  },

  async signOut() {
    const token = session?.access_token;
    try {
      if (config && token) {
        await fetch(`${config.url}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      guardarSesion(null);
    }
  },

  async getProfile() {
    const user = session?.user;
    if (!user?.id) throw new Error("No pude identificar al usuario de la sesión.");
    const rows = await rest(`usuarios?select=id,email,nombre,rol&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (!rows?.length) throw new Error("Falta el perfil del usuario. Revisá que se haya ejecutado el SQL inicial.");
    return rows[0];
  },

  async loadCatalog() {
    const columns = "id,codigo,nombre,unidad,precio_sin_iva,iva_alicuota,precio_lista1_con_iva,codigo_iva,stock_gestion,estado_stock_gestion,deposito_gestion,corte_stock_gestion,origen_datos,importacion_id";
    const result = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await rest(`productos?select=${columns}&activo=eq.true&order=codigo.asc&limit=1000&offset=${offset}`);
      result.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    const aliases = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await rest(`alias_productos?select=producto_id,alias&order=alias.asc&limit=1000&offset=${offset}`);
      aliases.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    const aliasPorProducto = new Map();
    for (const item of aliases) {
      if (!aliasPorProducto.has(item.producto_id)) aliasPorProducto.set(item.producto_id, []);
      aliasPorProducto.get(item.producto_id).push(item.alias);
    }
    for (const product of result) product.alias = (aliasPorProducto.get(product.id) || []).join(" ");
    const imports = await rest("importaciones_catalogo?select=nombre_archivo,origen,deposito,corte_fuente,productos_importados,importado_en&estado=eq.actual&limit=1");
    return { products: result, import: imports?.[0] || null };
  },

  async replaceCatalog(products, meta = {}, omitidos = 0) {
    return rest("rpc/reemplazar_catalogo", {
      method: "POST",
      body: {
        p_nombre_archivo: meta.nombreArchivo || "catalogo.csv",
        p_origen: meta.origen || "Gestión CSV",
        p_deposito: meta.deposito || "",
        p_corte_fuente: meta.corteFuente || "",
        p_omitidos: Number(omitidos) || 0,
        p_productos: products.map((p) => ({
          codigo: p.codigo,
          nombre: p.descripcion,
          alias: p.alias || "",
          unidad: p.unidad || "",
          precio_sin_iva: p.precioNeto,
          iva_alicuota: p.iva,
          precio_lista1_con_iva: p.precioLista1ConIva,
          codigo_iva: p.codigoIva || "",
          stock_gestion: p.stock,
          estado_stock_gestion: p.estadoStock || "",
          deposito_gestion: p.deposito || "",
          corte_stock_gestion: p.fechaStock || "",
          origen_datos: p.origen || "Gestión CSV",
        })),
      },
    });
  },

  async clearCatalog() {
    return rest("rpc/vaciar_catalogo", { method: "POST", body: {} });
  },

  async saveProduct(product) {
    const rows = await rest("productos?on_conflict=codigo", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        codigo: product.codigo,
        nombre: product.descripcion,
        unidad: product.unidad || "",
        precio_sin_iva: product.precioNeto,
        iva_alicuota: product.iva,
        precio_lista1_con_iva: product.precioLista1ConIva,
        codigo_iva: product.codigoIva || "",
        stock_gestion: product.stock,
        estado_stock_gestion: product.estadoStock || "",
        deposito_gestion: product.deposito || "",
        corte_stock_gestion: product.fechaStock || "",
        origen_datos: product.origen || "Carga manual",
        activo: true,
      }],
    });
    const saved = rows?.[0];
    if (saved && product.alias?.trim()) {
      const alias = product.alias.trim();
      const found = await rest(`alias_productos?select=alias&producto_id=eq.${encodeURIComponent(saved.id)}`);
      const alreadyExists = (found || []).some((item) => String(item.alias).toLowerCase() === alias.toLowerCase());
      if (!alreadyExists) {
        await rest("alias_productos", {
          method: "POST", body: [{ producto_id: saved.id, alias }],
        });
      }
    }
    return saved;
  },

  async deleteProduct(codigo) {
    return rest(`productos?codigo=eq.${encodeURIComponent(codigo)}`, { method: "DELETE" });
  },

  async saveQuote(draft) {
    const itemsValidos = (Array.isArray(draft.items) ? draft.items : []).flatMap((item) => {
      const cantidad = Number(item?.cantidad);
      const precio = Number(item?.precio);
      const incluido = item?.iva === "INCLUIDO_GESTION";
      const iva = incluido ? null : Number(item?.iva);
      if (!String(item?.descripcion || "").trim() || !String(item?.cantidad ?? "").trim() ||
          !String(item?.precio ?? "").trim() || !String(item?.iva ?? "").trim() ||
          !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0 ||
          (!incluido && !Number.isFinite(iva))) return [];
      const base = Math.round((cantidad * precio + Number.EPSILON) * 100) / 100;
      const impuesto = incluido ? 0 : Math.round((base * iva / 100 + Number.EPSILON) * 100) / 100;
      const stock = item.stockCantidad === null || item.stockCantidad === "" ? null : Number(item.stockCantidad);
      return [{
        codigo: item.codigo || "",
        descripcion: item.descripcion,
        cantidad,
        unidad: item.unidad || "",
        precio,
        iva_alicuota: iva,
        precio_incluye_iva: incluido,
        subtotal: base + impuesto,
        stock_gestion_snapshot: Number.isFinite(stock) ? stock : null,
        estado_stock_snapshot: item.stockTexto || "",
        faltante_interno: Boolean(item.sinStock),
        llegada_interna: item.entrega || "",
      }];
    });
    return rest("rpc/guardar_presupuesto", {
      method: "POST",
      body: { p_borrador: { ...draft, items_validos: itemsValidos } },
    });
  },

  async loadQuotes() {
    return rest("presupuestos?select=id,numero,cliente,created_at,updated_at,contenido_borrador&order=updated_at.desc&limit=100");
  },
};
