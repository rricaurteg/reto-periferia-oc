/**
 * Herramientas del agente de Órdenes de Compra. Cada export es una herramienta; el modelo la ve como `oc_<export>`.
 * Son la única fuente de valores que el agente puede afirmar (PRD CA2). No dependen del servidor HTTP: demo.ts las importa directo.
 */
import { join } from "node:path"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import { escribir } from "../core/archivos.ts"
import { OrdenCompraSchema, PaqueteSchema, type Maestros, type Paquete, type Solicitud } from "../core/esquemas.ts"
import { escribirEvidencia } from "../core/evidencia.ts"
import { cargarMaestros } from "../core/maestros.ts"
import { leerPaquete, listarCasos } from "../core/paquete.ts"
import { construirOrden, mismaOrden } from "../core/payload.ts"
import { registrarControl } from "../core/registro.ts"
import { validarPaquete, type Validacion } from "../core/reglas.ts"
import { casoValido, dirCaso, dirOut, type Ctx } from "../core/rutas.ts"
import { SapMock } from "../sap/mock.ts"
import { exito, fallo, herramienta } from "./tipos.ts"

const argCaso = z
  .string()
  .describe('Carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-004" (también acepta "SOL-2026-004").')

/** "SOL-2026-004" → "sol-004"; "sol-004" → "sol-004". */
function normalizarCaso(caso: string): string {
  const t = caso.trim().toLowerCase()
  const m = t.match(/^sol-\d{4}-(\d{3})$/)
  return m ? `sol-${m[1]}` : t
}

type Preparado =
  | { ok: true; caso: string; paquete: Paquete; solicitud: Solicitud; maestros: Maestros; validacion: Validacion }
  | { ok: false; error: string }

/** Relee el caso desde los fixtures (fuente de verdad) y aplica las reglas. El paquete que envíe el modelo nunca se usa como fuente. */
async function preparar(ctx: Ctx, casoEntrada: string): Promise<Preparado> {
  const caso = normalizarCaso(casoEntrada)
  if (!casoValido(caso)) return { ok: false, error: `Nombre de caso inválido: "${casoEntrada}".` }
  if (!existsSync(dirCaso(ctx, caso))) return { ok: false, error: `No existe el caso "${caso}". Usa oc_listar_casos para ver los disponibles.` }
  const m = await cargarMaestros(ctx)
  if (!m.ok) return { ok: false, error: m.error }
  const paquete = await leerPaquete(ctx, caso)
  if (!paquete.solicitud) {
    const detalle = paquete.faltantes.find((f) => f.startsWith("solicitud.json")) ?? "solicitud.json"
    return { ok: false, error: `Paquete incompleto: ${detalle}. Pedir al solicitante que reenvíe el Excel de solicitud completo.` }
  }
  return { ok: true, caso, paquete, solicitud: paquete.solicitud, maestros: m.maestros, validacion: validarPaquete(paquete, paquete.solicitud, m.maestros) }
}

function resumenValidacion(v: Validacion) {
  return {
    apta: v.apta,
    bloqueos: v.bloqueos,
    confirmaciones: v.confirmaciones,
    derivados: v.derivados,
    retroactiva: v.retroactiva,
    controles: v.controles,
  }
}

/** Último resultado registrado en out/control.csv por solicitud_id (creada, bloqueado, pendiente…). */
async function ultimosIntentos(ctx: Ctx): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  const csv = await readFile(join(dirOut(ctx), "control.csv"), "utf8").catch(() => "")
  for (const linea of csv.split("\n").slice(1)) {
    const [id, resultado] = linea.split(",")
    if (id && resultado) mapa.set(id, resultado)
  }
  return mapa
}

export const listar_casos = herramienta({
  description: "Lista las solicitudes de compra disponibles con su estado actual (sin procesar, pendiente de confirmación, bloqueada u OC creada con su número).",
  args: {},
  async execute(_args, ctx) {
    try {
      const casos = await listarCasos(ctx)
      const sap = new SapMock(dirOut(ctx), [])
      const intentos = await ultimosIntentos(ctx)
      const conEstado = await Promise.all(
        casos.map(async (c) => {
          const registro = c.solicitud_id ? await sap.buscarRegistro(c.solicitud_id) : null
          const intento = c.solicitud_id ? intentos.get(c.solicitud_id) : undefined
          const estado = registro
            ? `OC creada ${registro.numero_oc}`
            : intento === "bloqueado"
              ? "bloqueada (no se puede crear OC)"
              : intento === "pendiente"
                ? "pendiente de confirmación"
                : "sin procesar"
          return { ...c, estado, numero_oc: registro?.numero_oc ?? null }
        }),
      )
      return exito(conEstado)
    } catch (e) {
      return fallo(`No se pudieron listar los casos: ${(e as Error).message}`)
    }
  },
})

export const leer_paquete = herramienta({
  description: "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso y los devuelve normalizados.",
  args: { caso: argCaso },
  async execute({ caso }, ctx) {
    try {
      const c = normalizarCaso(caso)
      if (!casoValido(c)) return fallo(`Nombre de caso inválido: "${caso}".`)
      if (!existsSync(dirCaso(ctx, c))) return fallo(`No existe el caso "${c}". Usa oc_listar_casos para ver los disponibles.`)
      return exito(await leerPaquete(ctx, c))
    } catch (e) {
      return fallo(`Error leyendo el paquete: ${(e as Error).message}`)
    }
  },
})

export const validar = herramienta({
  description: "Aplica las reglas de control RC1–RC10 contra los maestros y devuelve si la OC es apta, sus bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: {
    caso: argCaso,
    paquete: PaqueteSchema.optional().describe("Opcional: paquete devuelto por oc_leer_paquete. Por seguridad la herramienta relee el caso como fuente de verdad."),
  },
  async execute({ caso }, ctx) {
    try {
      const p = await preparar(ctx, caso)
      if (!p.ok) return fallo(p.error)
      return exito(resumenValidacion(p.validacion))
    } catch (e) {
      return fallo(`Error validando: ${(e as Error).message}`)
    }
  },
})

export const construir_payload = herramienta({
  description: "Construye la orden de compra exactamente como quedaría en SAP, validada con zod, y guarda la trazabilidad de cada campo.",
  args: {
    caso: argCaso,
    paquete: PaqueteSchema.optional().describe("Opcional: paquete de oc_leer_paquete. La herramienta relee el caso como fuente de verdad."),
    derivados: z.record(z.string(), z.unknown()).optional().describe("Opcional: derivados de oc_validar. Se recalculan en el backend."),
  },
  async execute({ caso }, ctx) {
    try {
      const p = await preparar(ctx, caso)
      if (!p.ok) return fallo(p.error)
      const r = construirOrden(p.paquete, p.solicitud, p.validacion)
      if (!r.ok) return fallo(r.error, { bloqueos: p.validacion.bloqueos })
      const ruta = join(dirOut(ctx), p.caso, "trazabilidad.json")
      await escribir(ruta, JSON.stringify(r.trazabilidad, null, 2))
      return exito({
        orden: r.orden,
        total: { valor: p.solicitud.valor_total, moneda: p.solicitud.moneda, fuente: "solicitud.valor_total" },
        ruta_trazabilidad: ruta.replace(`${ctx.directory}/`, ""),
        requiere_confirmacion: p.validacion.confirmaciones.length > 0,
        confirmaciones: p.validacion.confirmaciones,
        retroactiva: p.validacion.retroactiva,
      })
    } catch (e) {
      return fallo(`Error construyendo la OC: ${(e as Error).message}`)
    }
  },
})

export const generar_evidencia = herramienta({
  description: "Genera la evidencia del correo de aprobación (aprobacion.txt y aprobacion.pdf) con su hash sha256.",
  args: { caso: argCaso },
  async execute({ caso }, ctx) {
    try {
      const c = normalizarCaso(caso)
      if (!casoValido(c) || !existsSync(dirCaso(ctx, c))) return fallo(`No existe el caso "${caso}".`)
      const paquete = await leerPaquete(ctx, c)
      if (!paquete.aprobacion) return fallo("El paquete no tiene correo de aprobación. Pedirlo al solicitante.")
      const ev = await escribirEvidencia(dirOut(ctx), c, paquete.aprobacion)
      const rel = (r: string) => r.replace(`${ctx.directory}/`, "")
      return exito({ ruta: rel(ev.ruta), ruta_pdf: rel(ev.ruta_pdf), sha256: ev.sha256 })
    } catch (e) {
      return fallo(`Error generando la evidencia: ${(e as Error).message}`)
    }
  },
})

export const crear = herramienta({
  description: "Crea la OC en el SAP simulado si es apta (si tiene confirmaciones exige confirmado=true); también registra en el log de control los intentos bloqueados o pendientes. Idempotente por solicitud_id.",
  args: {
    caso: argCaso,
    payload: OrdenCompraSchema.optional().describe("La orden devuelta por oc_construir_payload, sin modificar. Si se omite, el backend la reconstruye desde el caso."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en el chat las excepciones pendientes."),
  },
  async execute({ caso, payload, confirmado }, ctx) {
    try {
      const p = await preparar(ctx, caso)
      if (!p.ok) return fallo(p.error)
      const v = p.validacion
      const out = dirOut(ctx)
      const id = p.solicitud.solicitud_id
      const base = { solicitud_id: id, retroactiva: v.retroactiva, bloqueos: v.bloqueos.map((b) => b.codigo), confirmaciones: v.confirmaciones.map((c) => c.codigo) }
      const sap = new SapMock(out, p.maestros.proveedores)

      const existente = await sap.buscarRegistro(id)
      if (existente) {
        await registrarControl(out, { ...base, resultado: "existente", numero_oc: existente.numero_oc })
        return exito({ numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente: true, retroactiva: v.retroactiva })
      }
      if (!v.apta) {
        await registrarControl(out, { ...base, resultado: "bloqueado", numero_oc: null })
        return fallo("La OC no se crea: la solicitud tiene bloqueos de control.", { bloqueos: v.bloqueos })
      }
      if (v.confirmaciones.length > 0 && confirmado !== true) {
        await registrarControl(out, { ...base, resultado: "pendiente", numero_oc: null })
        return fallo("Requiere confirmación humana antes de crear la OC.", { requiere_confirmacion: true, confirmaciones: v.confirmaciones })
      }
      const r = construirOrden(p.paquete, p.solicitud, v)
      if (!r.ok) return fallo(r.error)
      if (payload && !mismaOrden(payload, r.orden)) {
        await registrarControl(out, { ...base, resultado: "error", numero_oc: null })
        return fallo("El payload recibido no coincide con el validado (posible alteración). Vuelve a llamar oc_construir_payload y usa su salida sin modificarla.")
      }
      const firma = confirmado ? `analista (sesión ${ctx.sessionId})` : null
      const orden = { ...r.orden, excepciones: r.orden.excepciones.map((e) => ({ ...e, confirmado_por: firma })) }
      const ev = p.paquete.aprobacion ? await escribirEvidencia(out, p.caso, p.paquete.aprobacion) : null
      const creada = await sap.crearOrden(orden)
      await registrarControl(out, { ...base, resultado: "creada", numero_oc: creada.numero_oc })
      return exito({
        numero_oc: creada.numero_oc,
        fecha: creada.fecha,
        idempotente: false,
        retroactiva: v.retroactiva,
        evidencia: ev ? ev.ruta_pdf.replace(`${ctx.directory}/`, "") : null,
        excepciones_confirmadas: orden.excepciones.map((e) => e.codigo),
      })
    } catch (e) {
      return fallo(`Error creando la OC: ${(e as Error).message}`)
    }
  },
})
