/**
 * Genera modulo/ (bonus 9.4) a partir de las MISMAS fuentes que usa la app, para que no haya copias divergentes:
 *  - modulo/agent.md                       ← frontmatter + agent/prompt.md
 *  - modulo/skill/ordenes-compra/SKILL.md  ← frontmatter + src/knowledge/ordenes-compra.md
 *  - modulo/tools/oc.ts                    ← re-exporta src/tools/oc.ts (no es copia)
 * Uso: bun run modulo   ·   Verificación: bun run scripts/build-modulo.ts --check
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

const raiz = join(import.meta.dir, "..")
const prompt = await readFile(join(raiz, "agent", "prompt.md"), "utf8")
const conocimiento = await readFile(join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8")

const archivos: Record<string, string> = {
  "agent.md": `---\ndescription: Prepara, valida (RC1–RC10) y crea órdenes de compra en SAP a partir del paquete de correo, con confirmación humana para excepciones.\nmode: primary\npermission:\n  edit: deny\n  bash: deny\n---\n\n${prompt}`,
  "skill/ordenes-compra/SKILL.md": `---\nname: ordenes-compra\ndescription: Conocimiento del proceso de órdenes de compra de Periferia: reglas de control RC1–RC10, cómo explicar excepciones, códigos SAP y archivos de auditoría.\n---\n\n${conocimiento}`,
  "tools/oc.ts": `// Mismas herramientas que usa la aplicación (re-export, no copia). Importables sin el servidor HTTP.\nexport * from "../../src/tools/oc.ts"\n`,
}

const verificar = process.argv.includes("--check")
let divergente = false
for (const [rel, contenido] of Object.entries(archivos)) {
  const ruta = join(raiz, "modulo", rel)
  if (verificar) {
    const actual = await readFile(ruta, "utf8").catch(() => "")
    if (actual !== contenido) { console.error(`DIVERGE: modulo/${rel}`); divergente = true }
  } else {
    await mkdir(join(ruta, ".."), { recursive: true })
    await writeFile(ruta, contenido)
    console.log(`generado modulo/${rel}`)
  }
}
if (verificar) { console.log(divergente ? "modulo/ desactualizado: ejecuta bun run modulo" : "modulo/ sincronizado con la app"); process.exit(divergente ? 1 : 0) }
