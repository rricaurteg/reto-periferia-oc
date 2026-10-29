import type { OrdenCompra } from "../core/esquemas.ts"

/** Contrato con SAP (PRD 7.4). El mock escribe en archivos; la implementación real usaría OData/BAPI (ver SOLUCION.md §6). */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
