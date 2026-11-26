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
2. Si pedís explícitamente un presupuesto por voz o texto, la IA crea un borrador con los productos y cantidades reconocidos. También podés agregar artículos del catálogo o escribir renglones manuales.
3. Revisá cantidades, precios, unidades e IVA. Los renglones agregados desde voz sin coincidencia exacta necesitan precio e IVA manuales.
4. Elegí **Imprimir / Guardar PDF**. El navegador permite imprimir o guardar el documento como PDF.

El navegador conserva un borrador activo, hasta 20 presupuestos anteriores y el catálogo en ese perfil local. Si la IA inicia otro y el borrador actual tiene datos, lo guarda en **Presupuestos anteriores**; desde ahí se puede volver a abrir. No se sincronizan con otros equipos. Exportá el catálogo para tener una copia. Este módulo no verifica stock, no descuenta existencias ni registra ventas.

La IA completa código, precio sin IVA e IVA solo si encuentra una coincidencia exacta de descripción en el catálogo. Si no la encuentra, dejá el precio y el IVA para revisión manual. Completá cliente y vendedor y revisá todo antes de imprimir. El PDF tiene líneas opcionales para aceptación manuscrita del cliente.
