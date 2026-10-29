/**
 * Verificación sin modelo de lenguaje: recorre los 6 casos llamando directamente a las herramientas.
 * Lo usan demo.ts (consola) y el botón "Ejecutar demo" del chat (endpoint /api/demo).
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { OrdenCompra } from "../core/esquemas.ts"
import type { Hallazgo } from "../core/reglas.ts"
import { dirOut, type Ctx } from "../core/rutas.ts"
import * as oc from "../tools/oc.ts"

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string; [k: string]: unknown }
type DatosValidacion = { apta: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[]; retroactiva: boolean; derivados: Record<string, { valor: string }> }
type DatosPayload = { orden: OrdenCompra }
type DatosCrear = { numero_oc: string; idempotente: boolean; retroactiva: boolean }

const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]
/** Casos cuyas confirmaciones se aceptan explícitamente en la demo (equivale a que la analista escriba "confirmo"). */
const CONFIRMAR = new Set(["sol-004", "sol-005", "sol-006"])

function parse<T>(s: string): Respuesta<T> {
  return JSON.parse(s) as Respuesta<T>
}

function lista(h: Hallazgo[]): string {
  return h.length ? h.map((x) => `${x.codigo}`).join(", ") : "—"
}

async function intentarCrear(ctx: Ctx, caso: string, payload: OrdenCompra | undefined, confirmado: boolean, log: (s: string) => void): Promise<string> {
  const r = parse<DatosCrear>(await oc.crear.execute({ caso, payload, confirmado }, ctx))
  if (r.ok) {
    const marca = r.data.idempotente ? " (IDEMPOTENTE: ya existía, no se creó otra)" : ""
    log(`   → OC ${r.data.numero_oc}${marca}`)
    return r.data.numero_oc
  }
  log(`   → No creada: ${r.error}`)
  return "—"
}

async function procesar(ctx: Ctx, caso: string, log: (s: string) => void): Promise<{ caso: string; resultado: string; retroactiva: boolean }> {
  log(`\n━━━ ${caso} ━━━`)
  const v = parse<DatosValidacion>(await oc.validar.execute({ caso }, ctx))
  if (!v.ok) {
    log(`   ERROR: ${v.error}`)
    return { caso, resultado: `error: ${v.error}`, retroactiva: false }
  }
  const d = v.data
  log(`   apta=${d.apta}  retroactiva=${d.retroactiva}`)
  log(`   bloqueos: ${lista(d.bloqueos)}`)
  d.bloqueos.forEach((b) => log(`     · ${b.codigo}: ${b.detalle}\n       acción: ${b.accion_sugerida}`))
  log(`   confirmaciones: ${lista(d.confirmaciones)}`)
  d.confirmaciones.forEach((c) => log(`     · ${c.codigo}: ${c.detalle}`))
  const derivados = Object.entries(d.derivados).map(([k, x]) => `${k}=${x.valor}`).join(", ")
  if (derivados) log(`   derivados: ${derivados}`)

  if (!d.apta) {
    log("   Intento de creación (queda registrado como bloqueado en control.csv):")
    await intentarCrear(ctx, caso, undefined, false, log)
    return { caso, resultado: `bloqueada (${lista(d.bloqueos)})`, retroactiva: d.retroactiva }
  }
  const p = parse<DatosPayload>(await oc.construir_payload.execute({ caso }, ctx))
  if (!p.ok) return { caso, resultado: `error: ${p.error}`, retroactiva: d.retroactiva }
  const ev = parse<{ ruta: string; sha256: string }>(await oc.generar_evidencia.execute({ caso }, ctx))
  if (ev.ok) log(`   evidencia: ${ev.data.ruta} (sha256 ${ev.data.sha256.slice(0, 12)}…)`)

  let numero = "—"
  if (d.confirmaciones.length > 0) {
    log("   Intento SIN confirmación:")
    await intentarCrear(ctx, caso, p.data.orden, false, log)
    if (CONFIRMAR.has(caso)) {
      log("   Analista confirma explícitamente (confirmado=true):")
      numero = await intentarCrear(ctx, caso, p.data.orden, true, log)
    }
  } else {
    numero = await intentarCrear(ctx, caso, p.data.orden, false, log)
  }
  return { caso, resultado: numero === "—" ? "pendiente de confirmación" : `OC ${numero}`, retroactiva: d.retroactiva }
}

/** Antes de crear nada: un payload alterado (precio rebajado) debe ser rechazado aunque el caso sea apto. */
async function pruebaPayloadAlterado(ctx: Ctx, log: (s: string) => void): Promise<void> {
  log("\n━━━ Antialteración (antes de procesar) ━━━")
  const p = parse<DatosPayload>(await oc.construir_payload.execute({ caso: "sol-001" }, ctx))
  if (!p.ok) return
  const alterada: OrdenCompra = {
    ...p.data.orden,
    posiciones: p.data.orden.posiciones.map((x) => ({ ...x, precio_unitario: x.precio_unitario - 5000 })),
  }
  log("   sol-001 con precio unitario rebajado en 5.000 por quien llama:")
  await intentarCrear(ctx, "sol-001", alterada, false, log)
}

async function pruebasDeRobustez(ctx: Ctx, log: (s: string) => void): Promise<void> {
  log("\n━━━ Robustez ━━━")
  log("   Idempotencia: sol-001 por segunda vez")
  const p = parse<DatosPayload>(await oc.construir_payload.execute({ caso: "sol-001" }, ctx))
  if (p.ok) await intentarCrear(ctx, "sol-001", p.data.orden, false, log)
  log("   Caso inexistente: sol-999")
  const r = parse<unknown>(await oc.leer_paquete.execute({ caso: "sol-999" }, ctx))
  log(`   → ${r.ok ? "inesperado" : r.error}`)
  log("   Ruta maliciosa: ../../etc")
  const m = parse<unknown>(await oc.leer_paquete.execute({ caso: "../../etc" }, ctx))
  log(`   → ${m.ok ? "inesperado" : m.error}`)
}

/** Ejecuta la verificación completa y devuelve el texto generado. */
export async function ejecutarDemo(ctx: Ctx, log: (s: string) => void): Promise<void> {
  log("DEMO · Agente de Órdenes de Compra · verificación sin modelo de lenguaje")
  const resumen: Array<{ caso: string; resultado: string; retroactiva: boolean }> = []
  await pruebaPayloadAlterado(ctx, log)
  for (const caso of CASOS) resumen.push(await procesar(ctx, caso, log))
  await pruebasDeRobustez(ctx, log)

  log("\n━━━ Resumen ━━━")
  resumen.forEach((r) => log(`   ${r.caso}  ${r.retroactiva ? "[RETROACTIVA] " : ""}${r.resultado}`))
  const control = await readFile(join(dirOut(ctx), "control.csv"), "utf8").catch(() => "(sin control.csv)")
  log(`\n━━━ out/control.csv ━━━\n${control}`)
}
