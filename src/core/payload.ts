import { OrdenCompraSchema, type OrdenCompra, type Paquete, type Solicitud } from "./esquemas.ts"
import { contenidoEvidencia, sha256 } from "./evidencia.ts"
import type { Validacion } from "./reglas.ts"

const LIMITE_TEXTO_BREVE = 40

/** Unidad SAP derivada de la descripción: horas → H, mensualidades → MES, resto → UN. */
export function derivarUnidad(descripcion: string): "UN" | "H" | "MES" {
  const t = descripcion.toLowerCase()
  if (/\bhoras?\b/.test(t)) return "H"
  if (/\b(mensualidad(es)?|por mes|suscripci[oó]n mensual)\b/.test(t)) return "MES"
  return "UN"
}

function textoBreve(descripcion: string): string {
  if (descripcion.length <= LIMITE_TEXTO_BREVE) return descripcion
  return descripcion.slice(0, LIMITE_TEXTO_BREVE).trimEnd()
}

export type ResultadoPayload =
  | { ok: true; orden: OrdenCompra; trazabilidad: Record<string, string> }
  | { ok: false; error: string }

/** Construye la OC (PRD 7.4) a partir del paquete y la validación. Cada valor queda trazado a su fuente. */
export function construirOrden(p: Paquete, s: Solicitud, v: Validacion): ResultadoPayload {
  if (!v.apta || !v.proveedor) {
    return { ok: false, error: `No se construye la OC: hay bloqueos (${v.bloqueos.map((b) => b.codigo).join(", ")}).` }
  }
  if (!p.aprobacion || !p.correo) return { ok: false, error: "Falta el correo o la aprobación para construir la OC." }

  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor
  const pago = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor
  if (!iva || !pago) return { ok: false, error: "No fue posible determinar indicador IVA o condiciones de pago." }

  const descripcion = textoBreve(s.descripcion)
  const orden: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: v.proveedor.codigo_sap, nit: v.proveedor.nit, nombre: v.proveedor.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: {
      email: p.aprobacion.de,
      fecha_aprobacion: p.aprobacion.fecha,
      evidencia_sha256: sha256(contenidoEvidencia(p.aprobacion)),
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: s.cantidad,
        unidad: derivarUnidad(s.descripcion),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }

  const trazabilidad: Record<string, string> = {
    "referencia.solicitud_id": "solicitud.solicitud_id",
    "referencia.correo_id": "correo.id",
    "referencia.cotizacion_ref": p.cotizacion?.referencia ? "cotizacion (encabezado COTIZACIÓN)" : "sin cotización",
    sociedad: "constante del proceso (PRD 7.4)",
    organizacion_compras: "constante del proceso (PRD 7.4)",
    "proveedor.codigo_sap": "maestro.proveedores",
    "proveedor.nit": "maestro.proveedores",
    "proveedor.nombre": "maestro.proveedores",
    moneda: "solicitud.moneda",
    condiciones_pago: s.condiciones_pago ? "solicitud.condiciones_pago" : "derivado (maestro.proveedores.condiciones_pago_default)",
    "aprobador.email": "aprobacion.de",
    "aprobador.fecha_aprobacion": "aprobacion.fecha",
    "aprobador.evidencia_sha256": "derivado (sha256 de la evidencia de aprobación)",
    "posiciones[0].numero": "derivado (numeración SAP 10, 20, 30…)",
    "posiciones[0].descripcion":
      descripcion === s.descripcion ? "solicitud.descripcion" : `solicitud.descripcion (truncada a ${LIMITE_TEXTO_BREVE} caracteres, límite SAP)`,
    "posiciones[0].cantidad": "solicitud.cantidad",
    "posiciones[0].unidad": "derivado (de solicitud.descripcion)",
    "posiciones[0].precio_unitario": "solicitud.valor_unitario",
    "posiciones[0].centro_costo": "solicitud.centro_costo (validado contra maestro.centros-costo)",
    "posiciones[0].subarea": "solicitud.subarea (validado contra maestro.centros-costo)",
    "posiciones[0].indicador_iva": s.indicador_iva ? "solicitud.indicador_iva" : "derivado (maestro.proveedores.indicador_iva_default)",
    excepciones: "oc_validar (confirmaciones pendientes)",
  }

  const r = OrdenCompraSchema.safeParse(orden)
  if (!r.success) return { ok: false, error: `La OC no cumple el esquema: ${r.error.issues.map((i) => i.message).join("; ")}` }
  return { ok: true, orden: r.data, trazabilidad }
}

/** Serialización estable (claves ordenadas) para comparar payloads sin depender del orden de las claves. */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`
  if (valor && typeof valor === "object") {
    const obj = valor as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(",")}}`
  }
  return JSON.stringify(valor)
}

/** Compara dos OC ignorando quién confirmó las excepciones (eso lo fija el backend, no el modelo). */
export function mismaOrden(a: OrdenCompra, b: OrdenCompra): boolean {
  const sinFirma = (o: OrdenCompra) => ({ ...o, excepciones: o.excepciones.map((e) => ({ ...e, confirmado_por: null })) })
  return canonico(sinFirma(a)) === canonico(sinFirma(b))
}
