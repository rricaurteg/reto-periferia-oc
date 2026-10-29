import type { CentroCosto, Maestros, Paquete, Proveedor, Solicitud } from "./esquemas.ts"
import { formatoMoneda, normalizarNit, normalizarNombre, soloFecha } from "./texto.ts"

/** Resultado de cada control. `bloqueo` impide crear; `confirmacion` exige confirmado=true; `derivado` solo se informa. */
export type EstadoControl = "ok" | "bloqueo" | "confirmacion" | "derivado" | "no_aplica"
export type Control = { codigo: string; regla: string; estado: EstadoControl; detalle: string }
export type Hallazgo = { codigo: string; detalle: string; accion_sugerida: string }
export type Derivado = { valor: string; fuente: string; motivo: string }

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Record<string, Derivado>
  retroactiva: boolean
  controles: Control[]
  proveedor: Proveedor | null
}

const TOLERANCIA_COTIZACION = 0.02
const TOLERANCIA_ARITMETICA = 1

type Acumulador = {
  controles: Control[]
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Record<string, Derivado>
}

function registrar(acc: Acumulador, c: Control, accion?: string): void {
  acc.controles.push(c)
  if (c.estado === "bloqueo") acc.bloqueos.push({ codigo: c.codigo, detalle: c.detalle, accion_sugerida: accion ?? "" })
  if (c.estado === "confirmacion")
    acc.confirmaciones.push({ codigo: c.codigo, detalle: c.detalle, accion_sugerida: accion ?? "" })
}

/** RC1 · proveedor existe (por NIT; si no hay NIT, por nombre normalizado) y está activo. */
function rc1Proveedor(acc: Acumulador, s: Solicitud, m: Maestros): Proveedor | null {
  const regla = "Proveedor existe en el maestro y está activo"
  const porNit = s.proveedor_nit
    ? m.proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(s.proveedor_nit ?? ""))
    : undefined
  const porNombre = s.proveedor_nit
    ? undefined
    : m.proveedores.find((p) => normalizarNombre(p.nombre) === normalizarNombre(s.proveedor_nombre))
  const p = porNit ?? porNombre ?? null
  const criterio = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}" (la solicitud no trae NIT)`
  if (!p) {
    registrar(
      acc,
      { codigo: "RC1", regla, estado: "bloqueo", detalle: `No existe proveedor con ${criterio} en el maestro.` },
      "Solicitar al área de compras la creación/vinculación del proveedor en SAP (RUT, certificación bancaria) o confirmar con el solicitante si debe usarse un proveedor ya registrado.",
    )
    return null
  }
  if (!p.activo) {
    registrar(
      acc,
      { codigo: "RC1", regla, estado: "bloqueo", detalle: `El proveedor ${p.nombre} (${p.codigo_sap}) está INACTIVO.` },
      "Solicitar la reactivación del proveedor al área de compras o cambiar de proveedor.",
    )
    return p
  }
  registrar(acc, { codigo: "RC1", regla, estado: "ok", detalle: `${p.nombre} · código SAP ${p.codigo_sap} · activo (identificado por ${criterio}).` })
  if (!s.proveedor_nit) {
    acc.derivados.proveedor_nit = { valor: p.nit, fuente: "maestro.proveedores", motivo: "La solicitud no trae NIT; se tomó del maestro tras identificar al proveedor por nombre." }
  }
  return p
}

function aprobadoresQueCubren(centro: CentroCosto, valor: number): string {
  const ok = centro.aprobadores.filter((a) => a.tope >= valor)
  return ok.length ? ok.map((a) => `${a.email} (tope ${formatoMoneda(a.tope, "COP")})`).join(", ") : "ninguno"
}

/** RC2 + RC3 · aprobación válida, de un aprobador del centro, y monto dentro de su tope. */
function rc2rc3Aprobacion(acc: Acumulador, p: Paquete, s: Solicitud, m: Maestros, centro: CentroCosto | null): void {
  const reglaRc2 = "Aprobación existe, dice \"Aprobado\" y viene de un aprobador del centro de costo"
  const reglaRc3 = "Valor total dentro del tope del aprobador en ese centro"
  const a = p.aprobacion
  if (!a) {
    registrar(acc, { codigo: "RC2", regla: reglaRc2, estado: "bloqueo", detalle: "No hay correo de aprobación en el paquete." }, "Pedir al solicitante el correo de aprobación de su líder.")
    registrar(acc, { codigo: "RC3", regla: reglaRc3, estado: "no_aplica", detalle: "Sin aprobación no se evalúa el tope." })
    return
  }
  if (!a.aprobado) {
    registrar(acc, { codigo: "RC2", regla: reglaRc2, estado: "bloqueo", detalle: `El correo de ${a.de} no contiene una aprobación explícita ("Aprobado").` }, "Pedir al líder una respuesta explícita de aprobación.")
  }
  if (!centro) {
    registrar(acc, { codigo: "RC3", regla: reglaRc3, estado: "no_aplica", detalle: "Centro de costo inexistente (ver RC4)." })
    return
  }
  const aprobador = centro.aprobadores.find((x) => x.email.toLowerCase() === a.de.toLowerCase())
  if (!aprobador) {
    const otros = m.centros.filter((c) => c.aprobadores.some((x) => x.email.toLowerCase() === a.de.toLowerCase()))
    const pista = otros.length
      ? ` Ese aprobador sí está autorizado en ${otros.map((c) => `${c.centro_costo} (${c.nombre ?? ""}: ${c.subareas.join(", ")})`).join("; ")}: verificar si la solicitud tiene mal el centro de costo.`
      : ""
    registrar(
      acc,
      { codigo: "RC2", regla: reglaRc2, estado: "bloqueo", detalle: `${a.de} no es aprobador del centro ${centro.centro_costo}.` },
      `Reenviar a un aprobador autorizado de ${centro.centro_costo}: ${centro.aprobadores.map((x) => x.email).join(", ")}.${pista}`,
    )
    registrar(
      acc,
      { codigo: "RC3", regla: reglaRc3, estado: "bloqueo", detalle: `${a.de} no tiene tope en ${centro.centro_costo}. Aprobadores de ese centro con tope ≥ ${formatoMoneda(s.valor_total, s.moneda)}: ${aprobadoresQueCubren(centro, s.valor_total)}.` },
      "Si ningún aprobador del centro cubre el monto, escalar según la matriz de atribuciones. No fraccionar la compra para quedar bajo el tope.",
    )
    return
  }
  if (a.aprobado) {
    registrar(acc, { codigo: "RC2", regla: reglaRc2, estado: "ok", detalle: `Aprobado por ${a.de}, aprobador de ${centro.centro_costo}.` })
  }
  if (s.valor_total > aprobador.tope) {
    registrar(
      acc,
      { codigo: "RC3", regla: reglaRc3, estado: "bloqueo", detalle: `${formatoMoneda(s.valor_total, s.moneda)} supera el tope de ${a.de} (${formatoMoneda(aprobador.tope, "COP")}).` },
      `Obtener aprobación de: ${aprobadoresQueCubren(centro, s.valor_total)}.`,
    )
  } else {
    registrar(acc, { codigo: "RC3", regla: reglaRc3, estado: "ok", detalle: `${formatoMoneda(s.valor_total, s.moneda)} ≤ tope ${formatoMoneda(aprobador.tope, "COP")}.` })
  }
}

/** RC4 · la subárea pertenece al centro de costo. */
function rc4Subarea(acc: Acumulador, s: Solicitud, m: Maestros): CentroCosto | null {
  const regla = "La subárea pertenece al centro de costo"
  const centro = m.centros.find((c) => c.centro_costo === s.centro_costo) ?? null
  if (!centro) {
    registrar(acc, { codigo: "RC4", regla, estado: "bloqueo", detalle: `El centro de costo ${s.centro_costo} no existe.` }, "Pedir al solicitante el centro de costo correcto.")
    return null
  }
  if (!centro.subareas.includes(s.subarea)) {
    registrar(acc, { codigo: "RC4", regla, estado: "bloqueo", detalle: `La subárea "${s.subarea}" no pertenece a ${s.centro_costo} (válidas: ${centro.subareas.join(", ")}).` }, "Pedir al solicitante corregir la subárea.")
  } else {
    registrar(acc, { codigo: "RC4", regla, estado: "ok", detalle: `"${s.subarea}" pertenece a ${s.centro_costo}.` })
  }
  return centro
}

/** RC5 · cotización vs solicitud dentro del 2 %. */
function rc5Cotizacion(acc: Acumulador, p: Paquete, s: Solicitud): void {
  const regla = "Total de la cotización ≈ valor de la solicitud (±2 %)"
  const c = p.cotizacion
  if (!c) {
    registrar(acc, { codigo: "RC5", regla, estado: "confirmacion", detalle: "El paquete no trae cotización legible." }, "Confirmar si se crea la OC sin cotización o pedirla al proveedor.")
    return
  }
  const diferencia = Math.abs(c.total - s.valor_total) / s.valor_total
  const pct = (diferencia * 100).toFixed(2).replace(".", ",")
  if (diferencia > TOLERANCIA_COTIZACION) {
    registrar(
      acc,
      { codigo: "RC5", regla, estado: "confirmacion", detalle: `Cotización ${formatoMoneda(c.total, c.moneda)} vs solicitud ${formatoMoneda(s.valor_total, s.moneda)}: diferencia ${pct} % (máx. 2 %). La OC se crearía por el valor de la solicitud.` },
      "Confirmar si se crea por el valor de la solicitud (monto aprobado) o devolver al solicitante para ajustar valor y aprobación.",
    )
  } else {
    registrar(acc, { codigo: "RC5", regla, estado: "ok", detalle: `Cotización ${formatoMoneda(c.total, c.moneda)} vs solicitud ${formatoMoneda(s.valor_total, s.moneda)} (diferencia ${pct} %).` })
  }
}

/** RC6 · indicador IVA (si falta se deriva del proveedor y se confirma). RC7 · condiciones de pago (si faltan se derivan e informan). */
function rc6rc7Derivados(acc: Acumulador, s: Solicitud, m: Maestros, prov: Proveedor | null): void {
  const reglaIva = "Indicador IVA informado (si falta se deriva del proveedor)"
  if (s.indicador_iva) {
    const ok = m.iva.some((i) => i.codigo === s.indicador_iva)
    registrar(acc, ok
      ? { codigo: "RC6", regla: reglaIva, estado: "ok", detalle: `Indicador ${s.indicador_iva} informado en la solicitud.` }
      : { codigo: "RC6", regla: reglaIva, estado: "bloqueo", detalle: `Indicador IVA ${s.indicador_iva} no existe en el maestro.` },
      "Pedir al solicitante un indicador IVA válido.")
  } else if (prov) {
    const iva = m.iva.find((i) => i.codigo === prov.indicador_iva_default)
    acc.derivados.indicador_iva = { valor: prov.indicador_iva_default, fuente: "maestro.proveedores", motivo: `La solicitud no trae indicador IVA; default del proveedor (${iva?.descripcion ?? "sin descripción"}).` }
    registrar(acc, { codigo: "RC6", regla: reglaIva, estado: "confirmacion", detalle: `IVA no informado. Se propone ${prov.indicador_iva_default} (${iva?.descripcion ?? ""}), default del proveedor ${prov.nombre}` }, "Confirmar el indicador IVA derivado.")
  } else {
    registrar(acc, { codigo: "RC6", regla: reglaIva, estado: "no_aplica", detalle: "IVA no informado y proveedor no identificado (ver RC1)." })
  }

  const reglaPago = "Condiciones de pago (si faltan se derivan del proveedor)"
  if (s.condiciones_pago) {
    const ok = m.condiciones.some((c) => c.codigo === s.condiciones_pago)
    registrar(acc, ok
      ? { codigo: "RC7", regla: reglaPago, estado: "ok", detalle: `Condición ${s.condiciones_pago} informada en la solicitud.` }
      : { codigo: "RC7", regla: reglaPago, estado: "bloqueo", detalle: `Condición de pago ${s.condiciones_pago} no existe en el maestro.` },
      "Pedir al solicitante una condición de pago válida.")
  } else if (prov) {
    const cp = m.condiciones.find((c) => c.codigo === prov.condiciones_pago_default)
    acc.derivados.condiciones_pago = { valor: prov.condiciones_pago_default, fuente: "maestro.proveedores", motivo: `La solicitud no trae condiciones de pago; default del proveedor (${cp?.descripcion ?? ""}).` }
    registrar(acc, { codigo: "RC7", regla: reglaPago, estado: "derivado", detalle: `Se usa ${prov.condiciones_pago_default} (${cp?.descripcion ?? ""}), default del proveedor.` })
  } else {
    registrar(acc, { codigo: "RC7", regla: reglaPago, estado: "no_aplica", detalle: "Proveedor no identificado (ver RC1)." })
  }
}

/** RC8 · factura anterior a la solicitud → retroactiva. RC9 · aprobación no anterior a la solicitud. */
function rc8rc9Fechas(acc: Acumulador, p: Paquete, s: Solicitud): boolean {
  let retroactiva = false
  const f = p.factura
  const reglaRetro = "Compra no retroactiva (sin factura anterior a la solicitud)"
  if (f && f.fecha < s.fecha_solicitud) {
    retroactiva = true
    registrar(acc, { codigo: "RC8", regla: reglaRetro, estado: "confirmacion", detalle: `RETROACTIVA: la factura ${f.numero} (${f.fecha}) es anterior a la solicitud (${s.fecha_solicitud}). La compra se hizo antes de la OC.` }, "Confirmar la creación como OC retroactiva; quedará marcada en el log de control para medición.")
  } else {
    registrar(acc, { codigo: "RC8", regla: reglaRetro, estado: "ok", detalle: f ? `Factura ${f.numero} (${f.fecha}) no es anterior a la solicitud.` : "No hay factura en el paquete." })
  }
  const reglaFecha = "Fecha de aprobación ≥ fecha de solicitud"
  if (!p.aprobacion) {
    registrar(acc, { codigo: "RC9", regla: reglaFecha, estado: "no_aplica", detalle: "Sin aprobación." })
  } else if (soloFecha(p.aprobacion.fecha) < s.fecha_solicitud) {
    registrar(acc, { codigo: "RC9", regla: reglaFecha, estado: "confirmacion", detalle: `La aprobación (${soloFecha(p.aprobacion.fecha)}) es anterior a la solicitud (${s.fecha_solicitud}).` }, "Confirmar que la aprobación corresponde a esta solicitud.")
  } else {
    registrar(acc, { codigo: "RC9", regla: reglaFecha, estado: "ok", detalle: `Aprobación ${soloFecha(p.aprobacion.fecha)} ≥ solicitud ${s.fecha_solicitud}.` })
  }
  return retroactiva
}

/** RC10 · cantidad × valor unitario = valor total (±1). */
function rc10Aritmetica(acc: Acumulador, s: Solicitud): void {
  const regla = "Cantidad × valor unitario = valor total (±1)"
  const calculado = s.cantidad * s.valor_unitario
  if (Math.abs(calculado - s.valor_total) > TOLERANCIA_ARITMETICA) {
    registrar(acc, { codigo: "RC10", regla, estado: "bloqueo", detalle: `${s.cantidad} × ${formatoMoneda(s.valor_unitario, s.moneda)} = ${formatoMoneda(calculado, s.moneda)} ≠ ${formatoMoneda(s.valor_total, s.moneda)}.` }, "Devolver la solicitud para corregir cantidades o valores.")
  } else {
    registrar(acc, { codigo: "RC10", regla, estado: "ok", detalle: `${s.cantidad} × ${formatoMoneda(s.valor_unitario, s.moneda)} = ${formatoMoneda(calculado, s.moneda)}.` })
  }
}

/** Aplica RC1–RC10 sobre un paquete con solicitud. Función pura: mismo paquete y maestros → mismo resultado. */
export function validarPaquete(p: Paquete, s: Solicitud, m: Maestros): Validacion {
  const acc: Acumulador = { controles: [], bloqueos: [], confirmaciones: [], derivados: {} }
  const proveedor = rc1Proveedor(acc, s, m)
  const centro = rc4Subarea(acc, s, m)
  rc2rc3Aprobacion(acc, p, s, m, centro)
  rc5Cotizacion(acc, p, s)
  rc6rc7Derivados(acc, s, m, proveedor)
  const retroactiva = rc8rc9Fechas(acc, p, s)
  rc10Aritmetica(acc, s)
  const orden = (c: string) => Number(c.replace("RC", ""))
  acc.controles.sort((a, b) => orden(a.codigo) - orden(b.codigo))
  acc.bloqueos.sort((a, b) => orden(a.codigo) - orden(b.codigo))
  acc.confirmaciones.sort((a, b) => orden(a.codigo) - orden(b.codigo))
  return {
    apta: acc.bloqueos.length === 0,
    bloqueos: acc.bloqueos,
    confirmaciones: acc.confirmaciones,
    derivados: acc.derivados,
    retroactiva,
    controles: acc.controles,
    proveedor,
  }
}
