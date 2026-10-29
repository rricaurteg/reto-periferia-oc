import { ErrorLlm, type Bloque, type DefinicionHerramienta, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

type BloqueAnthropic =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

type RespuestaAnthropic = {
  content: BloqueAnthropic[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

function aAnthropic(b: Bloque): BloqueAnthropic {
  if (b.tipo === "texto") return { type: "text", text: b.texto }
  if (b.tipo === "llamada") return { type: "tool_use", id: b.id, name: b.nombre, input: b.args ?? {} }
  return { type: "tool_result", tool_use_id: b.id, content: b.contenido, is_error: b.esError }
}

function desdeAnthropic(b: BloqueAnthropic): Bloque | null {
  if (b.type === "text") return { tipo: "texto", texto: b.text }
  if (b.type === "tool_use") return { tipo: "llamada", id: b.id, nombre: b.name, args: b.input }
  return null
}

function mensajeError(status: number): string {
  if (status === 401) return "La clave del modelo es inválida o no está configurada (revisar ANTHROPIC_API_KEY en el servidor)."
  if (status === 429) return "El proveedor del modelo limitó la tasa de solicitudes. Intenta de nuevo en unos segundos."
  if (status === 529 || status === 503) return "El proveedor del modelo está sobrecargado. Intenta de nuevo en unos segundos."
  if (status === 400) return "El proveedor rechazó la solicitud (400). Inicia una sesión nueva; si persiste, revisa el modelo configurado."
  return `El proveedor del modelo respondió con error ${status}.`
}

/** Implementación para la API de Mensajes de Anthropic, con timeout y caché del prompt de sistema. */
export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"

  constructor(
    private readonly clave: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
    private readonly maxTokens: number,
  ) {}

  async enviar(system: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const control = new AbortController()
    const temporizador = setTimeout(() => control.abort(), this.timeoutMs)
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: control.signal,
        headers: { "content-type": "application/json", "x-api-key": this.clave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: this.modelo,
          max_tokens: this.maxTokens,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.esquema })),
          messages: mensajes.map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.bloques.map(aAnthropic) })),
        }),
      })
      if (!res.ok) throw new ErrorLlm(mensajeError(res.status))
      const datos = (await res.json()) as RespuestaAnthropic
      const bloques = datos.content.map(desdeAnthropic).filter((b): b is Bloque => b !== null)
      const fin = datos.stop_reason === "tool_use" ? "herramientas" : datos.stop_reason === "max_tokens" ? "limite" : "fin"
      const u = datos.usage
      return { bloques, fin, uso: { entrada: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), salida: u.output_tokens } }
    } catch (e) {
      if (e instanceof ErrorLlm) throw e
      if ((e as Error).name === "AbortError") throw new ErrorLlm(`El modelo no respondió en ${Math.round(this.timeoutMs / 1000)} s (timeout). Intenta de nuevo.`)
      throw new ErrorLlm("No fue posible conectar con el proveedor del modelo.")
    } finally {
      clearTimeout(temporizador)
    }
  }
}
