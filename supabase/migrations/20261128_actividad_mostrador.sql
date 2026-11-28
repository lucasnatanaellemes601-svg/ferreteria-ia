-- Registro compartido de la actividad del mostrador.
-- No toca el inventario ni llama a Gestión: guarda una foto del stock importado.

CREATE TABLE IF NOT EXISTS public.actividades_mostrador (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id        UUID NOT NULL REFERENCES public.usuarios(id),
  vendedor_nombre    TEXT NOT NULL DEFAULT 'Vendedor',
  origen             TEXT NOT NULL CHECK (origen IN ('audio', 'texto', 'manual')),
  texto_original     TEXT NOT NULL DEFAULT '' CHECK (char_length(texto_original) <= 1000),
  solicita_presupuesto BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.detalle_actividades_mostrador (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id          UUID NOT NULL REFERENCES public.actividades_mostrador(id) ON DELETE CASCADE,
  orden                 SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 20),
  producto_id           UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  codigo_snapshot       TEXT NOT NULL DEFAULT '',
  descripcion_snapshot  TEXT NOT NULL CHECK (char_length(descripcion_snapshot) BETWEEN 1 AND 200),
  cantidad              NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  unidad                TEXT NOT NULL DEFAULT '',
  intencion_ia          TEXT NOT NULL CHECK (intencion_ia IN ('CONSULTA', 'VENTA', 'FALTANTE')),
  estado                TEXT NOT NULL CHECK (estado IN (
                          'consulta', 'presupuesto', 'disponible_confirmado', 'venta_pendiente', 'venta_confirmada',
                          'faltante_pendiente', 'faltante_confirmado', 'descartado'
                        )),
  similitud_match       REAL CHECK (similitud_match BETWEEN 0 AND 1),
  stock_gestion_snapshot NUMERIC(12,2),
  stock_estado_snapshot TEXT,
  precio_snapshot       NUMERIC(12,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actividad_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_actividades_mostrador_fecha
  ON public.actividades_mostrador (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actividades_mostrador_vendedor_fecha
  ON public.actividades_mostrador (vendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detalle_actividades_estado
  ON public.detalle_actividades_mostrador (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detalle_actividades_producto
  ON public.detalle_actividades_mostrador (producto_id, created_at DESC);

ALTER TABLE public.actividades_mostrador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_actividades_mostrador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actividades_mostrador_read ON public.actividades_mostrador;
CREATE POLICY actividades_mostrador_read ON public.actividades_mostrador
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS detalle_actividades_mostrador_read ON public.detalle_actividades_mostrador;
CREATE POLICY detalle_actividades_mostrador_read ON public.detalle_actividades_mostrador
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.actividades_mostrador, public.detalle_actividades_mostrador FROM anon, authenticated;
GRANT SELECT ON public.actividades_mostrador, public.detalle_actividades_mostrador TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_actividad_mostrador(p_evento JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actividad_id UUID;
  v_item JSONB;
  v_orden INT;
  v_items JSONB;
  v_intencion TEXT;
  v_estado TEXT;
  v_descripcion TEXT;
  v_producto_id UUID;
  v_codigo TEXT;
  v_unidad TEXT;
  v_stock NUMERIC(12,2);
  v_stock_estado TEXT;
  v_precio NUMERIC(12,2);
  v_cantidad NUMERIC(12,2);
  v_similitud REAL;
  v_presupuesto BOOLEAN;
  v_origen TEXT;
  v_texto TEXT;
  v_nombre TEXT;
  v_ids JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se necesita iniciar sesión';
  END IF;
  IF jsonb_typeof(p_evento) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La actividad no tiene un formato válido';
  END IF;

  v_items := COALESCE(p_evento->'items', '[]'::JSONB);
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) > 20 THEN
    RAISE EXCEPTION 'La lista de artículos no es válida';
  END IF;

  v_origen := COALESCE(p_evento->>'origen', 'texto');
  IF v_origen NOT IN ('audio', 'texto', 'manual') THEN
    RAISE EXCEPTION 'El origen de la actividad no es válido';
  END IF;
  v_texto := LEFT(COALESCE(p_evento->>'texto', ''), 1000);
  v_presupuesto := COALESCE((p_evento->>'solicita_presupuesto')::BOOLEAN, FALSE);

  SELECT COALESCE(NULLIF(BTRIM(u.nombre), ''), NULLIF(u.email, ''), 'Vendedor')
    INTO v_nombre
    FROM public.usuarios u
   WHERE u.id = auth.uid();
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'No existe el perfil del usuario';
  END IF;

  INSERT INTO public.actividades_mostrador (
    vendedor_id, vendedor_nombre, origen, texto_original, solicita_presupuesto
  ) VALUES (
    auth.uid(), LEFT(v_nombre, 120), v_origen, v_texto, v_presupuesto
  ) RETURNING id INTO v_actividad_id;

  FOR v_item, v_orden IN
    SELECT e.value, e.ordinality::INT
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    v_intencion := COALESCE(v_item->>'intencion_ia', 'CONSULTA');
    IF v_intencion NOT IN ('CONSULTA', 'VENTA', 'FALTANTE') THEN
      RAISE EXCEPTION 'La intención de un artículo no es válida';
    END IF;
    v_descripcion := LEFT(BTRIM(COALESCE(v_item->>'descripcion', '')), 200);
    IF v_descripcion = '' THEN
      RAISE EXCEPTION 'Cada artículo necesita una descripción';
    END IF;
    v_cantidad := COALESCE(NULLIF(v_item->>'cantidad', '')::NUMERIC, 1);
    IF v_cantidad <= 0 OR v_cantidad > 1000000 THEN
      RAISE EXCEPTION 'La cantidad de un artículo no es válida';
    END IF;
    v_similitud := NULLIF(v_item->>'similitud', '')::REAL;
    v_producto_id := NULLIF(v_item->>'producto_id', '')::UUID;
    v_codigo := '';
    v_unidad := LEFT(COALESCE(v_item->>'unidad', ''), 50);
    v_stock := NULL;
    v_stock_estado := NULL;
    v_precio := NULL;

    IF v_producto_id IS NOT NULL THEN
      SELECT p.codigo, p.unidad, p.stock_gestion, p.estado_stock_gestion, p.precio_lista1_con_iva
        INTO v_codigo, v_unidad, v_stock, v_stock_estado, v_precio
        FROM public.productos p
       WHERE p.id = v_producto_id AND p.activo = TRUE;
      IF NOT FOUND THEN
        v_producto_id := NULL;
        v_codigo := '';
        v_stock := NULL;
        v_stock_estado := NULL;
        v_precio := NULL;
      END IF;
    END IF;

    IF v_presupuesto THEN
      v_estado := 'presupuesto';
    ELSIF v_intencion = 'VENTA' THEN
      v_estado := 'venta_pendiente';
    ELSIF v_intencion = 'FALTANTE' THEN
      v_estado := 'faltante_pendiente';
    ELSE
      v_estado := 'consulta';
    END IF;

    INSERT INTO public.detalle_actividades_mostrador (
      actividad_id, orden, producto_id, codigo_snapshot, descripcion_snapshot,
      cantidad, unidad, intencion_ia, estado, similitud_match,
      stock_gestion_snapshot, stock_estado_snapshot, precio_snapshot
    ) VALUES (
      v_actividad_id, v_orden, v_producto_id, COALESCE(v_codigo, ''), v_descripcion,
      v_cantidad, COALESCE(v_unidad, ''), v_intencion, v_estado, v_similitud,
      v_stock, v_stock_estado, v_precio
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id) ORDER BY d.orden), '[]'::JSONB)
    INTO v_ids
    FROM public.detalle_actividades_mostrador d
   WHERE d.actividad_id = v_actividad_id;

  RETURN jsonb_build_object('actividad_id', v_actividad_id, 'items', v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_estado_actividad_item(p_item_id UUID, p_estado TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se necesita iniciar sesión';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('consulta', 'disponible_confirmado', 'venta_confirmada', 'faltante_confirmado', 'descartado') THEN
    RAISE EXCEPTION 'El estado solicitado no es válido';
  END IF;

  UPDATE public.detalle_actividades_mostrador
     SET estado = p_estado
   WHERE id = p_item_id AND estado <> 'presupuesto'
  RETURNING estado INTO v_estado;

  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'No se encontró el artículo o es parte de un presupuesto';
  END IF;
  RETURN v_estado;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_actividad_mostrador(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_estado_actividad_item(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_actividad_mostrador(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_actividad_item(UUID, TEXT) TO authenticated;
