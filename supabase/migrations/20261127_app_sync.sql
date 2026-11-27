-- Ejecutar después de supabase/schema.sql en el SQL Editor.
-- Agrega guardado sincronizado y reemplazo transaccional del catálogo.

ALTER TABLE public.presupuestos
  ADD COLUMN IF NOT EXISTS contenido_borrador JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Los presupuestos son compartidos por el equipo: cualquier usuario autenticado
-- puede continuar un borrador abierto, pero no editar uno ya emitido.
DROP POLICY IF EXISTS presupuestos_update_own ON public.presupuestos;
DROP POLICY IF EXISTS presupuestos_update_drafts ON public.presupuestos;
CREATE POLICY presupuestos_update_drafts ON public.presupuestos FOR UPDATE TO authenticated
  USING (estado = 'borrador') WITH CHECK (estado = 'borrador');

DROP POLICY IF EXISTS detalle_presupuestos_insert_own ON public.detalle_presupuestos;
DROP POLICY IF EXISTS detalle_presupuestos_update_own ON public.detalle_presupuestos;
DROP POLICY IF EXISTS detalle_presupuestos_delete_own ON public.detalle_presupuestos;
DROP POLICY IF EXISTS detalle_presupuestos_insert_drafts ON public.detalle_presupuestos;
DROP POLICY IF EXISTS detalle_presupuestos_update_drafts ON public.detalle_presupuestos;
DROP POLICY IF EXISTS detalle_presupuestos_delete_drafts ON public.detalle_presupuestos;
CREATE POLICY detalle_presupuestos_insert_drafts ON public.detalle_presupuestos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.presupuestos p
    WHERE p.id = presupuesto_id AND p.estado = 'borrador'
  ));
CREATE POLICY detalle_presupuestos_update_drafts ON public.detalle_presupuestos FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.presupuestos p
    WHERE p.id = presupuesto_id AND p.estado = 'borrador'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.presupuestos p
    WHERE p.id = presupuesto_id AND p.estado = 'borrador'
  ));
CREATE POLICY detalle_presupuestos_delete_drafts ON public.detalle_presupuestos FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.presupuestos p
    WHERE p.id = presupuesto_id AND p.estado = 'borrador'
  ));

CREATE OR REPLACE FUNCTION public.reemplazar_catalogo(
  p_nombre_archivo TEXT,
  p_origen TEXT,
  p_deposito TEXT,
  p_corte_fuente TEXT,
  p_productos JSONB,
  p_omitidos INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_importacion_id UUID;
  v_cantidad INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede importar el catálogo';
  END IF;
  IF jsonb_typeof(p_productos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'La lista de productos debe ser un arreglo';
  END IF;
  IF jsonb_array_length(p_productos) < 1 OR jsonb_array_length(p_productos) > 10000 THEN
    RAISE EXCEPTION 'La importación debe tener entre 1 y 10000 productos';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_productos) AS x(codigo TEXT, nombre TEXT)
    WHERE NULLIF(BTRIM(x.codigo), '') IS NULL OR NULLIF(BTRIM(x.nombre), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Cada producto necesita código y descripción';
  END IF;
  IF EXISTS (
    SELECT BTRIM(x.codigo)
    FROM jsonb_to_recordset(p_productos) AS x(codigo TEXT)
    GROUP BY BTRIM(x.codigo)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'El archivo contiene códigos repetidos';
  END IF;

  UPDATE public.importaciones_catalogo
     SET estado = 'reemplazada'
   WHERE estado = 'actual';

  INSERT INTO public.importaciones_catalogo (
    nombre_archivo, origen, deposito, corte_fuente, productos_importados,
    productos_omitidos, estado, importado_por
  )
  VALUES (
    LEFT(COALESCE(NULLIF(BTRIM(p_nombre_archivo), ''), 'catalogo.csv'), 255),
    LEFT(COALESCE(NULLIF(BTRIM(p_origen), ''), 'CSV'), 100),
    NULLIF(LEFT(BTRIM(COALESCE(p_deposito, '')), 120), ''),
    NULLIF(LEFT(BTRIM(COALESCE(p_corte_fuente, '')), 120), ''),
    jsonb_array_length(p_productos), GREATEST(COALESCE(p_omitidos, 0), 0), 'actual', auth.uid()
  )
  RETURNING id INTO v_importacion_id;

  INSERT INTO public.productos (
    codigo, nombre, unidad, precio_sin_iva, iva_alicuota,
    precio_lista1_con_iva, codigo_iva, stock_gestion, estado_stock_gestion,
    deposito_gestion, corte_stock_gestion, origen_datos, importacion_id, activo
  )
  SELECT
    BTRIM(x.codigo), BTRIM(x.nombre), NULLIF(BTRIM(COALESCE(x.unidad, '')), ''),
    x.precio_sin_iva, x.iva_alicuota, x.precio_lista1_con_iva, x.codigo_iva,
    x.stock_gestion, x.estado_stock_gestion,
    COALESCE(NULLIF(BTRIM(x.deposito_gestion), ''), NULLIF(BTRIM(COALESCE(p_deposito, '')), '')),
    COALESCE(NULLIF(BTRIM(x.corte_stock_gestion), ''), NULLIF(BTRIM(COALESCE(p_corte_fuente, '')), '')),
    COALESCE(NULLIF(BTRIM(x.origen_datos), ''), NULLIF(BTRIM(COALESCE(p_origen, '')), '')),
    v_importacion_id, TRUE
  FROM jsonb_to_recordset(p_productos) AS x(
    codigo TEXT,
    nombre TEXT,
    unidad TEXT,
    precio_sin_iva NUMERIC,
    iva_alicuota NUMERIC,
    precio_lista1_con_iva NUMERIC,
    codigo_iva TEXT,
    stock_gestion NUMERIC,
    estado_stock_gestion TEXT,
    deposito_gestion TEXT,
    corte_stock_gestion TEXT,
    origen_datos TEXT
  )
  ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    unidad = EXCLUDED.unidad,
    precio_sin_iva = EXCLUDED.precio_sin_iva,
    iva_alicuota = EXCLUDED.iva_alicuota,
    precio_lista1_con_iva = EXCLUDED.precio_lista1_con_iva,
    codigo_iva = EXCLUDED.codigo_iva,
    stock_gestion = EXCLUDED.stock_gestion,
    estado_stock_gestion = EXCLUDED.estado_stock_gestion,
    deposito_gestion = EXCLUDED.deposito_gestion,
    corte_stock_gestion = EXCLUDED.corte_stock_gestion,
    origen_datos = EXCLUDED.origen_datos,
    importacion_id = EXCLUDED.importacion_id,
    activo = TRUE;
  GET DIAGNOSTICS v_cantidad = ROW_COUNT;

  INSERT INTO public.alias_productos (producto_id, alias, creado_por)
  SELECT DISTINCT ON (p.id, LOWER(BTRIM(x.alias))) p.id, BTRIM(x.alias), auth.uid()
  FROM jsonb_to_recordset(p_productos) AS x(codigo TEXT, alias TEXT)
  JOIN public.productos p ON p.codigo = BTRIM(x.codigo)
  WHERE NULLIF(BTRIM(COALESCE(x.alias, '')), '') IS NOT NULL
    AND CHAR_LENGTH(BTRIM(x.alias)) BETWEEN 2 AND 80
    AND NOT EXISTS (
      SELECT 1 FROM public.alias_productos a
      WHERE a.producto_id = p.id AND LOWER(a.alias) = LOWER(BTRIM(x.alias))
    )
  ORDER BY p.id, LOWER(BTRIM(x.alias));

  UPDATE public.productos
     SET activo = FALSE
   WHERE importacion_id IS NOT NULL
     AND importacion_id <> v_importacion_id
     AND activo = TRUE;

  RETURN jsonb_build_object('importacion_id', v_importacion_id, 'productos', v_cantidad);
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_presupuesto(p_borrador JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
  v_numero TEXT;
  v_items JSONB;
  v_total NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se necesita iniciar sesión';
  END IF;
  IF jsonb_typeof(p_borrador) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'El borrador no tiene un formato válido';
  END IF;

  v_id := COALESCE(NULLIF(p_borrador->>'id', '')::UUID, gen_random_uuid());
  v_numero := NULLIF(BTRIM(p_borrador->>'numero'), '');
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'El presupuesto necesita un número';
  END IF;
  v_items := COALESCE(p_borrador->'items_validos', '[]'::JSONB);
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) > 200 THEN
    RAISE EXCEPTION 'La lista de artículos no es válida';
  END IF;

  v_total := COALESCE(NULLIF(p_borrador->>'total', '')::NUMERIC, 0);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'El total no puede ser negativo';
  END IF;

  INSERT INTO public.presupuestos (
    id, numero, cliente, cuit_dni, contacto, vendedor, creado_por,
    fecha, valido_hasta, observaciones, estado, total, contenido_borrador, updated_at
  )
  VALUES (
    v_id, v_numero, LEFT(COALESCE(p_borrador->>'cliente', ''), 200),
    NULLIF(LEFT(COALESCE(p_borrador->>'cuit', ''), 40), ''),
    NULLIF(LEFT(COALESCE(p_borrador->>'contacto', ''), 200), ''),
    NULLIF(LEFT(COALESCE(p_borrador->>'vendedor', ''), 120), ''),
    auth.uid(),
    COALESCE(NULLIF(p_borrador->>'fecha', '')::DATE, CURRENT_DATE),
    NULLIF(p_borrador->>'validoHasta', '')::DATE,
    NULLIF(LEFT(COALESCE(p_borrador->>'observaciones', ''), 3000), ''),
    'borrador', v_total, p_borrador - 'items_validos', NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    numero = EXCLUDED.numero,
    cliente = EXCLUDED.cliente,
    cuit_dni = EXCLUDED.cuit_dni,
    contacto = EXCLUDED.contacto,
    vendedor = EXCLUDED.vendedor,
    fecha = EXCLUDED.fecha,
    valido_hasta = EXCLUDED.valido_hasta,
    observaciones = EXCLUDED.observaciones,
    total = EXCLUDED.total,
    contenido_borrador = EXCLUDED.contenido_borrador,
    updated_at = NOW()
  WHERE public.presupuestos.estado = 'borrador'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo guardar este presupuesto';
  END IF;

  DELETE FROM public.detalle_presupuestos WHERE presupuesto_id = v_id;

  INSERT INTO public.detalle_presupuestos (
    presupuesto_id, codigo_snapshot, descripcion_snapshot, cantidad, unidad,
    precio_unitario, iva_alicuota, precio_incluye_iva, subtotal,
    stock_gestion_snapshot, estado_stock_snapshot, faltante_interno, llegada_interna
  )
  SELECT
    v_id,
    LEFT(COALESCE(x.codigo, ''), 100),
    LEFT(x.descripcion, 300),
    x.cantidad,
    LEFT(COALESCE(x.unidad, ''), 50),
    x.precio,
    x.iva_alicuota,
    COALESCE(x.precio_incluye_iva, FALSE),
    x.subtotal,
    x.stock_gestion_snapshot,
    LEFT(COALESCE(x.estado_stock_snapshot, ''), 300),
    COALESCE(x.faltante_interno, FALSE),
    LEFT(COALESCE(x.llegada_interna, ''), 120)
  FROM jsonb_to_recordset(v_items) AS x(
    codigo TEXT,
    descripcion TEXT,
    cantidad NUMERIC,
    unidad TEXT,
    precio NUMERIC,
    iva_alicuota NUMERIC,
    precio_incluye_iva BOOLEAN,
    subtotal NUMERIC,
    stock_gestion_snapshot NUMERIC,
    estado_stock_snapshot TEXT,
    faltante_interno BOOLEAN,
    llegada_interna TEXT
  )
  WHERE NULLIF(BTRIM(x.descripcion), '') IS NOT NULL
    AND x.cantidad > 0
    AND x.precio >= 0
    AND x.subtotal >= 0;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vaciar_catalogo()
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_cantidad INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede vaciar el catálogo';
  END IF;

  UPDATE public.productos SET activo = FALSE WHERE activo = TRUE;
  GET DIAGNOSTICS v_cantidad = ROW_COUNT;
  UPDATE public.importaciones_catalogo SET estado = 'reemplazada' WHERE estado = 'actual';
  RETURN v_cantidad;
END;
$$;

REVOKE ALL ON FUNCTION public.reemplazar_catalogo(TEXT, TEXT, TEXT, TEXT, JSONB, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_presupuesto(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vaciar_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reemplazar_catalogo(TEXT, TEXT, TEXT, TEXT, JSONB, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_presupuesto(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vaciar_catalogo() TO authenticated;
