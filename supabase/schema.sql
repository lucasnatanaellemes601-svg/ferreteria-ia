CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    rol TEXT CHECK (rol IN ('admin', 'vendedor')) DEFAULT 'vendedor',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' 
AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, rol)
  VALUES (new.id, new.email, 'vendedor');
  RETURN new;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN 
LANGUAGE sql SECURITY DEFINER SET search_path = '' 
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios WHERE id = auth.uid() AND rol = 'admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.es_admin() FROM public, anon;

CREATE TABLE public.proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    telefono TEXT,
    tiempo_entrega_dias INT DEFAULT 1,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE public.productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_barras TEXT UNIQUE,
    nombre TEXT NOT NULL,
    categoria TEXT,
    stock_actual INT DEFAULT 0 NOT NULL,
    stock_minimo INT DEFAULT 5 NOT NULL,
    precio_venta DECIMAL(10,2) NOT NULL,
    proveedor_id UUID REFERENCES public.proveedores(id),
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE public.alias_productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID REFERENCES public.productos(id) ON DELETE CASCADE,
    alias TEXT NOT NULL
);

CREATE TABLE public.precios_historicos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID REFERENCES public.productos(id) ON DELETE CASCADE,
    precio_viejo DECIMAL(10,2),
    precio_nuevo DECIMAL(10,2),
    modificado_por UUID REFERENCES public.usuarios(id),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.registro_faltantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id UUID REFERENCES public.usuarios(id) NOT NULL,
    texto_original TEXT NOT NULL,
    producto_detectado TEXT NOT NULL,
    producto_id UUID REFERENCES public.productos(id),
    confianza_match DECIMAL(3,2),
    cantidad_detectada INT DEFAULT 1,
    estado TEXT CHECK (estado IN ('borrador', 'aprobado', 'comprado', 'descartado')) DEFAULT 'borrador',
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.ventas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendedor_id UUID REFERENCES public.usuarios(id) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.detalle_ventas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id UUID REFERENCES public.ventas(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES public.productos(id) NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL
);

CREATE OR REPLACE FUNCTION public.buscar_productos_similares(texto_busqueda TEXT)
RETURNS TABLE (
    resultado_id UUID,
    resultado_nombre TEXT,
    puntaje_similitud REAL
) 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS resultado_id, 
    p.nombre AS resultado_nombre, 
    GREATEST(similarity(p.nombre, texto_busqueda), COALESCE(MAX(similarity(a.alias, texto_busqueda)), 0)) AS puntaje_similitud
  FROM public.productos p
  LEFT JOIN public.alias_productos a ON p.id = a.producto_id
  GROUP BY p.id, p.nombre
  HAVING GREATEST(similarity(p.nombre, texto_busqueda), COALESCE(MAX(similarity(a.alias, texto_busqueda)), 0)) > 0.4
  ORDER BY puntaje_similitud DESC
  LIMIT 3;
END;
$$;

CREATE OR REPLACE VIEW public.reporte_ventas_vs_faltantes WITH (security_invoker = true) AS
WITH ventas_agrupadas AS (
    SELECT producto_id, SUM(cantidad) AS total_vendido FROM public.detalle_ventas GROUP BY producto_id
),
faltantes_agrupados AS (
    SELECT producto_id, SUM(cantidad_detectada) AS total_perdido FROM public.registro_faltantes WHERE estado = 'aprobado' GROUP BY producto_id
)
SELECT 
    p.id,
    p.nombre,
    COALESCE(v.total_vendido, 0) AS cantidad_vendida,
    COALESCE(f.total_perdido, 0) AS cantidad_perdida_por_falta
FROM public.productos p
LEFT JOIN ventas_agrupadas v ON p.id = v.producto_id
LEFT JOIN faltantes_agrupados f ON p.id = f.producto_id;

CREATE INDEX idx_productos_nombre_trgm ON public.productos USING GIN (nombre gin_trgm_ops);
CREATE INDEX idx_alias_trgm ON public.alias_productos USING GIN (alias gin_trgm_ops);
CREATE INDEX idx_faltantes_estado_fecha ON public.registro_faltantes(estado, fecha);

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alias_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_historicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registro_faltantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin ve usuarios" ON public.usuarios FOR ALL USING (public.es_admin());
CREATE POLICY "Vendedor se lee a sí mismo" ON public.usuarios FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Lectura catalogo todos" ON public.productos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Escritura catalogo admin" ON public.productos FOR ALL USING (public.es_admin());
CREATE POLICY "Lectura proveedores todos" ON public.proveedores FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Escritura proveedores admin" ON public.proveedores FOR ALL USING (public.es_admin());
CREATE POLICY "Lectura alias" ON public.alias_productos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Vendedor puede agregar alias" ON public.alias_productos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Vendedores insertan faltantes" ON public.registro_faltantes FOR INSERT WITH CHECK (auth.uid() = vendedor_id);
CREATE POLICY "Vendedores aprueban sus borradores" ON public.registro_faltantes FOR UPDATE USING (auth.uid() = vendedor_id AND estado = 'borrador') WITH CHECK (estado IN ('borrador', 'aprobado'));
CREATE POLICY "Admin ve y edita todos los faltantes" ON public.registro_faltantes FOR ALL USING (public.es_admin());
CREATE POLICY "Vendedores ven todos los faltantes" ON public.registro_faltantes FOR SELECT USING (auth.uid() IS NOT NULL);