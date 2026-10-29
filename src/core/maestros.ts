import { join } from "node:path"
import { z } from "zod"
import { leerJson } from "./archivos.ts"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
} from "./esquemas.ts"
import { dirFixtures, type Ctx } from "./rutas.ts"

export type ResultadoMaestros = { ok: true; maestros: Maestros } | { ok: false; error: string }

/** Carga los cuatro maestros de referencia. En producción se reemplaza por consultas a SAP. */
export async function cargarMaestros(ctx: Ctx): Promise<ResultadoMaestros> {
  const base = join(dirFixtures(ctx), "maestros")
  const [proveedores, centros, iva, condiciones] = await Promise.all([
    leerJson(join(base, "proveedores.json"), z.array(ProveedorSchema)),
    leerJson(join(base, "centros-costo.json"), z.array(CentroCostoSchema)),
    leerJson(join(base, "indicadores-iva.json"), z.array(IndicadorIvaSchema)),
    leerJson(join(base, "condiciones-pago.json"), z.array(CondicionPagoSchema)),
  ])
  if (!proveedores.ok) return { ok: false, error: `Maestro de proveedores: ${proveedores.motivo}` }
  if (!centros.ok) return { ok: false, error: `Maestro de centros de costo: ${centros.motivo}` }
  if (!iva.ok) return { ok: false, error: `Maestro de indicadores IVA: ${iva.motivo}` }
  if (!condiciones.ok) return { ok: false, error: `Maestro de condiciones de pago: ${condiciones.motivo}` }
  return {
    ok: true,
    maestros: {
      proveedores: proveedores.valor,
      centros: centros.valor,
      iva: iva.valor,
      condiciones: condiciones.valor,
    },
  }
}
