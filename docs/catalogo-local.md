# Usar presupuestos sin Gestión

El módulo funciona con el catálogo local del navegador, sin conexión a Gestión.

## Cargar productos

1. Abrí **Armar presupuesto** y luego **Administrar catálogo local**.
2. Podés completar un producto a mano o usar **Descargar formato CSV**.
3. El CSV usa punto y coma y estas columnas: `codigo;descripcion;unidad;precio_sin_iva;iva`.
4. Completá el precio **sin IVA** y la alícuota (0, 2.5, 5, 10.5, 21 o 27). Con coma decimal, por ejemplo `1250,50`.
5. Importá el archivo. Un código repetido actualiza el producto existente.

Si Gestión permite exportar artículos, copiá sus datos a estas columnas y confirmá antes si sus precios incluyen IVA. El importador no puede inferir eso con seguridad.

## Armar e imprimir

1. Abrí el presupuesto y completá cliente, vendedor y vigencia.
2. Buscá los artículos en el catálogo local y agregalos. También podés escribir renglones manuales o sumar una consulta reconocida por voz.
3. Revisá cantidades, precios, unidades e IVA. Los renglones agregados desde voz sin coincidencia exacta necesitan precio e IVA manuales.
4. Elegí **Imprimir / Guardar PDF**. El navegador permite imprimir o guardar el documento como PDF.

El navegador conserva un solo borrador activo y el catálogo en ese perfil local. No se sincronizan con otros equipos. Exportá el catálogo para tener una copia; guardá cada presupuesto como PDF antes de iniciar otro. Este módulo no verifica stock, no descuenta existencias ni registra ventas.
