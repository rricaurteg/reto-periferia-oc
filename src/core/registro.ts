import { existsSync } from "node:fs"
import { join } from "node:path"
import { agregarLinea } from "./archivos.ts"

export type ResultadoIntento = "creada" | "existente" | "bloqueado" | "pendiente" | "error"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoIntento
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const COLUMNAS = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

function csv(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

/** Agrega una fila a out/control.csv por cada intento de creación (PRD HU-5). Consumido por contabilidad/auditoría. */
export async function registrarControl(outDir: string, fila: FilaControl): Promise<void> {
  const ruta = join(outDir, "control.csv")
  if (!existsSync(ruta)) await agregarLinea(ruta, COLUMNAS)
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
  await agregarLinea(ruta, valores.map(csv).join(","))
}

/** Bitácora de llamadas a herramientas en out/log.jsonl (PRD CA4). */
export async function registrarLlamada(outDir: string, entrada: Record<string, unknown>): Promise<void> {
  await agregarLinea(join(outDir, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entrada }))
}
