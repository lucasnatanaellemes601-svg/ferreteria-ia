# Asistente IA para Ferretería

Herramienta de mostrador. El vendedor mantiene apretado un botón (**push-to-talk**), dicta lo que pasó
("no hay mechas de widia del 6, le di del 8 y se la llevó") y la IA lo convierte en una lista de
productos clasificados como **faltante**, **venta** o **consulta**. El vendedor revisa; la IA nunca
toca stock ni precios por su cuenta.

> Estado: piloto de mostrador con conexión opcional a Supabase para usuarios, catálogo y presupuestos.
> No registra ventas ni modifica stock; la integración con Gestión sigue pendiente.

## Qué hay en la carpeta

```
ferreteria-ia/
├─ public/
│  ├─ index.html          Pantalla del mostrador (dictado, resultados y presupuesto)
│  ├─ app.js              Lógica del navegador (sin dependencias)
│  ├─ presupuesto.js      Borrador, totalización y artículos desde consultas
│  ├─ presupuesto.css     Estilos de pantalla e impresión
│  └─ assets/ferrmel-logo.png Logo usado en el presupuesto
├─ api/
│  └─ procesar.js         Función serverless: Gemini + validación (+ catálogo en la Fase 2)
├─ lib/
│  ├─ prompt.js           Prompt de sistema con jerga ferretera y ejemplos
│  ├─ schema.js           Esquema de salida de Gemini + validación con Zod
│  └─ gestion/adapter.js  Punto de integración bloqueado para Gestión
├─ docs/
│  ├─ catalogo-local.md   Carga de productos para presupuestar sin Gestión
│  └─ integraciones/gestion.md  Requisitos para la futura API
├─ supabase/
│  ├─ schema.sql          Esquema base de Supabase.
│  └─ migrations/
│     └─ 20261127_app_sync.sql  Sincronización del catálogo y presupuestos.
├─ .cursor/rules/
│  └─ ferreteria.mdc      Contexto fijo para Cursor
├─ .env.example           Variables de entorno (copiar a .env.local)
├─ vercel.json            Timeout de la función y headers de seguridad
└─ package.json
```

## Presupuestos (piloto)

La pantalla permite armar e imprimir un presupuesto con logo, datos del cliente, artículos, IVA, totales, condiciones y estado interno de stock. Ante un pedido explícito, la IA arma el borrador con los productos y cantidades reconocidos.

Sin Supabase, el catálogo y el borrador activo quedan en el navegador. Con Supabase configurado, el catálogo y los presupuestos se comparten entre el personal que inició sesión. Exportá una copia del catálogo periódicamente. Cada presupuesto debe revisarse antes de imprimir; el módulo no registra ventas ni modifica stock.

Instrucciones de carga inicial: `docs/catalogo-local.md`.

Si el vendedor pide explícitamente un presupuesto por voz o texto, la app crea un borrador nuevo con los productos y cantidades reconocidos. Vincula un artículo solo si encuentra una coincidencia única en el catálogo; los renglones sin coincidencia quedan para completar y revisar. Con los datos importados de Gestión puede cargar el código, el stock y el precio de lista 1 con IVA incluido. Ese precio se usa como importe final para no sumar el impuesto dos veces; la tasa CIVA no se desglosa hasta tener su equivalencia. Si ya había un borrador con datos, lo conserva en **Presupuestos anteriores**. El cliente, el vendedor y los precios deben revisarse antes de imprimir.

El PDF incluye una aceptación opcional para firma manuscrita del cliente. El nombre de FERRMEL y el vendedor identifican a quien emite la propuesta; no se agrega una firma digital de la ferretería.

## Gestión

El punto de extensión y las variables de entorno están reservados en `lib/gestion/adapter.js` y `.env.example`. El adaptador está forzado a desactivado y no hace solicitudes de red. Revisá `docs/integraciones/gestion.md` antes de cargar credenciales: una llave sola no alcanza sin la URL, el método de autenticación y la documentación de la API oficial.

## Puesta en marcha (Fase 1, unos 30 minutos)

**1. Requisitos:** Node.js 20 o más, Git, Cursor, y cuentas gratuitas de GitHub, Vercel y
[Google AI Studio](https://aistudio.google.com/apikey).

**2. Abrí la carpeta en Cursor** y, en la terminal:

```bash
npm install
cp .env.example .env.local
```

**3. Completá `.env.local`** (este archivo nunca se sube a GitHub):

| Variable | Qué poner |
|---|---|
| `GEMINI_API_KEY` | La clave de Google AI Studio |
| `GEMINI_MODEL` | Un modelo Flash vigente. Confirmá el nombre en la [doc de modelos](https://ai.google.dev/gemini-api/docs/models): cambia seguido |
| `APP_PIN` | Un PIN largo que inventes vos. Protege tu cuota de Gemini |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Vacías para usar solo el piloto local; ambas completas para activar login y sincronización |

**4. Probalo en tu compu:**

```bash
npm install -g vercel     # una sola vez
vercel login
vercel link               # crea el proyecto en Vercel
npm run dev               # abre http://localhost:3000
```

Usá **Chrome o Edge**. La primera vez pide el PIN y el permiso del micrófono. Si no tenés micrófono a
mano, abrí "Escribir en lugar de hablar" y pegá frases de prueba.

**5. Subilo a GitHub y a Vercel:**

```bash
git init && git add . && git commit -m "Piloto inicial"
# Creá un repo PRIVADO en GitHub y seguí las instrucciones para hacer push
```

En Vercel: *Add New → Project → importá el repo* y cargá las mismas variables en
*Settings → Environment Variables*. Desde ahí, cada `git push` a `main` se despliega solo.

## Cómo medir el piloto

1. Dictá (o escribí) **al menos 30 frases reales** de mostrador, variadas: varios productos en una
   frase, alternativas rechazadas, nombres mal dichos, charla sin interés.
2. En cada resultado tocá **✔ Sí** o **✘ No**. Tocar de nuevo deshace.
3. El panel "Medición del piloto" muestra el porcentaje. **Objetivo: 85 % o más.**
4. **Descargar CSV** guarda todo (frase, resultado de la IA, veredicto) para analizar los errores y
   mejorar `lib/prompt.js`. Los datos viven solo en el navegador: si borrás los datos del sitio, se pierden.

Si el porcentaje es bajo por culpa del *dictado* (no de la IA), probá Groq/Whisper antes de seguir.
Si es bajo por culpa de la *interpretación*, agregá ejemplos reales al prompt.

## Supabase: catálogo y presupuestos compartidos

La app ya incluye inicio de sesión, catálogo compartido y borradores de presupuesto sincronizados. El
stock compartido es una foto del último CSV de Gestión: no consulta Gestión en vivo ni modifica sus
existencias. El botón **Actualizar datos** trae cambios de catálogo y presupuestos cuando se usa otra
computadora. Los borradores abiertos se guardan automáticamente; evitá editar el mismo borrador a la vez
desde dos computadoras porque gana el último guardado.

El proyecto ya tiene aplicado `supabase/schema.sql`. Para habilitar la sincronización, falta ejecutar
una vez el SQL de `supabase/migrations/20261127_app_sync.sql` desde *Supabase → SQL Editor → New query*.
Esta migración agrega el contenido completo del borrador y habilita que cualquier persona autenticada del
equipo pueda continuar un presupuesto en estado borrador.

Después:

1. En *Authentication → Users*, creá manualmente los usuarios para vos y los vendedores. Mantené
   desactivados los registros públicos.
2. Hacé admin al primer usuario ejecutando esta línea en SQL Editor, con su correo real:

   ```sql
   UPDATE public.usuarios SET rol = 'admin' WHERE email = 'tu-correo@ejemplo.com';
   ```

3. En Vercel → *Project → Settings → Environment Variables*, cargá `SUPABASE_URL` (Project URL) y
   `SUPABASE_ANON_KEY` (la clave pública anon/publishable del proyecto). Agregalas a los entornos que
   uses y redeployá después del próximo `git push`.
4. En desarrollo local, colocá esas mismas dos variables en `.env.local` y arrancá `npm run dev`.

La clave `anon`/publishable es pública y está protegida por las políticas RLS de la base. **No uses
`service_role` ni la publiques en el navegador, Vercel o GitHub.** Una vez configuradas las variables, la
app muestra el login de Supabase y deja de pedir el PIN. La sincronización funciona después de desplegar
el código; los cambios locales todavía no están publicados en Vercel.

Para compartir el catálogo de 6.449 artículos que ya está guardado en una computadora, iniciá sesión con
el administrador en esa misma computadora y tocá **Compartir catálogo guardado**. Los vendedores podrán
consultar el catálogo y guardar presupuestos, pero solo el administrador puede importar, editar o eliminar
productos.

## Seguridad y privacidad

- **El endpoint nunca queda abierto.** Sin `APP_PIN` (o sin sesión de Supabase) responde error; nunca
  sirve "por defecto".
- **Avisá claramente antes de usar el audio.** El modo manual graba mientras se mantiene apretado el
  botón. El modo Portero puede escuchar en tramos mientras está activo. El navegador procesa el dictado;
  además, la app envía el audio completo y las muestras de voz de `voces/` a Gemini para analizarlo e
  identificar al vendedor. Explicá este flujo al personal antes de usarlo.
- **Plan gratuito de Gemini:** revisá los términos vigentes. En el nivel gratuito Google puede usar el
  contenido enviado para mejorar sus productos. Si no querés eso, pasá a un plan pago.
- El PIN se usa solo en modo piloto sin Supabase. Al configurar ambas variables de Supabase, se exige login y el PIN deja de usarse.

## Límites conocidos

- El dictado depende de internet y de Chrome/Edge. En un mostrador con ruido la precisión baja.
- Supabase gratis **pausa** el proyecto tras 7 días sin actividad. Entrá al menos una vez por semana.
- Vercel gratis y la cuota de Gemini tienen límites; si se agotan, la app muestra el motivo.
- Todavía no hay modo sin conexión: si se corta internet, el texto queda en pantalla para reintentar.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| "Falta configurar el servidor" | Faltan `GEMINI_API_KEY` o `APP_PIN` en `.env.local` / Vercel |
| "PIN incorrecto" | No coincide con `APP_PIN`. Tocá "Cambiar PIN" |
| "Login requerido" | Supabase está activado; iniciá sesión con un usuario creado en Authentication → Users |
| "La IA no respondió" | Nombre de modelo en `GEMINI_MODEL` que ya no existe o está caído |
| El botón no escucha | Permiso de micrófono bloqueado, o navegador sin Web Speech (usá Chrome/Edge) |
| Funciona local pero no en Vercel | Variables de entorno sin cargar en Vercel, o sin redesplegar después de cargarlas |
