import { join } from "node:path"
import { escribir } from "../core/archivos.ts"
import type { Mensaje } from "../llm/adapter.ts"

export type LlamadaVisible = {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
  resultado: unknown
  ms: number
  nota?: string
}

export type EntradaVisible = {
  rol: "usuario" | "asistente"
  texto: string
  toolCalls?: LlamadaVisible[]
  needsConfirmation?: boolean
  error?: boolean
  ts: string
}

export type Sesion = {
  id: string
  /** Historial que se envía al modelo (incluye llamadas y resultados de herramientas). */
  mensajes: Mensaje[]
  /** Historial que ve el usuario en el chat. */
  visible: EntradaVisible[]
  tokens: number
  /** El último turno terminó pidiendo confirmación humana. */
  esperandoConfirmacion: boolean
  /** Casos con confirmaciones pendientes. */
  pendientes: Set<string>
  ocupada: boolean
}

const sesiones = new Map<string, Sesion>()
const PATRON_ID = /^[A-Za-z0-9_-]{1,64}$/

export function idValido(id: string): boolean {
  return PATRON_ID.test(id)
}

export function obtenerSesion(id: string): Sesion {
  const existente = sesiones.get(id)
  if (existente) return existente
  const nueva: Sesion = { id, mensajes: [], visible: [], tokens: 0, esperandoConfirmacion: false, pendientes: new Set(), ocupada: false }
  sesiones.set(id, nueva)
  return nueva
}

export function buscarSesion(id: string): Sesion | undefined {
  return sesiones.get(id)
}

/** Copia de respaldo en out/sessions/<id>.json (la fuente es la memoria). */
export async function guardarSesion(outDir: string, s: Sesion): Promise<void> {
  const datos = { id: s.id, tokens: s.tokens, visible: s.visible, pendientes: [...s.pendientes] }
  await escribir(join(outDir, "sessions", `${s.id}.json`), JSON.stringify(datos, null, 2)).catch(() => undefined)
}
