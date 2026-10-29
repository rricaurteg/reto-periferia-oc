import { join } from "node:path"
import { readdir } from "node:fs/promises"
import { leerJson, leerTexto } from "./archivos.ts"
import { AprobacionArchivoSchema, CorreoArchivoSchema, SolicitudSchema, type Paquete } from "./esquemas.ts"
import { dirCaso, dirSolicitudes, type Ctx } from "./rutas.ts"
import { leerCotizacion, leerFactura } from "./texto.ts"

/** Detecta "Aprobado" como palabra, descartando negaciones explícitas ("no aprobado"). */
export function contieneAprobado(cuerpo: string): boolean {
  const t = cuerpo.toLowerCase()
  return /\baprobad[oa]\b/.test(t) && !/\bno\s+(est[aá]\s+)?aprobad[oa]\b/.test(t)
}

/** Lee los adjuntos de un caso y los normaliza (PRD 7.2). Un adjunto ausente o ilegible queda en null y se lista en `faltantes`. */
export async function leerPaquete(ctx: Ctx, caso: string): Promise<Paquete> {
  const dir = dirCaso(ctx, caso)
  const faltantes: string[] = []

  const correo = await leerJson(join(dir, "correo.json"), CorreoArchivoSchema)
  if (!correo.ok) faltantes.push(`correo.json (${correo.motivo})`)

  const solicitud = await leerJson(join(dir, "solicitud.json"), SolicitudSchema)
  if (!solicitud.ok) faltantes.push(`solicitud.json (${solicitud.motivo})`)

  const cotTxt = await leerTexto(join(dir, "cotizacion.txt"))
  const cotizacion = cotTxt.ok ? leerCotizacion(cotTxt.valor) : null
  if (!cotTxt.ok) faltantes.push("cotizacion.txt (ausente)")
  else if (!cotizacion) faltantes.push("cotizacion.txt (no se encontró proveedor o total)")

  const aprob = await leerJson(join(dir, "aprobacion.json"), AprobacionArchivoSchema)
  if (!aprob.ok) faltantes.push(`aprobacion.json (${aprob.motivo})`)

  // factura.txt es opcional: solo existe en compras retroactivas, su ausencia no es un faltante.
  const facTxt = await leerTexto(join(dir, "factura.txt"))
  const factura = facTxt.ok ? leerFactura(facTxt.valor) : null
  if (facTxt.ok && !factura) faltantes.push("factura.txt (no se pudo leer número, fecha o total)")

  return {
    caso,
    correo: correo.ok
      ? { id: correo.valor.id, de: correo.valor.de, asunto: correo.valor.asunto, fecha: correo.valor.fecha }
      : null,
    solicitud: solicitud.ok ? solicitud.valor : null,
    cotizacion,
    aprobacion: aprob.ok
      ? {
          de: aprob.valor.de,
          para: aprob.valor.para,
          asunto: aprob.valor.asunto,
          fecha: aprob.valor.fecha,
          aprobado: contieneAprobado(aprob.valor.cuerpo),
          texto: aprob.valor.cuerpo,
        }
      : null,
    factura,
    faltantes,
  }
}

export type ResumenCaso = { caso: string; solicitud_id: string | null; descripcion: string | null }

/** Lista las carpetas de casos disponibles. */
export async function listarCasos(ctx: Ctx): Promise<ResumenCaso[]> {
  const entradas = await readdir(dirSolicitudes(ctx), { withFileTypes: true })
  const casos = entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  return Promise.all(
    casos.map(async (caso) => {
      const s = await leerJson(join(dirCaso(ctx, caso), "solicitud.json"), SolicitudSchema)
      return {
        caso,
        solicitud_id: s.ok ? s.valor.solicitud_id : null,
        descripcion: s.ok ? s.valor.descripcion : null,
      }
    }),
  )
}
