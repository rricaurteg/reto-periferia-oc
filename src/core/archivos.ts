import { readFile, appendFile, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { z } from "zod"

export type Lectura<T> = { ok: true; valor: T } | { ok: false; motivo: string }

/** Lee un archivo de texto; si no existe devuelve motivo "ausente" sin lanzar. */
export async function leerTexto(ruta: string): Promise<Lectura<string>> {
  try {
    return { ok: true, valor: await readFile(ruta, "utf8") }
  } catch {
    return { ok: false, motivo: "ausente" }
  }
}

/** Lee y valida un JSON con un esquema zod. Reporta ausencia, JSON malformado o campos inválidos en lenguaje claro. */
export async function leerJson<T>(ruta: string, esquema: z.ZodType<T>): Promise<Lectura<T>> {
  const texto = await leerTexto(ruta)
  if (!texto.ok) return texto
  let crudo: unknown
  try {
    crudo = JSON.parse(texto.valor)
  } catch {
    return { ok: false, motivo: "JSON malformado" }
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
    return { ok: false, motivo: `campos inválidos (${detalle})` }
  }
  return { ok: true, valor: r.data }
}

export async function escribir(ruta: string, contenido: string | Uint8Array): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido)
}

export async function agregarLinea(ruta: string, linea: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await appendFile(ruta, linea.endsWith("\n") ? linea : `${linea}\n`, "utf8")
}
