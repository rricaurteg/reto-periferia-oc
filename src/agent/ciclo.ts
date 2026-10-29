/**
 * Ciclo del agente (PRD 6.3): prompt → modelo → herramientas → respuesta, con tope de iteraciones,
 * tope de tokens por sesión y confirmación humana reforzada en código (no solo en el prompt).
 */
import { registrarLlamada } from "../core/registro.ts"
import { dirOut, type Ctx } from "../core/rutas.ts"
import { ErrorLlm, type Bloque, type DefinicionHerramienta, type LlmAdapter } from "../llm/adapter.ts"
import type { HerramientaRegistrada } from "../tools/index.ts"
import type { LlamadaVisible, Sesion } from "./sesiones.ts"

export type Dependencias = {
  llm: LlmAdapter
  herramientas: HerramientaRegistrada[]
  system: string
  directory: string
  maxIteraciones: number
  maxTokensSesion: number
}

export type ResultadoTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; error: boolean }

type Json = Record<string, unknown>

function sinTildes(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/** ¿El mensaje del usuario es una confirmación explícita? */
export function esAfirmativo(mensaje: string): boolean {
  const t = sinTildes(mensaje)
  if (/^(no\b|cancel|espera|aun no|todavia no)/.test(t)) return false
  return /\b(confirmo|confirmado|confirmar|si|apruebo|aprobado|procede|proceder|procedan|adelante|dale|ok|de acuerdo|crear|creala|crealas|hazlo)\b/.test(t)
}

function parsear(texto: string): Json {
  try {
    const v: unknown = JSON.parse(texto)
    return v && typeof v === "object" ? (v as Json) : { ok: false, error: "Respuesta no es un objeto" }
  } catch {
    return { ok: false, error: "Respuesta no es JSON" }
  }
}

function casoDe(args: unknown): string {
  const c = args && typeof args === "object" ? (args as Json).caso : undefined
  return typeof c === "string" ? c.trim().toLowerCase() : ""
}

function codigos(x: unknown): string {
  return Array.isArray(x) ? x.map((h) => (h as Json).codigo).join(", ") || "—" : "—"
}

/** Resumen de una línea para la tarjeta de la herramienta en el chat. */
function resumir(nombre: string, r: Json): string {
  if (r.ok !== true) return `Error: ${String(r.error ?? "desconocido")}`
  const d = (r.data ?? {}) as Json
  switch (nombre) {
    case "oc_listar_casos": return `${Array.isArray(r.data) ? r.data.length : 0} casos disponibles`
    case "oc_leer_paquete": return `Paquete leído · faltantes: ${Array.isArray(d.faltantes) && d.faltantes.length ? d.faltantes.join(", ") : "ninguno"}`
    case "oc_validar": return `apta=${String(d.apta)} · bloqueos: ${codigos(d.bloqueos)} · confirmaciones: ${codigos(d.confirmaciones)} · retroactiva=${String(d.retroactiva)}`
    case "oc_construir_payload": return `OC construida y validada con zod · requiere confirmación=${String(d.requiere_confirmacion)}`
    case "oc_generar_evidencia": return `Evidencia ${String(d.ruta_pdf ?? d.ruta)} · sha256 ${String(d.sha256).slice(0, 12)}…`
    case "oc_crear": return d.idempotente ? `OC ${String(d.numero_oc)} (ya existía: idempotente)` : `OC ${String(d.numero_oc)} creada${d.retroactiva ? " · RETROACTIVA" : ""}`
    default: return "OK"
  }
}

/** Actualiza los casos con confirmación pendiente según el resultado de cada herramienta. */
function seguirPendientes(s: Sesion, nombre: string, caso: string, r: Json): void {
  if (!caso) return
  const d = (r.data ?? {}) as Json
  const conConfirmaciones = Array.isArray(d.confirmaciones) && d.confirmaciones.length > 0
  if (nombre === "oc_validar" && r.ok === true && d.apta === true && conConfirmaciones) s.pendientes.add(caso)
  if (nombre === "oc_construir_payload" && r.ok === true && d.requiere_confirmacion === true) s.pendientes.add(caso)
  if (nombre === "oc_crear" && r.ok === true) s.pendientes.delete(caso)
  if (nombre === "oc_crear" && r.ok !== true && r.requiere_confirmacion === true) s.pendientes.add(caso)
}

/** ¿La ÚLTIMA pregunta del texto pide confirmar? (evita falsos positivos como "Excepción confirmada … ¿Quieres procesar otra?") */
export function pideConfirmacion(texto: string): boolean {
  const fin = texto.lastIndexOf("?")
  if (fin === -1) return false
  const inicio = Math.max(texto.lastIndexOf("¿", fin), texto.lastIndexOf("\n", fin) + 1, 0)
  return /confirm/i.test(texto.slice(inicio, fin + 1))
}

async function ejecutarLlamada(
  b: Extract<Bloque, { tipo: "llamada" }>,
  deps: Dependencias,
  ctx: Ctx,
  confirmacionOtorgada: boolean,
): Promise<{ visible: LlamadaVisible; resultado: string; parseado: Json }> {
  const inicio = Date.now()
  const h = deps.herramientas.find((x) => x.nombre === b.nombre)
  let args: unknown = b.args
  let nota: string | undefined
  // Política: oc_crear con confirmado=true solo si el usuario confirmó en su último mensaje.
  if (b.nombre === "oc_crear" && args && typeof args === "object" && (args as Json).confirmado === true && !confirmacionOtorgada) {
    args = { ...(args as Json), confirmado: false }
    nota = "El backend ignoró confirmado=true: el usuario no ha confirmado explícitamente en el chat."
  }
  const resultado = h
    ? await h.ejecutar(args, ctx)
    : JSON.stringify({ ok: false, error: `Herramienta desconocida: ${b.nombre}` })
  const parseado = parsear(resultado)
  if (nota) parseado.nota_backend = nota
  const final = nota ? JSON.stringify(parseado) : resultado
  const ms = Date.now() - inicio
  await registrarLlamada(dirOut(ctx), { sesion: ctx.sessionId, herramienta: b.nombre, args, ok: parseado.ok === true, ms, resultado: parseado }).catch(() => undefined)
  return {
    visible: { nombre: b.nombre, args, ok: parseado.ok === true, resumen: resumir(b.nombre, parseado), resultado: parseado, ms, nota },
    resultado: final,
    parseado,
  }
}

function textoDe(bloques: Bloque[]): string {
  return bloques.filter((b): b is Extract<Bloque, { tipo: "texto" }> => b.tipo === "texto").map((b) => b.texto).join("\n").trim()
}

/** Ejecuta un turno completo del agente para un mensaje del usuario. Nunca lanza: los errores vuelven como texto claro. */
export async function ejecutarTurno(s: Sesion, mensaje: string, deps: Dependencias): Promise<ResultadoTurno> {
  const ctx: Ctx = { directory: deps.directory, sessionId: s.id }
  const confirmacionOtorgada = s.esperandoConfirmacion && esAfirmativo(mensaje)
  const respaldo = s.mensajes.length
  const toolCalls: LlamadaVisible[] = []
  const definiciones: DefinicionHerramienta[] = deps.herramientas.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, esquema: h.esquemaJson }))

  if (s.tokens >= deps.maxTokensSesion) {
    return { reply: `Esta sesión alcanzó el tope de ${deps.maxTokensSesion.toLocaleString("es-CO")} tokens. Inicia una sesión nueva para continuar.`, toolCalls, needsConfirmation: false, error: true }
  }

  const contexto = confirmacionOtorgada ? `${mensaje}\n\n[backend: el usuario confirmó explícitamente las excepciones pendientes de: ${[...s.pendientes].join(", ") || "la acción propuesta"}]` : mensaje
  // Una confirmación solo vale para el mensaje inmediatamente siguiente (PRD CA3): si no confirma, lo pendiente se descarta.
  if (!confirmacionOtorgada) s.pendientes.clear()
  s.mensajes.push({ rol: "usuario", bloques: [{ tipo: "texto", texto: contexto }] })

  let reply = ""
  try {
    for (let i = 1; ; i++) {
      if (i > deps.maxIteraciones) {
        const hechas = toolCalls.map((t) => `${t.nombre} (${t.ok ? "ok" : "error"})`).join(", ")
        reply = `Alcancé el tope de ${deps.maxIteraciones} iteraciones en este turno. Herramientas ejecutadas: ${hechas || "ninguna"}. Falta completar el proceso: pídeme que continúe.`
        s.mensajes.push({ rol: "asistente", bloques: [{ tipo: "texto", texto: reply }] })
        break
      }
      if (s.tokens >= deps.maxTokensSesion) throw new ErrorLlm("Se alcanzó el tope de tokens de la sesión durante el turno.")
      const r = await deps.llm.enviar(deps.system, s.mensajes, definiciones)
      s.tokens += r.uso.entrada + r.uso.salida
      const bloques = r.bloques.length ? r.bloques : [{ tipo: "texto" as const, texto: "(sin respuesta)" }]
      s.mensajes.push({ rol: "asistente", bloques })
      const llamadas = bloques.filter((b): b is Extract<Bloque, { tipo: "llamada" }> => b.tipo === "llamada")
      if (r.fin !== "herramientas" || llamadas.length === 0) {
        reply = textoDe(bloques) || "(sin respuesta)"
        break
      }
      const resultados: Bloque[] = []
      for (const b of llamadas) {
        const e = await ejecutarLlamada(b, deps, ctx, confirmacionOtorgada)
        toolCalls.push(e.visible)
        seguirPendientes(s, b.nombre, casoDe(e.visible.args), e.parseado)
        resultados.push({ tipo: "resultado", id: b.id, contenido: e.resultado, esError: e.parseado.ok !== true })
      }
      s.mensajes.push({ rol: "usuario", bloques: resultados })
    }
  } catch (e) {
    s.mensajes.length = respaldo // la sesión no muere: se descarta el turno incompleto
    const texto = e instanceof ErrorLlm ? e.message : "Ocurrió un error inesperado en el agente. Intenta de nuevo."
    s.esperandoConfirmacion = false
    return { reply: `⚠️ ${texto}`, toolCalls, needsConfirmation: false, error: true }
  }

  const needsConfirmation = s.pendientes.size > 0 || pideConfirmacion(reply)
  s.esperandoConfirmacion = needsConfirmation
  return { reply, toolCalls, needsConfirmation, error: false }
}
