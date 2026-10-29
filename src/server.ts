/**
 * Servidor HTTP: API del chat + archivos estáticos del front. Solo orquesta; la lógica vive en
 * src/agent (ciclo), src/tools (ejecución) y agent/prompt.md + src/knowledge (comportamiento y conocimiento).
 */
import { readFile, rm } from "node:fs/promises"
import { join, normalize } from "node:path"
import { ejecutarTurno, type Dependencias } from "./agent/ciclo.ts"
import { buscarSesion, guardarSesion, idValido, obtenerSesion } from "./agent/sesiones.ts"
import { config, crearAdaptador } from "./config.ts"
import { casoValido } from "./core/rutas.ts"
import { ejecutarDemo } from "./demo/ejecutar.ts"
import { HERRAMIENTAS } from "./tools/index.ts"

const RAIZ = join(import.meta.dir, "..")
const OUT = join(RAIZ, "out")
const WEB = join(RAIZ, "web")
const MAX_MENSAJE = 4000

async function cargarSystemPrompt(): Promise<string> {
  const prompt = await readFile(join(RAIZ, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(RAIZ, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt}\n\n---\n\n${conocimiento}`
}

const llm = crearAdaptador()
const deps: Dependencias = {
  llm,
  herramientas: HERRAMIENTAS,
  system: await cargarSystemPrompt(),
  directory: RAIZ,
  maxIteraciones: config.maxIteraciones,
  maxTokensSesion: config.maxTokensSesion,
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json; charset=utf-8" } })
}

async function chat(req: Request): Promise<Response> {
  let cuerpo: { sessionId?: unknown; message?: unknown }
  try {
    cuerpo = (await req.json()) as typeof cuerpo
  } catch {
    return json({ ok: false, error: "Cuerpo JSON inválido." }, 400)
  }
  const sessionId = typeof cuerpo.sessionId === "string" && idValido(cuerpo.sessionId) ? cuerpo.sessionId : crypto.randomUUID()
  const message = typeof cuerpo.message === "string" ? cuerpo.message.trim() : ""
  if (!message) return json({ ok: false, error: "El mensaje está vacío." }, 400)
  if (message.length > MAX_MENSAJE) return json({ ok: false, error: `El mensaje supera ${MAX_MENSAJE} caracteres.` }, 400)

  const s = obtenerSesion(sessionId)
  if (s.ocupada) return json({ ok: false, error: "La sesión está procesando otro mensaje. Espera la respuesta." }, 409)
  s.ocupada = true
  try {
    s.visible.push({ rol: "usuario", texto: message, ts: new Date().toISOString() })
    const r = await ejecutarTurno(s, message, deps)
    s.visible.push({ rol: "asistente", texto: r.reply, toolCalls: r.toolCalls, needsConfirmation: r.needsConfirmation, error: r.error, ts: new Date().toISOString() })
    await guardarSesion(OUT, s)
    return json({ sessionId, reply: r.reply, toolCalls: r.toolCalls, needsConfirmation: r.needsConfirmation, error: r.error, tokensSesion: s.tokens })
  } finally {
    s.ocupada = false
  }
}

async function demo(): Promise<Response> {
  const outDir = join(OUT, "demo-web")
  await rm(outDir, { recursive: true, force: true })
  const lineas: string[] = []
  await ejecutarDemo({ directory: RAIZ, sessionId: "demo-web", outDir }, (l) => lineas.push(l))
  return json({ ok: true, texto: lineas.join("\n") })
}

async function archivo(ruta: string, tipo: string): Promise<Response> {
  try {
    return new Response(await readFile(ruta), { headers: { "content-type": tipo } })
  } catch {
    return json({ ok: false, error: "No encontrado." }, 404)
  }
}

const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" }

async function estatico(pathname: string): Promise<Response> {
  const relativo = pathname === "/" ? "index.html" : pathname.slice(1)
  const ruta = normalize(join(WEB, relativo))
  if (!ruta.startsWith(WEB)) return json({ ok: false, error: "No encontrado." }, 404)
  const ext = ruta.slice(ruta.lastIndexOf("."))
  return archivo(ruta, TIPOS[ext] ?? "application/octet-stream")
}

async function enrutar(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url)
  if (req.method === "GET" && pathname === "/api/health") {
    return json({ ok: true, provider: llm.proveedor, model: llm.modelo, tools: HERRAMIENTAS.map((h) => h.nombre), maxIteraciones: config.maxIteraciones })
  }
  if (req.method === "POST" && pathname === "/api/chat") return chat(req)
  if (req.method === "POST" && pathname === "/api/demo") return demo()
  if (req.method === "GET" && pathname.startsWith("/api/sessions/")) {
    const id = pathname.split("/")[3] ?? ""
    const s = idValido(id) ? buscarSesion(id) : undefined
    return s ? json({ id: s.id, tokens: s.tokens, historial: s.visible }) : json({ ok: false, error: "Sesión no encontrada." }, 404)
  }
  if (req.method === "GET" && pathname === "/api/control") return archivo(join(OUT, "control.csv"), "text/plain; charset=utf-8")
  if (req.method === "GET" && pathname === "/api/ordenes") return archivo(join(OUT, "sap", "ordenes.jsonl"), "text/plain; charset=utf-8")
  if (req.method === "GET" && pathname.startsWith("/api/evidencia/")) {
    const caso = pathname.split("/")[3] ?? ""
    return casoValido(caso) ? archivo(join(OUT, caso, "aprobacion.pdf"), "application/pdf") : json({ ok: false, error: "Caso inválido." }, 400)
  }
  if (req.method === "GET") return estatico(pathname)
  return json({ ok: false, error: "Ruta no encontrada." }, 404)
}

Bun.serve({
  port: config.puerto,
  idleTimeout: 255,
  async fetch(req) {
    try {
      return await enrutar(req)
    } catch {
      return json({ ok: false, error: "Error interno del servidor." }, 500)
    }
  },
})

console.log(`Agente OC escuchando en http://localhost:${config.puerto} · proveedor=${llm.proveedor} · modelo=${llm.modelo}`)
