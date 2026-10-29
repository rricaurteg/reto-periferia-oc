import { z } from "zod"
import type { Ctx } from "../core/rutas.ts"
import * as oc from "./oc.ts"
import { fallo, type Herramienta } from "./tipos.ts"

/** Herramienta lista para el ciclo del agente: nombre visible por el modelo, JSON Schema y ejecución con validación zod previa. */
export type HerramientaRegistrada = {
  nombre: string
  descripcion: string
  esquemaJson: Record<string, unknown>
  ejecutar(argsCrudos: unknown, ctx: Ctx): Promise<string>
}

function registrar<S extends z.ZodRawShape>(archivo: string, exportName: string, h: Herramienta<S>): HerramientaRegistrada {
  const esquema = z.object(h.args)
  const { $schema: _omitido, ...esquemaJson } = z.toJSONSchema(esquema) as Record<string, unknown>
  return {
    nombre: `${archivo}_${exportName}`,
    descripcion: h.description,
    esquemaJson,
    async ejecutar(argsCrudos, ctx) {
      const r = esquema.safeParse(argsCrudos ?? {})
      if (!r.success) {
        const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")
        return fallo(`Argumentos inválidos para ${archivo}_${exportName}: ${detalle}`)
      }
      return h.execute(r.data, ctx)
    },
  }
}

/** Registro de herramientas: el nombre que ve el modelo es <archivo>_<export> (PRD 6.2). */
export const HERRAMIENTAS: HerramientaRegistrada[] = [
  registrar("oc", "listar_casos", oc.listar_casos),
  registrar("oc", "leer_paquete", oc.leer_paquete),
  registrar("oc", "validar", oc.validar),
  registrar("oc", "construir_payload", oc.construir_payload),
  registrar("oc", "generar_evidencia", oc.generar_evidencia),
  registrar("oc", "crear", oc.crear),
]

export function buscarHerramienta(nombre: string): HerramientaRegistrada | undefined {
  return HERRAMIENTAS.find((h) => h.nombre === nombre)
}
