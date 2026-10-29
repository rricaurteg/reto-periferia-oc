/** Utilidades de normalización y lectura de textos (cotizaciones y facturas). Sin dependencias. */

/** "900.555.111-2" → "900555111" (descarta el dígito de verificación). */
export function normalizarNit(nit: string): string {
  const base = nit.split("-")[0] ?? nit
  return base.replace(/\D/g, "")
}

/** "TecnoSuministros S.A.S." → "tecnosuministros" (minúsculas, sin tildes, sin razón social). */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(s\s*a\s*s|s\s*a|ltda|limitada|sas)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** "11.400.000" → 11400000 ; "1.234,56" → 1234.56 (formato colombiano). */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".")
  const valor = Number(limpio)
  return Number.isFinite(valor) ? valor : null
}

function capturar(texto: string, patron: RegExp): string | null {
  const m = texto.match(patron)
  return m?.[1]?.trim() ?? null
}

function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export type CotizacionLeida = {
  referencia: string | null
  proveedor: string
  nit: string | null
  fecha: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

/** Extrae los campos clave del texto de una cotización. Devuelve null si no encuentra proveedor o total. */
export function leerCotizacion(texto: string): CotizacionLeida | null {
  const proveedor = capturar(texto, /^Proveedor:\s*(.+)$/m)
  const totalMatch = texto.match(/^TOTAL[^:\n]*:\s*(COP|USD)\s*([\d.,]+)/m)
  const total = totalMatch?.[2] ? parsearMonto(totalMatch[2]) : null
  if (!proveedor || total === null) return null
  const nit = capturar(texto, /^NIT:\s*([\d.\-]+)/m)
  const fecha = capturar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)
  const dias = capturar(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i)
  return {
    referencia: capturar(texto, /COTIZACI[ÓO]N\s+([A-Z0-9-]+)/),
    proveedor,
    nit: nit ? normalizarNit(nit) : null,
    fecha,
    total,
    moneda: totalMatch?.[1] ?? "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

export type FacturaLeida = { numero: string; fecha: string; total: number }

/** Extrae número, fecha de emisión y total de una factura. */
export function leerFactura(texto: string): FacturaLeida | null {
  const numero = capturar(texto, /FACTURA[^\n]*?No\.\s*([A-Z0-9-]+)/)
  const fecha = capturar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/)
  const totalTxt = capturar(texto, /^TOTAL[^:\n]*:\s*(?:COP|USD)\s*([\d.,]+)/m)
  const total = totalTxt ? parsearMonto(totalTxt) : null
  if (!numero || !fecha || total === null) return null
  return { numero, fecha, total }
}

/** Fecha (AAAA-MM-DD) tal como fue escrita en un ISO con zona horaria: "2026-08-21T10:02:00-05:00" → "2026-08-21". */
export function soloFecha(iso: string): string {
  return iso.slice(0, 10)
}

export function formatoMoneda(valor: number, moneda: string): string {
  return `${moneda} ${valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`
}
