# Agente conversacional · Órdenes de Compra en SAP simulado

Reto técnico 03 · Periferia IT Group. Agente que lee el paquete de compra (solicitud, cotización, aprobación, factura), lo valida contra los maestros con las reglas RC1–RC10, construye la OC, genera la evidencia de aprobación (TXT + PDF con sha256) y la crea en un SAP simulado, pidiendo confirmación humana en las excepciones.

- **Link de prueba:** https://reto-periferia-oc-tk9f.onrender.com *(plan gratuito: si estuvo inactivo, la primera carga tarda ~1 minuto)*
- **Documento de solución:** [SOLUCION.md](SOLUCION.md)
- **Acceso:** el link es público, sin clave.

## Levantar en local (un comando)

Requisitos: [Bun](https://bun.sh) 1.1 o superior.

```bash
cp .env.example .env        # y escribe tu ANTHROPIC_API_KEY
bun install && bun run dev  # http://localhost:3000
```

Sin clave la aplicación también arranca: el chat avisa que falta la clave y el botón **«Ejecutar demo.ts»** funciona.

Con Docker: `docker build -t agente-oc . && docker run -p 3000:3000 --env-file .env agente-oc`

## Verificación sin modelo (`demo.ts`)

```bash
bun install && bun run demo.ts
```

Limpia `out/`, procesa los 6 casos llamando directamente a las herramientas (sin modelo ni clave) e imprime por caso `apta`, bloqueos, confirmaciones, `retroactiva` y número de OC o motivo. Incluye: intento con payload alterado (rechazado), confirmación explícita de `sol-004`, idempotencia de `sol-001`, caso inexistente y ruta maliciosa. Resultado esperado:

| Caso | Resultado |
|---|---|
| sol-001 | OC 4500000001 (segunda ejecución: misma OC, idempotente) |
| sol-002 | Bloqueada · RC1 proveedor inexistente |
| sol-003 | Bloqueada · RC2/RC3 aprobador sin autoridad en CC-2020 |
| sol-004 | Pendiente RC5 (cotización +6 %) → con confirmación: OC 4500000002 |
| sol-005 | Pendiente RC8 retroactiva → con confirmación: OC 4500000003, `retroactiva=true` |
| sol-006 | Pendiente RC6 IVA derivado (C1) → con confirmación: OC 4500000004 |

También se puede ejecutar desde el chat con el botón **«Ejecutar demo.ts (sin modelo)»** (escribe en `out/demo-web/`).

## Variables de entorno

| Variable | Obligatoria | Default | Uso |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (para el chat) | — | Clave del modelo. Solo en el backend. |
| `LLM_PROVIDER` | No | `anthropic` | Proveedor del adaptador LLM. |
| `LLM_MODEL` | No | `claude-sonnet-5-5` | Modelo. |
| `MAX_ITERACIONES` | No | `25` | Tope herramienta→modelo por turno. |
| `MAX_TOKENS_SESION` | No | `300000` | Tope de tokens por sesión (control de costo). |
| `MAX_TOKENS_RESPUESTA` | No | `4096` | Tokens máximos por respuesta del modelo. |
| `LLM_TIMEOUT_MS` | No | `60000` | Timeout de cada llamada al modelo. |
| `PORT` | No | `3000` | Puerto HTTP. |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, error, tokensSesion }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, tools[] }` (sin claves) |
| `POST` | `/api/demo` | Ejecuta la verificación sin modelo y devuelve el texto |
| `GET` | `/api/control` | `out/control.csv` |
| `GET` | `/api/ordenes` | `out/sap/ordenes.jsonl` |
| `GET` | `/api/evidencia/:caso` | PDF de evidencia de aprobación |

## Estructura

```
agent/prompt.md               comportamiento (system prompt)
src/knowledge/                conocimiento del proceso
src/tools/oc.ts               herramientas zod (oc_listar_casos, oc_leer_paquete, oc_validar,
                              oc_construir_payload, oc_generar_evidencia, oc_crear)
src/core/                     lógica pura: esquemas, lectura, reglas RC1–RC10, payload, evidencia, registro
src/sap/adapter.ts, mock.ts   interfaz SapAdapter y SAP simulado sobre out/sap/
src/llm/adapter.ts, anthropic.ts  interfaz propia del proveedor LLM + implementación
src/agent/ciclo.ts            ciclo del agente (topes, confirmación humana, log)
src/server.ts                 API HTTP + estáticos
web/index.html                chat
demo.ts                       verificación sin modelo
modulo/                       bonus: agente empaquetado (generado con `bun run modulo`)
fixtures/                     insumos entregados (no modificados)
```

## Despliegue (Render)

New → Web Service → conectar este repositorio → Render detecta el `Dockerfile` → variable `ANTHROPIC_API_KEY` → Deploy. Health check: `/api/health`.
