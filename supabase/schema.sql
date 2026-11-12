-- =====================================================================
-- Asistente IA para Ferretería — Esquema de Supabase (versión corregida)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es seguro correrlo en un proyecto NUEVO. No lo corras dos veces sin
-- antes borrar las tablas (usa CREATE TABLE sin IF NOT EXISTS a propósito,
-- para que un error te avise si algo ya existe).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONES
-- pg_trgm va en el schema "extensions" (convención de Supabase). Por eso
-- las funciones llaman a extensions.similarity() con nombre completo y
-- usan search_path = '' (sin atajos que alguien pueda secuestrar).
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- 1. USUARIOS (perfil ligado a Supabase Auth)
-- ---------------------------------------------------------------------
CREATE TABLE public.usuarios (
    id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT UNIQUE,
    nombre     TEXT,
    rol        TEXT NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('admin', 'vendedor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crea el perfil automáticamente cuando se crea un usuario en Auth.
-- Siempre entra como 'vendedor'; el primer admin se asigna a mano (ver final).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, rol)
  VALUES (NEW.id, NEW.email, 'vendedor');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper para las políticas RLS. SECURITY DEFINER evita la recursión
-- infinita al consultar "usuarios" desde una política de "usuarios".
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = (SELECT auth.uid()) AND u.rol = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- 2. CATÁLOGO
-- ---------------------------------------------------------------------
CREATE TABLE public.proveedores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              TEXT NOT NULL,
    telefono            TEXT,
    tiempo_entrega_dias INT NOT NULL DEFAULT 1 CHECK (tiempo_entrega_dias >= 0),
    activo              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.productos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_barras TEXT UNIQUE,
    nombre        TEXT NOT NULL,
    categoria     TEXT,
    stock_actual  INT NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo  INT NOT NULL DEFAULT 5 CHECK (stock_minimo >= 0),
    precio_venta  NUMERIC(10,2) NOT NULL CHECK (precio_venta >= 0),
    proveedor_id  UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
    activo        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Nombres coloquiales ("poxi", "poxipol", "tarugo del 8") → producto real.
CREATE TABLE public.alias_productos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL CHECK (char_length(alias) BETWEEN 2 AND 80),
    creado_por  UUID DEFAULT auth.uid() REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX alias_productos_unico ON public.alias_productos (producto_id, lower(alias));

CREATE TABLE public.precios_historicos (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id    UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    precio_viejo   NUMERIC(10,2),
    precio_nuevo   NUMERIC(10,2),
    modificado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    fecha          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registra solo cada cambio de precio, automáticamente.
CREATE OR REPLACE FUNCTION public.registrar_cambio_precio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.precio_venta IS DISTINCT FROM OLD.precio_venta THEN
    INSERT INTO public.precios_historicos (producto_id, precio_viejo, precio_nuevo, modificado_por)
    VALUES (NEW.id, OLD.precio_venta, NEW.precio_venta, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER productos_cambio_precio
  AFTER UPDATE OF precio_venta ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_cambio_precio();

-- ---------------------------------------------------------------------
-- 3. OPERACIONES: FALTANTES Y VENTAS
-- ---------------------------------------------------------------------
CREATE TABLE public.registro_faltantes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id          UUID NOT NULL DEFAULT auth.uid() REFERENCES public.usuarios(id),
    texto_original       TEXT NOT NULL CHECK (char_length(texto_original) <= 1000),
    producto_detectado   TEXT NOT NULL CHECK (char_length(producto_detectado) <= 200),
    medida_o_detalle     TEXT,
    producto_id          UUID REFERENCES public.productos(id) ON DELETE SET NULL, -- NULL si no hubo match
    confianza_match      NUMERIC(3,2) CHECK (confianza_match BETWEEN 0 AND 1),    -- similitud contra el catálogo
    confianza_ia         NUMERIC(3,2) CHECK (confianza_ia BETWEEN 0 AND 1),       -- confianza que informó Gemini
    cantidad_detectada   INT NOT NULL DEFAULT 1 CHECK (cantidad_detectada > 0),
    alternativa_ofrecida TEXT,
    alternativa_aceptada BOOLEAN,
    estado               TEXT NOT NULL DEFAULT 'borrador'
                         CHECK (estado IN ('borrador', 'aprobado', 'comprado', 'descartado')),
    fecha                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.ventas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id UUID NOT NULL REFERENCES public.usuarios(id),
    total       NUMERIC(12,2) NOT NULL DEFAULT 0,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.detalle_ventas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id        UUID NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES public.productos(id),
    cantidad        INT NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10,2) NOT NULL
);

-- Las ventas NO se insertan desde el cliente (podrían manipular precios).
-- Se registran con esta función: toma los precios de la base, valida y
-- descuenta el stock en una sola transacción.
-- Uso: select public.registrar_venta('[{"producto_id":"<uuid>","cantidad":2}]');
CREATE OR REPLACE FUNCTION public.registrar_venta(p_items JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_venta_id UUID;
  v_item     JSONB;
  v_prod     UUID;
  v_cant     INT;
  v_precio   NUMERIC(10,2);
  v_total    NUMERIC(12,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta necesita al menos un ítem';
  END IF;

  INSERT INTO public.ventas (vendedor_id) VALUES (auth.uid()) RETURNING id INTO v_venta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod := (v_item->>'producto_id')::UUID;
    v_cant := (v_item->>'cantidad')::INT;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod;
    END IF;

    UPDATE public.productos
       SET stock_actual = stock_actual - v_cant
     WHERE id = v_prod AND activo AND stock_actual >= v_cant
    RETURNING precio_venta INTO v_precio;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sin stock suficiente o producto inexistente: %', v_prod;
    END IF;

    INSERT INTO public.detalle_ventas (venta_id, producto_id, cantidad, precio_unitario)
    VALUES (v_venta_id, v_prod, v_cant, v_precio);

    v_total := v_total + v_precio * v_cant;
  END LOOP;

  UPDATE public.ventas SET total = v_total WHERE id = v_venta_id;
  RETURN v_venta_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. BÚSQUEDA DIFUSA: texto dictado → producto del catálogo
-- SECURITY INVOKER (por defecto): respeta el RLS de quien la llama.
-- Umbral por defecto 0.4. Devuelve hasta 3 candidatos; el frontend
-- SIEMPRE le pide confirmación al vendedor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_productos_similares(
    texto_busqueda TEXT,
    umbral         REAL DEFAULT 0.4,
    max_resultados INT  DEFAULT 3
)
RETURNS TABLE (producto_id UUID, nombre TEXT, similitud REAL)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT t.id, t.nombre, t.sim
  FROM (
    SELECT
      p.id,
      p.nombre,
      GREATEST(
        extensions.similarity(p.nombre, texto_busqueda),
        COALESCE((
          SELECT MAX(extensions.similarity(a.alias, texto_busqueda))
          FROM public.alias_productos a
          WHERE a.producto_id = p.id
        ), 0)
      )::REAL AS sim
    FROM public.productos p
    WHERE p.activo
  ) t
  WHERE t.sim >= umbral
  ORDER BY t.sim DESC, t.nombre
  LIMIT max_resultados;
$$;

-- Con miles de productos esto corre en milisegundos sin índice. Si algún día
-- el catálogo supera ~50.000 filas, recién ahí conviene un índice GIN y usar
-- el operador % en lugar de similarity() en el WHERE:
--   CREATE INDEX ON public.productos USING GIN (nombre extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 5. VISTA: pedidos sin stock vs. ventas (reporte de ventas perdidas)
-- Cada tabla se agrega por separado ANTES del join: así los números no
-- se multiplican. security_invoker = respeta el RLS del usuario.
-- ---------------------------------------------------------------------
CREATE VIEW public.reporte_ventas_vs_faltantes
WITH (security_invoker = true) AS
SELECT
  p.id                              AS producto_id,
  p.nombre,
  COALESCE(v.cantidad_vendida, 0)   AS cantidad_vendida,
  COALESCE(f.cantidad_faltante, 0)  AS cantidad_faltante,
  COALESCE(f.veces_pedido, 0)       AS veces_pedido
FROM public.productos p
LEFT JOIN (
  SELECT producto_id, SUM(cantidad)::BIGINT AS cantidad_vendida
  FROM public.detalle_ventas
  GROUP BY producto_id
) v ON v.producto_id = p.id
LEFT JOIN (
  SELECT producto_id, SUM(cantidad_detectada)::BIGINT AS cantidad_faltante, COUNT(*) AS veces_pedido
  FROM public.registro_faltantes
  WHERE estado IN ('aprobado', 'comprado') AND producto_id IS NOT NULL
  GROUP BY producto_id
) f ON f.producto_id = p.id;

-- ---------------------------------------------------------------------
-- 6. ÍNDICES
-- ---------------------------------------------------------------------
CREATE INDEX idx_faltantes_estado_fecha ON public.registro_faltantes (estado, fecha DESC);
CREATE INDEX idx_faltantes_producto     ON public.registro_faltantes (producto_id);
CREATE INDEX idx_faltantes_vendedor     ON public.registro_faltantes (vendedor_id);
CREATE INDEX idx_detalle_ventas_prod    ON public.detalle_ventas (producto_id);
CREATE INDEX idx_detalle_ventas_venta   ON public.detalle_ventas (venta_id);
CREATE INDEX idx_ventas_vendedor_fecha  ON public.ventas (vendedor_id, fecha DESC);
CREATE INDEX idx_productos_proveedor    ON public.productos (proveedor_id);
CREATE INDEX idx_alias_producto         ON public.alias_productos (producto_id);

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY — activado en TODAS las tablas
-- Regla general: el rol "anon" no ve nada; solo usuarios logueados.
-- ---------------------------------------------------------------------
ALTER TABLE public.usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alias_productos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_historicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registro_faltantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas     ENABLE ROW LEVEL SECURITY;

-- Usuarios: admin ve y gestiona todo; cada uno se lee a sí mismo.
-- Nadie (salvo admin) puede cambiar roles.
CREATE POLICY usuarios_admin_all  ON public.usuarios FOR ALL    TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());
CREATE POLICY usuarios_self_read  ON public.usuarios FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- Catálogo: todos los logueados leen, solo admin escribe.
CREATE POLICY productos_read   ON public.productos   FOR SELECT TO authenticated USING (true);
CREATE POLICY productos_admin  ON public.productos   FOR ALL    TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY proveedores_read  ON public.proveedores FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedores_admin ON public.proveedores FOR ALL    TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY precios_admin ON public.precios_historicos FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Alias: todos leen. El vendedor puede AGREGAR alias propios (así el
-- sistema aprende de sus correcciones) pero no editar ni borrar.
CREATE POLICY alias_read   ON public.alias_productos FOR SELECT TO authenticated USING (true);
CREATE POLICY alias_insert ON public.alias_productos FOR INSERT TO authenticated
  WITH CHECK (creado_por = (SELECT auth.uid()));
CREATE POLICY alias_admin  ON public.alias_productos FOR ALL    TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Faltantes:
--  · todos los logueados leen (para ver si un compañero ya lo anotó)
--  · el vendedor inserta solo a su nombre y solo como 'borrador'
--  · el vendedor edita SUS borradores y puede pasarlos a 'aprobado' o
--    'descartado'; una vez aprobado queda bloqueado (solo admin)
CREATE POLICY faltantes_read   ON public.registro_faltantes FOR SELECT TO authenticated USING (true);
CREATE POLICY faltantes_insert ON public.registro_faltantes FOR INSERT TO authenticated
  WITH CHECK (vendedor_id = (SELECT auth.uid()) AND estado = 'borrador');
CREATE POLICY faltantes_update ON public.registro_faltantes FOR UPDATE TO authenticated
  USING      (vendedor_id = (SELECT auth.uid()) AND estado = 'borrador')
  WITH CHECK (vendedor_id = (SELECT auth.uid()) AND estado IN ('borrador', 'aprobado', 'descartado'));
CREATE POLICY faltantes_admin  ON public.registro_faltantes FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Ventas: el vendedor solo LEE las suyas. No inserta directo: usa registrar_venta().
CREATE POLICY ventas_read_own ON public.ventas FOR SELECT TO authenticated
  USING (vendedor_id = (SELECT auth.uid()));
CREATE POLICY ventas_admin    ON public.ventas FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY detalle_read_own ON public.detalle_ventas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ventas v
    WHERE v.id = venta_id AND v.vendedor_id = (SELECT auth.uid())
  ));
CREATE POLICY detalle_admin    ON public.detalle_ventas FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ---------------------------------------------------------------------
-- 8. PERMISOS: el rol anónimo no toca nada; las funciones solo las
--    ejecutan usuarios logueados (por defecto Postgres las deja públicas).
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

REVOKE ALL ON FUNCTION public.handle_new_user()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_cambio_precio()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.es_admin()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_venta(JSONB)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buscar_productos_similares(TEXT, REAL, INT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.es_admin()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_venta(JSONB)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_productos_similares(TEXT, REAL, INT) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. PRIMER ADMIN (hacelo UNA vez, después de crear tu usuario en
--    Authentication → Users). Reemplazá el email y ejecutá solo esta línea:
-- ---------------------------------------------------------------------
-- UPDATE public.usuarios SET rol = 'admin' WHERE email = 'tu-email@ejemplo.com';
