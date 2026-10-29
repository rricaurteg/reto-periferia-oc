import { z } from "zod"
import type { Ctx } from "../core/rutas.ts"

export type { Ctx }

/** Contrato de herramienta (PRD 6.2): description + args zod + execute que devuelve JSON string y nunca lanza. */
export type Herramienta<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: Ctx): Promise<string>
}

/** Ayuda de tipado: conserva el tipo exacto de los args para que execute quede tipado sin `any`. */
export function herramienta<S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta<S> {
  return h
}

export function exito(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function fallo(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error, ...extra })
}
