/**
 * demo.ts — procesa los 6 casos llamando directamente a las herramientas, SIN modelo de lenguaje ni clave.
 * Uso: bun install && bun run demo.ts
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { ejecutarDemo } from "./src/demo/ejecutar.ts"

const directory = import.meta.dir
await rm(join(directory, "out"), { recursive: true, force: true })
await ejecutarDemo({ directory, sessionId: "demo" }, (linea) => console.log(linea))
