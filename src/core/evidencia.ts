import { createHash } from "node:crypto"
import { join } from "node:path"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { escribir } from "./archivos.ts"
import type { Paquete } from "./esquemas.ts"

type Aprobacion = NonNullable<Paquete["aprobacion"]>

/** Contenido canónico de la evidencia (encabezados + cuerpo). El sha256 se calcula sobre este texto, así es reproducible. */
export function contenidoEvidencia(a: Aprobacion): string {
  return [
    "EVIDENCIA DE APROBACIÓN DE COMPRA",
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.texto,
  ].join("\n")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Las fuentes estándar de PDF solo cubren WinAnsi (incluye tildes y ñ); otros caracteres se reemplazan. */
function aWinAnsi(texto: string): string {
  return texto.replace(/[^\x20-\x7E -ÿ\n]/g, "?")
}

async function generarPdf(contenido: string, hash: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const pagina = doc.addPage([595, 842])
  const fuente = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 790
  const lineas = aWinAnsi(contenido).split("\n")
  lineas.forEach((linea, i) => {
    pagina.drawText(linea, { x: 50, y, size: i === 0 ? 14 : 11, font: i === 0 ? negrita : fuente, maxWidth: 495 })
    y -= i === 0 ? 28 : 18
  })
  pagina.drawText(`sha256: ${hash}`, { x: 50, y: y - 20, size: 8, font: fuente, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}

export type Evidencia = { ruta: string; ruta_pdf: string; sha256: string }

/** Escribe out/<caso>/aprobacion.txt (P0) y aprobacion.pdf (P1). */
export async function escribirEvidencia(outDir: string, caso: string, a: Aprobacion): Promise<Evidencia> {
  const contenido = contenidoEvidencia(a)
  const hash = sha256(contenido)
  const ruta = join(outDir, caso, "aprobacion.txt")
  const rutaPdf = join(outDir, caso, "aprobacion.pdf")
  await escribir(ruta, `${contenido}\n\n---\nsha256 (contenido anterior a esta línea): ${hash}\n`)
  await escribir(rutaPdf, await generarPdf(contenido, hash))
  return { ruta, ruta_pdf: rutaPdf, sha256: hash }
}
