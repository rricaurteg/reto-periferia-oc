import { AnthropicAdapter } from "./llm/anthropic.ts"
import { ErrorLlm, type LlmAdapter } from "./llm/adapter.ts"

function numero(nombre: string, porDefecto: number): number {
  const v = Number(process.env[nombre])
  return Number.isFinite(v) && v > 0 ? v : porDefecto
}

/** Configuración desde variables de entorno (ver .env.example). La clave nunca se expone fuera de este módulo. */
export const config = {
  puerto: numero("PORT", 3000),
  proveedor: process.env.LLM_PROVIDER ?? "anthropic",
  modelo: process.env.LLM_MODEL ?? "claude-sonnet-5-5",
  maxIteraciones: numero("MAX_ITERACIONES", 25),
  maxTokensSesion: numero("MAX_TOKENS_SESION", 300000),
  maxTokensRespuesta: numero("MAX_TOKENS_RESPUESTA", 4096),
  timeoutMs: numero("LLM_TIMEOUT_MS", 60000),
}

/** Adaptador nulo: permite levantar la app sin clave (la demo funciona) y explica el problema en el chat. */
class SinProveedor implements LlmAdapter {
  readonly proveedor = "ninguno"
  readonly modelo = "ninguno"
  async enviar(): Promise<never> {
    throw new ErrorLlm("El servidor no tiene configurada la clave del modelo (ANTHROPIC_API_KEY). La verificación sin modelo sí está disponible con el botón «Ejecutar demo».")
  }
}

export function crearAdaptador(): LlmAdapter {
  const clave = process.env.ANTHROPIC_API_KEY
  if (config.proveedor === "anthropic" && clave) {
    return new AnthropicAdapter(clave, config.modelo, config.timeoutMs, config.maxTokensRespuesta)
  }
  return new SinProveedor()
}
