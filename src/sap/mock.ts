import { join } from "node:path"
import { agregarLinea, leerTexto } from "../core/archivos.ts"
import type { OrdenCompra, Proveedor } from "../core/esquemas.ts"
import { normalizarNit } from "../core/texto.ts"
import type { SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO = 4500000001

type Registro = { numero_oc: string; fecha: string; orden: OrdenCompra }

/** SAP simulado: numeración secuencial desde 4500000001 sobre out/sap/ordenes.jsonl. */
export class SapMock implements SapAdapter {
  private readonly archivo: string
  /** Serializa escrituras para que dos llamadas simultáneas no tomen el mismo número. */
  private static cola: Promise<unknown> = Promise.resolve()

  constructor(outDir: string, private readonly proveedores: Proveedor[]) {
    this.archivo = join(outDir, "sap", "ordenes.jsonl")
  }

  private async leerTodas(): Promise<Registro[]> {
    const t = await leerTexto(this.archivo)
    if (!t.ok) return []
    return t.valor
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const p = this.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = (await this.leerTodas()).find((o) => o.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  async buscarRegistro(solicitud_id: string): Promise<Registro | null> {
    return (await this.leerTodas()).find((o) => o.orden.referencia.solicitud_id === solicitud_id) ?? null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const tarea = SapMock.cola.then(async () => {
      const todas = await this.leerTodas()
      const existente = todas.find((o) => o.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
      if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
      const registro: Registro = {
        numero_oc: String(PRIMER_NUMERO + todas.length),
        fecha: new Date().toISOString(),
        orden,
      }
      await agregarLinea(this.archivo, JSON.stringify(registro))
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
    SapMock.cola = tarea.catch(() => undefined)
    return tarea
  }
}
