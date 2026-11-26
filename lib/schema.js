// Esquema de salida de Gemini (responseSchema) + validación estricta con Zod.
// Gemini garantiza la forma, pero igual validamos: nunca se confía en la
// salida de un modelo antes de mostrarla o guardarla.
import { Type } from "@google/genai";
import { z } from "zod";

export const INTENCIONES = ["FALTANTE", "VENTA", "CONSULTA"];

// Lo que se le manda a Gemini (sintaxis del SDK @google/genai).
export const responseSchema = {
  type: Type.OBJECT,
  properties: {
    solicita_presupuesto: {
      type: Type.BOOLEAN,
      description: "true solo cuando alguien pide explícitamente armar un presupuesto o cotización; false para una consulta de precio común.",
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          intencion: {
            type: Type.STRING,
            enum: INTENCIONES,
            description: "FALTANTE (no había stock), VENTA (se concretó) o CONSULTA (solo preguntó).",
          },
          producto_estandarizado: {
            type: Type.STRING,
            description: "Nombre corregido y estandarizado del producto.",
          },
          cantidad: {
            type: Type.INTEGER,
            description: "Cantidad numérica; 1 si no se menciona.",
          },
          medida_o_detalle: {
            type: Type.STRING,
            nullable: true,
            description: "Atributos extra (8mm, pomo chico, 2 pulgadas). null si no hay.",
          },
          alternativa_ofrecida: {
            type: Type.STRING,
            nullable: true,
            description: "Qué se ofreció en su lugar si no había el producto. null si nada.",
          },
          alternativa_aceptada: {
            type: Type.BOOLEAN,
            nullable: true,
            description: "true si el cliente aceptó la alternativa, false si la rechazó, null si no aplica.",
          },
          confianza: {
            type: Type.NUMBER,
            description: "Confianza de la extracción, de 0.0 a 1.0.",
          },
        },
        required: ["intencion", "producto_estandarizado", "cantidad", "confianza"],
        propertyOrdering: [
          "intencion",
          "producto_estandarizado",
          "cantidad",
          "medida_o_detalle",
          "alternativa_ofrecida",
          "alternativa_aceptada",
          "confianza",
        ],
      },
    },
  },
  required: ["solicita_presupuesto", "items"],
  propertyOrdering: ["solicita_presupuesto", "items"],
};

// Lo que se valida al recibir la respuesta.
const nullableTexto = z
  .string()
  .max(200)
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const ItemSchema = z.object({
  intencion: z.enum(INTENCIONES),
  producto_estandarizado: z.string().trim().min(1).max(200),
  cantidad: z.coerce.number().int().min(1).max(100000).catch(1),
  medida_o_detalle: nullableTexto,
  alternativa_ofrecida: nullableTexto,
  alternativa_aceptada: z.boolean().nullish().transform((v) => v ?? null),
  confianza: z.coerce.number().min(0).max(1).catch(0.5),
});

export const ItemsSchema = z.object({
  solicita_presupuesto: z.boolean(),
  items: z.array(ItemSchema).max(20),
});
