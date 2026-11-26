# Usar presupuestos sin Gestión

El módulo funciona con el catálogo local del navegador, sin conexión a Gestión.

## Cargar productos

1. Abrí **Armar presupuesto** y luego **Administrar catálogo local**.
2. Podés completar un producto a mano o usar **Descargar formato CSV**.
3. El CSV usa punto y coma y estas columnas: `codigo;descripcion;unidad;precio_sin_iva;iva`.
4. Completá el precio **sin IVA** y la alícuota (0, 2.5, 5, 10.5, 21 o 27). Con coma decimal, por ejemplo `1250,50`.
5. Importá el archivo. Un código repetido actualiza el producto existente.

Si Gestión permite exportar artículos, copiá sus datos a estas columnas y confirmá antes si sus precios incluyen IVA. El importador no puede inferir eso con seguridad.

## Importar el stock de Gestión

El catálogo también acepta un CSV exportado desde Gestión con las columnas `codigo`, `descripcion`, `alias`, `unidad`, `stock`, `estado_stock`, `precio_lista1_con_iva`, `codigo_iva`, `deposito` y `fecha_stock`. El archivo preparado a partir del Excel carga 6.449 fichas; deja afuera cinco renglones de stock sin artículo asociado.

El precio de lista 1 se conserva como importe final con IVA incluido para no volver a sumarlo. El Excel informa el código interno `CIVA`, pero no su equivalencia a una alícuota; por eso el presupuesto muestra ese precio sin separar el impuesto. Si luego se confirma la tabla de códigos de IVA, se podrá agregar el desglose.

El stock es una foto del depósito Oberá al momento de exportar, 26/11/2026 15:12. Una cantidad cero o negativa marca faltante; una cantidad negativa también queda identificada como inconsistencia de stock para revisar. Las fichas sin fila de stock se muestran como “Stock no informado”, no como cero. Si la cantidad disponible no alcanza para lo pedido, el presupuesto marca el faltante y deja “A confirmar” en llegada; el vendedor puede reemplazarlo por una fecha o aclarar que no ingresa. El archivo no sincroniza con Gestión en vivo.

## Armar e imprimir

1. Abrí el presupuesto y completá cliente, vendedor y vigencia.
2. Si pedís explícitamente un presupuesto por voz o texto, la IA crea un borrador con los productos y cantidades reconocidos. También podés agregar artículos del catálogo o escribir renglones manuales.
3. Revisá cantidades, precios, unidades e IVA. Los renglones agregados desde voz sin coincidencia exacta necesitan precio e IVA manuales.
4. Elegí **Imprimir / Guardar PDF**. El navegador permite imprimir o guardar el documento como PDF.

El navegador conserva un borrador activo, hasta 20 presupuestos anteriores y el catálogo en ese perfil local. Si la IA inicia otro y el borrador actual tiene datos, lo guarda en **Presupuestos anteriores**; desde ahí se puede volver a abrir. No se sincronizan con otros equipos. Exportá el catálogo para tener una copia. El módulo usa el corte de stock importado, pero no consulta Gestión en vivo, no descuenta existencias ni registra ventas.

La IA vincula un producto solo cuando encuentra una coincidencia única por descripción en el catálogo. Los artículos del Excel usan el precio final de lista 1 con IVA incluido; los artículos cargados a mano usan precio neto y alícuota. Si no hay coincidencia, completá código, precio e IVA manualmente. Completá cliente y vendedor y revisá todo antes de imprimir. El PDF tiene líneas opcionales para aceptación manuscrita del cliente.
