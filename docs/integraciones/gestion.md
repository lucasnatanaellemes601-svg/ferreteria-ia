# Integración futura con Gestión

## Estado actual

La integración está preparada como punto de extensión, pero permanece bloqueada en el código. No hay botones conectados, rutas de API de Gestión ni llamadas de red. Poner una URL o un token en el entorno no la activa.

Variables reservadas en `.env.example`:

```env
GESTION_ENABLED=false
GESTION_API_BASE_URL=
GESTION_API_TOKEN=
GESTION_API_TIMEOUT_MS=8000
```

No poner tokens en `public/app.js`, HTML, repositorio, capturas ni respuestas del servidor. Para el futuro, guardarlos solo como variables de entorno del servidor en `.env.local` o Vercel.

El límite del adaptador está en `lib/gestion/adapter.js`. Tiene un contrato inicial para buscar productos, consultar precio y stock, y eventualmente crear presupuestos. Por ahora todas las operaciones responden con `gestion_integracion_deshabilitada` y no usan `fetch` ni otros clientes de red.

## Qué necesitamos antes de conectar

Una llave no alcanza por sí sola. Hace falta confirmar que la instalación de Gestión ofrece una API accesible y obtener:

- Nombre del proveedor, producto y versión instalada.
- Documentación oficial de la API o especificación OpenAPI.
- URL base accesible desde el entorno donde se desplegará la app.
- Método de autenticación, formato del token y permisos disponibles.
- Endpoints de lectura para código, descripción, unidad, precio, IVA, depósito y stock.
- Definición de si los precios informados incluyen IVA y cómo representa Gestión cada alícuota.
- Si existe, endpoint para guardar presupuestos; no asumir que registrar una venta equivale a crear una cotización.
- Entorno de prueba y límites de uso.

El acceso a una carpeta compartida de Windows, un ejecutable o una DLL de base de datos no demuestra que exista una API HTTP ni define cómo usarla. No conectar directamente a la base de producción sin documentación y autorización del proveedor.

## Secuencia prevista

1. Implementar autenticación y consultas de solo lectura en servidor.
2. Mapear la respuesta de Gestión al contrato normalizado de productos de Ferretería-IA.
3. Probar coincidencias, precios, IVA y stock contra un entorno de prueba y revisar los resultados en mostrador.
4. Habilitar la lectura con una bandera explícita después de verificar el adaptador.
5. Evaluar escritura de presupuestos solo si la API oficial la soporta. Mantener ventas, caja y stock fuera de alcance hasta acordar el flujo y validar permisos.
