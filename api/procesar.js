// api/procesar.js
// Dos modos en el mismo endpoint:
//  - { texto }       -> extrae ventas/faltantes/consultas del texto dictado.
//  - { audioBase64 } -> además identifica al empleado comparando con sus voces de referencia (/voces).

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const MIME_POR_EXT = {
  ".wav": "audio/wav", ".mp3": "audio/mp3", ".aiff": "audio/aiff",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".webm": "audio/webm"
};

let cacheReferencias = null;

function cargarReferencias() {
  if (cacheReferencias) return cacheReferencias;
  const dir = path.join(process.cwd(), "voces");
  const refs = [];
  if (fs.existsSync(dir)) {
    for (const archivo of fs.readdirSync(dir)) {
      const ext = path.extname(archivo).toLowerCase();
      if (!MIME_POR_EXT[ext]) continue;
      refs.push({
        nombre: path.basename(archivo, ext),
        mimeType: MIME_POR_EXT[ext],
        data: fs.readFileSync(path.join(dir, archivo)).toString("base64"),
      });
    }
  }
  cacheReferencias = refs;
  return refs;
}

const RespuestaSchema = z.object({
  empleado: z.object({
    nombre: z.string(),
    confianza: z.number().min(0).max(1),
    motivo: z.string(),
  }),
  items: z.array(
    z.object({
      hablante: z.enum(["EMPLEADO", "CLIENTE", "DESCONOCIDO"]),
      intencion: z.enum(["VENTA", "FALTANTE", "CONSULTA"]),
      producto_estandarizado: z.string(),
      cantidad: z.number(),
      medida_o_detalle: z.string().nullable().optional(),
      alternativa_ofrecida: z.string().nullable().optional(),
      alternativa_aceptada: z.boolean().nullable().optional(),
      confianza: z.number().min(0).max(1),
    })
  ),
});

function jsonSchemaParaGemini(nombres) {
  return {
    type: "object",
    properties: {
      empleado: {
        type: "object",
        properties: {
          nombre: { type: "string", enum: [...nombres, "Desconocido"] },
          confianza: { type: "number", description: "0 a 1. Bajala si hay ruido o dudas." },
          motivo: { type: "string", description: "Por qué coinciden los rasgos de voz." },
        },
        required: ["nombre", "confianza", "motivo"],
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            hablante: { type: "string", enum: ["EMPLEADO", "CLIENTE", "DESCONOCIDO"] },
            intencion: { type: "string", enum: ["VENTA", "FALTANTE", "CONSULTA"] },
            producto_estandarizado: { type: "string" },
            cantidad: { type: "number" },
            medida_o_detalle: { type: ["string", "null"] },
            alternativa_ofrecida: { type: ["string", "null"] },
            alternativa_aceptada: { type: ["boolean", "null"] },
            confianza: { type: "number" },
          },
          required: ["hablante", "intencion", "producto_estandarizado", "cantidad", "confianza"],
        },
      },
    },
    required: ["empleado", "items"],
  };
}

const TAREA_ITEMS = `
EXTRAER TRANSACCIONES
Registrá solo lo comercial: ventas, faltantes de stock y consultas.
Para cada ítem indicá quién habló: EMPLEADO, CLIENTE o DESCONOCIDO.
Ignorá ruido de fondo y charla de cortesía. Si no hay transacción, devolvé "items": [].
`;

const INSTRUCCIONES_AUDIO = `
Sos el asistente de una ferretería. Vas a recibir voces de REFERENCIA rotuladas y un AUDIO DEL MOSTRADOR.
TAREA 1: IDENTIFICAR AL EMPLEADO por su timbre, altura y ritmo (no por lo que dice). Si hay dudas o ruido, devolvé "Desconocido".
TAREA 2: ${TAREA_ITEMS}`;

const INSTRUCCIONES_TEXTO = `
Sos el asistente de una ferretería. Recibís TEXTO (sin audio). Devolvé empleado.nombre = "Desconocido", confianza = 0.
${TAREA_ITEMS}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_no_permitido" });

  const clientPin = req.headers["x-app-pin"];
  if (!clientPin || clientPin !== process.env.APP_PIN) return res.status(401).json({ error: "pin_incorrecto" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "servidor_sin_configurar" });

  try {
    const body = req.body || {};
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    const texto = typeof body.texto === "string" ? body.texto.trim() : "";
    const mimeType = body.mimeType || "audio/webm";

    if (!audioBase64 && !texto) return res.status(400).json({ error: "falta_entrada" });

    const modoAudio = Boolean(audioBase64);
    let nombres = [];
    const parts = [];

    if (modoAudio) {
      const referencias = cargarReferencias();
      if (referencias.length === 0) return res.status(500).json({ error: "sin_voces_de_referencia", detalle: "Carpeta /voces vacía o inexistente" });
      nombres = referencias.map((r) => r.nombre);

      parts.push({ text: "VOCES DE REFERENCIA:" });
      for (const ref of referencias) {
        parts.push({ text: `Voz de ${ref.nombre}:` });
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
      }
      parts.push({ text: "AUDIO A ANALIZAR:" });
      parts.push({ inlineData: { mimeType, data: audioBase64 } });
      if (texto) parts.push({ text: `Transcripción de apoyo: ${texto}` });
    } else {
      parts.push({ text: `TEXTO DICTADO: ${texto}` });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: modoAudio ? INSTRUCCIONES_AUDIO : INSTRUCCIONES_TEXTO,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchemaParaGemini(nombres),
        temperature: 0.1,
      },
    });

    const rawText = response.text;
    if (!rawText) throw new Error("Respuesta vacía");

    const json = JSON.parse(rawText);
    const validacion = RespuestaSchema.safeParse(json);
    if (!validacion.success) return res.status(502).json({ error: "respuesta_ia_invalida" });

    const resultado = { ...validacion.data };

    if (modoAudio) {
      const umbral = Number(process.env.UMBRAL_VOZ || 0.75);
      resultado.requiere_confirmacion = !nombres.includes(resultado.empleado.nombre) || resultado.empleado.nombre === "Desconocido" || resultado.empleado.confianza < umbral;
      resultado.empleados_posibles = nombres;
    }

    return res.status(200).json(resultado);
  } catch (error) {
    if (error.status === 429) return res.status(429).json({ error: "cuota_ia_agotada" });
    return res.status(502).json({ error: "ia_no_disponible", detalle: error.message });
  }
}