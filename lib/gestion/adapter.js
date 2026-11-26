// Punto de integración reservado para el sistema Gestión.
// Este módulo no hace requests de red: el conector queda bloqueado hasta conocer
// la API oficial, su autenticación y el mapeo de productos e impuestos.

const ADAPTADOR_IMPLEMENTADO = false;

export function estadoGestion(env = process.env) {
  const solicitado = env.GESTION_ENABLED === "true";
  const baseUrlConfigurada = Boolean(env.GESTION_API_BASE_URL?.trim());
  const tokenConfigurado = Boolean(env.GESTION_API_TOKEN?.trim());
  const credencialesConfiguradas = baseUrlConfigurada && tokenConfigurado;

  return Object.freeze({
    habilitado: ADAPTADOR_IMPLEMENTADO && solicitado && credencialesConfiguradas,
    solicitado,
    adaptadorImplementado: ADAPTADOR_IMPLEMENTADO,
    baseUrlConfigurada,
    tokenConfigurado,
    credencialesConfiguradas,
    motivo: ADAPTADOR_IMPLEMENTADO ? null : "conector_pendiente_de_documentacion_y_revisiones",
  });
}

// Solo para módulos de servidor cuando se implemente el adaptador.
// Nunca devolver este objeto a una respuesta HTTP ni importarlo desde public/.
export function leerConfiguracionGestion(env = process.env) {
  return Object.freeze({
    baseUrl: env.GESTION_API_BASE_URL?.trim() || "",
    token: env.GESTION_API_TOKEN || "",
    timeoutMs: Math.min(30000, Math.max(1000, Number(env.GESTION_API_TIMEOUT_MS) || 8000)),
  });
}

function integracionDesactivada() {
  const error = new Error("La integración con Gestión está desactivada y todavía no tiene un adaptador implementado.");
  error.code = "gestion_integracion_deshabilitada";
  throw error;
}

// Contrato previsto. Todas las operaciones fallan cerradas; ninguna accede a la red.
export const gestionAdapter = Object.freeze({
  estado: estadoGestion,
  buscarProductos: integracionDesactivada,
  consultarPrecio: integracionDesactivada,
  consultarStock: integracionDesactivada,
  crearPresupuesto: integracionDesactivada,
});
