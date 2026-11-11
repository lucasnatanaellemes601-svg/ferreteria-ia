import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: 'Falta el texto de entrada' });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: texto,
      config: {
        temperature: 0.1,
        systemInstruction: "Sos la inteligencia artificial de una ferretería en Argentina. Escuchás audios dictados por el vendedor mediante 'Push-to-Talk'. Extraé los productos y clasificalos. Entendés jerga: tarugos, mechas, malla sima, amoladora, poxipol, te lo debo. Si hay charla casual, devolvé lista vacía.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              intencion: { type: Type.STRING, enum: ["FALTANTE", "VENTA", "CONSULTA"] },
              producto_estandarizado: { type: Type.STRING },
              cantidad: { type: Type.INTEGER },
              medida_o_detalle: { type: Type.STRING, nullable: true },
              alternativa_ofrecida: { type: Type.STRING, nullable: true },
              alternativa_aceptada: { type: Type.BOOLEAN, nullable: true },
              confianza: { type: Type.NUMBER }
            },
            required: ["intencion", "producto_estandarizado", "cantidad", "confianza"]
          }
        }
      }
    });

    const resultado = JSON.parse(response.text);
    return res.status(200).json(resultado);

  } catch (error) {
    console.error("Error en Gemini API:", error);
    return res.status(500).json({ error: 'Error procesando el texto con la IA' });
  }
}