import { join } from "node:path"

/** Contexto que reciben todas las herramientas (PRD 6.2). `outDir` es opcional para aislar ejecuciones (p. ej. la demo web). */
export type Ctx = { directory: string; sessionId: string; outDir?: string }

const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,40}$/

/** Valida el nombre del caso para impedir rutas arbitrarias (path traversal). */
export function casoValido(caso: string): boolean {
  return PATRON_CASO.test(caso)
}

export function dirFixtures(ctx: Ctx): string {
  return join(ctx.directory, "fixtures", "reto-03")
}

export function dirSolicitudes(ctx: Ctx): string {
  return join(dirFixtures(ctx), "solicitudes")
}

export function dirCaso(ctx: Ctx, caso: string): string {
  return join(dirSolicitudes(ctx), caso)
}

export function dirOut(ctx: Ctx): string {
  return ctx.outDir ?? join(ctx.directory, "out")
}
