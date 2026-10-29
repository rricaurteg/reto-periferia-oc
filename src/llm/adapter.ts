/**
 * Interfaz propia del proveedor de lenguaje (PRD 6.1). El ciclo del agente solo conoce estos tipos;
 * cambiar de proveedor = escribir otra implementación de LlmAdapter, sin tocar el ciclo.
 */
export type Bloque =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; id: string; nombre: string; args: unknown }
  | { tipo: "resultado"; id: string; contenido: string; esError: boolean }

export type Mensaje = { rol: "usuario" | "asistente"; bloques: Bloque[] }

export type DefinicionHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

export type RespuestaLlm = {
  bloques: Bloque[]
  /** "herramientas" = el modelo pidió ejecutar herramientas; "fin" = respuesta final; "limite" = cortado por tokens. */
  fin: "herramientas" | "fin" | "limite"
  uso: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(system: string, mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm>
}

/** Error del proveedor con mensaje apto para mostrar al usuario (nunca incluye la clave). */
export class ErrorLlm extends Error {}
