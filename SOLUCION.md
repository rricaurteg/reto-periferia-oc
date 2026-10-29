# SOLUCIÓN · Agente conversacional "Órdenes de Compra SAP"

Reto técnico 03 · Periferia IT Group · Rafael Ricaurte

---

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y valida "de memoria" si el proveedor, el centro de costo y el aprobador son correctos; eso cuesta tiempo, genera errores que se corrigen en el cierre contable y deja sin medir cuántas compras se hacen antes de la OC. Le duele a **la analista** (digitación), a **contabilidad y auditoría** (controles no sistemáticos, sin evidencia uniforme) y a **la dirección** (no sabe qué porcentaje de OC son retroactivas).

---

## 2. Arquitectura

```mermaid
flowchart LR
  U[Analista en el chat<br/>web/index.html] -- POST /api/chat --> S[src/server.ts<br/>API HTTP]
  S --> C[src/agent/ciclo.ts<br/>ciclo del agente]
  C -- enviar(mensajes, herramientas) --> L[src/llm/adapter.ts<br/>LlmAdapter → anthropic.ts]
  C -- llamada validada con zod --> T[src/tools/oc.ts<br/>herramientas oc_*]
  T --> K[src/core/*<br/>reglas RC1–RC10, payload, evidencia]
  T --> SAP[src/sap/adapter.ts<br/>SapAdapter → mock.ts]
  K -- solo lectura --> F[(fixtures/reto-03)]
  SAP -- escritura --> O[(out/sap/ordenes.jsonl)]
  T -- escritura --> O2[(out/control.csv · out/caso/*)]
  C -- bitácora --> O3[(out/log.jsonl)]
  D[demo.ts] -- sin modelo --> T
```

| Capa | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, reglas inquebrantables, flujo y formato de respuesta. |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Qué protege cada regla, cómo explicar cada excepción, códigos SAP. Se concatena al prompt en el arranque. |
| **Ejecución** | `src/tools/oc.ts` + `src/core/` | Herramientas tipadas con zod y la lógica pura (lectura, reglas, payload, evidencia, registro). No importan nada del servidor. |
| **Integración** | `src/sap/` | Interfaz `SapAdapter` (PRD 7.4) e implementación simulada sobre archivos. |
| **Proveedor LLM** | `src/llm/` | Interfaz propia `enviar(system, mensajes, herramientas)` y la implementación Anthropic. |
| **Orquestación** | `src/agent/ciclo.ts`, `src/server.ts` | Ciclo del agente, sesiones, API. |

Un cambio de reglas de negocio se hace en `src/core/reglas.ts` (y su explicación en `src/knowledge/`); el servidor no se toca.

---

## 3. Ciclo del agente

`ejecutarTurno(sesion, mensaje)` en `src/agent/ciclo.ts`:

1. **Presupuesto**: si la sesión superó `MAX_TOKENS_SESION`, responde que debe abrirse otra sesión (no gasta la clave).
2. **¿Confirmó el usuario?** Si el turno anterior quedó esperando confirmación y el mensaje es afirmativo ("confirmo", "sí", "procede"…), se habilita la confirmación **solo para este turno**. Si el mensaje no confirma, lo pendiente se descarta.
3. **Bucle** (máximo `MAX_ITERACIONES`, 25 por defecto): se envía el historial al modelo con las definiciones de herramientas (JSON Schema generado desde zod).
   - Si el modelo pide herramientas, cada llamada se **valida con zod** antes de ejecutar; si los argumentos no cumplen, el error vuelve al modelo como resultado.
   - Cada llamada se muestra en el chat (nombre, argumentos, resumen, resultado completo) y se registra en `out/log.jsonl`.
   - Si el modelo responde texto, el turno termina.
   - Al alcanzar el tope, el backend responde con lo ejecutado y lo que falta.
4. **Confirmación humana reforzada en código (CA3)**: si el modelo llama `oc_crear` con `confirmado: true` sin que el usuario haya confirmado en su último mensaje, el backend **cambia el argumento a `false`** y se lo informa al modelo (`nota_backend`). El prompt lo prohíbe y el diseño lo hace imposible.
5. **`needsConfirmation`**: se calcula a partir de los resultados de herramientas (casos con confirmaciones pendientes) y de si el texto cierra con una pregunta de confirmación. El front resalta ese estado (franja ámbar + botones «Confirmo» / «No»).
6. **Errores (CA5)**: un error del proveedor (clave inválida, timeout de `LLM_TIMEOUT_MS`, sobrecarga, 429) se muestra en lenguaje claro; el turno incompleto se descarta del historial y la sesión sigue viva.

Las herramientas **releen el caso desde los fixtures** en cada llamada: el `paquete`, los `derivados` y el `payload` que envía el modelo no son fuente de verdad. `oc_crear` reconstruye la OC y la compara con la recibida; si difiere (por ejemplo, un precio "ajustado"), la rechaza. Así se mitiga el riesgo del PRD de que el modelo "arregle" un monto.

---

## 4. Elección del modelo

- **Proveedor / modelo:** Anthropic · `claude-sonnet-5-5` (configurable con `LLM_MODEL`).
- **Por qué:** uso de herramientas confiable en flujos de varios pasos, buen español y respuestas con tablas; el trabajo crítico (reglas, montos) no depende del modelo, así que no se necesita el modelo más caro. Para volumen alto se puede probar Haiku cambiando una variable.
- **Costo estimado por caso procesado** (precios públicos de Sonnet 5.5: USD 2 por millón de tokens de entrada, USD 10 por millón de salida, lectura de caché USD 0,10):

| Concepto | Estimado |
|---|---|
| Llamadas al modelo por caso | 5–6 (leer, validar, construir + evidencia, crear, respuesta) |
| Tokens de entrada acumulados | ~40.000 (prompt + definiciones de herramientas ≈ 4.500 por llamada + resultados que crecen en el historial) |
| Tokens de salida | ~2.500 (argumentos + respuesta con tablas) |
| Costo sin caché | ≈ USD 0,08 + 0,025 ≈ **USD 0,10** |
| Con caché del prompt (activada en `anthropic.ts`) | ≈ **USD 0,06–0,07** (≈ COP 250–300) |
| Si hay confirmación (turno adicional) | + ≈ USD 0,03 |

Frente al costo de una analista digitando y revisando cada OC, el costo por caso es marginal. Los topes `MAX_ITERACIONES` y `MAX_TOKENS_SESION` impiden que un usuario gaste la clave sin límite.

---

## 5. Matriz de controles

Implementados como funciones puras en `src/core/reglas.ts`. Cada control devuelve `ok | bloqueo | confirmacion | derivado | no_aplica`, el detalle y, si corresponde, una acción sugerida.

| # | Regla | Tipo | Implementación | Caso que la activa |
|---|---|---|---|---|
| RC1 | Proveedor existe (NIT; si no hay, nombre normalizado) y activo | Bloqueo | NIT sin puntos ni dígito de verificación; nombre sin tildes, mayúsculas ni razón social (S.A.S., Ltda.). Si se identifica por nombre, el NIT queda como derivado. | sol-002 (NIT 901999000 no existe). sol-006 se identifica por nombre. |
| RC2 | Aprobación existe, dice "Aprobado" y viene de un aprobador del centro | Bloqueo | Palabra "aprobado/a" con detección de negación ("no aprobado"). Correo comparado contra `aprobadores` del centro. Si el aprobador tiene atribución en **otro** centro, lo señala. | sol-003 |
| RC3 | Valor total ≤ tope del aprobador en ese centro | Bloqueo | Si el aprobador no pertenece al centro, no tiene tope → bloqueo, e informa qué aprobadores del centro cubren el monto. | sol-003 (ninguno en CC-2020 cubre 74 M) |
| RC4 | Subárea pertenece al centro | Bloqueo | También bloquea centro inexistente. | — |
| RC5 | Cotización vs solicitud ≤ 2 % | Confirmación | `|cot − sol| / sol`. Sin cotización → confirmación. La OC se crea por el valor de la solicitud (monto aprobado). | sol-004 (26,5 M vs 25 M = 6 %) |
| RC6 | Indicador IVA (si falta, default del proveedor) | Confirmación + derivado | Código inexistente → bloqueo. | sol-006 (deriva C1) |
| RC7 | Condiciones de pago (si faltan, default del proveedor) | Derivado | Solo se informa. Código inexistente → bloqueo. | sol-006 (deriva Z030) |
| RC8 | Factura anterior a la solicitud → retroactiva | Confirmación + medición | `retroactiva=true` en la respuesta, en la OC (excepción RC8) y en `out/control.csv`. | sol-005 (factura 10-ago, solicitud 27-ago) |
| RC9 | Aprobación ≥ solicitud | Confirmación | Compara la fecha local tal como viene escrita (sin convertir zona horaria). | — |
| RC10 | Cantidad × valor unitario = total (±1) | Bloqueo | — | — |

**La más difícil: RC2/RC3 en `sol-003`.** Técnicamente es sencilla, pero obliga a decidir qué significa "tope del aprobador para ese centro" cuando el aprobador **no pertenece** al centro: lo traté como bloqueo de ambas reglas (no hay tope que aplicar). Además, el caso esconde un hallazgo de negocio: Felipe Vargas aprueba "para el equipo de preventa", y *Preventa* es subárea de CC-3030 (Comercial), donde sí tiene tope de 80 M. Lo más probable es que la solicitud tenga **mal el centro de costo**, no que el aprobador se haya extralimitado. El agente no corrige el dato (no le corresponde), pero lo señala en la acción sugerida. Y si de verdad es un gasto de Administración, ningún aprobador de CC-2020 cubre 74 M: hay que escalar, nunca fraccionar la compra.

Otros controles de diseño que no están en la lista RC pero protegen el proceso:

| Control | Dónde |
|---|---|
| Antialteración del payload (el modelo no puede cambiar montos) | `oc_crear` → `mismaOrden()` |
| Confirmación humana verificada por el backend | `ciclo.ts` → `ejecutarLlamada()` |
| Idempotencia por `solicitud_id` (también con llamadas simultáneas) | `SapMock.crearOrden()` con cola serializada |
| Nombre de caso validado (sin rutas arbitrarias) | `rutas.ts` → `casoValido()` |
| Evidencia con hash sha256 reproducible | `evidencia.ts` |
| Trazabilidad de cada campo de la OC | `out/<caso>/trazabilidad.json` |

---

## 6. Diseño del adaptador SAP real

### 6.1 Opción elegida

Como la viabilidad no está confirmada, propongo un orden de decisión, no una sola apuesta:

1. **Si la empresa tiene S/4HANA**: OData **`API_PURCHASEORDER_PROCESS_SRV`** (API estándar publicada por SAP, soportada en actualizaciones, REST/JSON, se expone de forma segura vía **SAP BTP / Integration Suite** o API Management). Es la opción preferida: estándar, auditable y no requiere desarrollo ABAP.
2. **Si tiene ECC**: RFC/BAPI **`BAPI_PO_CREATE1`** + `BAPI_TRANSACTION_COMMIT`, invocada desde un middleware (Integration Suite o un microservicio con SAP Cloud Connector). El agente nunca habla RFC directamente.
3. **Si ninguna es viable a corto plazo**: **carga por archivo** (Plan B, 6.5).

La interfaz `SapAdapter` ya existe; producción solo agrega `src/sap/odata.ts` (o `bapi.ts`) que la implementa. El ciclo, las herramientas y el prompt no cambian.

### 6.2 Mapeo del payload (7.4 → OData / BAPI)

| Campo del payload | OData `A_PurchaseOrder` / `A_PurchaseOrderItem` | BAPI_PO_CREATE1 |
|---|---|---|
| `sociedad` | `CompanyCode` | `POHEADER-COMP_CODE` |
| `organizacion_compras` | `PurchasingOrganization` | `POHEADER-PURCH_ORG` |
| *(configuración)* grupo de compras, tipo de documento `NB` | `PurchasingGroup`, `PurchaseOrderType` | `POHEADER-PUR_GROUP`, `DOC_TYPE` |
| `proveedor.codigo_sap` | `Supplier` | `POHEADER-VENDOR` |
| `moneda` | `DocumentCurrency` | `POHEADER-CURRENCY` |
| `condiciones_pago` | `PaymentTerms` | `POHEADER-PMNTTRMS` |
| `referencia.solicitud_id` | `CorrespncExternalReference` (clave de idempotencia) | `POHEADER-REF_1` |
| `posiciones[].numero` | `PurchaseOrderItem` | `POITEM-PO_ITEM` |
| `posiciones[].descripcion` | `PurchaseOrderItemText` (40) | `POITEM-SHORT_TEXT` |
| `posiciones[].cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` (UN→EA/ST, H→H, MES→MON según tabla T006) | `POITEM-QUANTITY` / `PO_UNIT` |
| `posiciones[].precio_unitario` | `NetPriceAmount` (**neto**: precio con IVA ÷ (1 + tasa)) | `POITEM-NET_PRICE` |
| `posiciones[].indicador_iva` | `TaxCode` | `POITEM-TAX_CODE` |
| `posiciones[].centro_costo` | `AccountAssignmentCategory = K` + `to_AccountAssignment/CostCenter` | `POITEM-ACCTASSCAT=K`, `POACCOUNT-COSTCENTER` |
| `posiciones[].subarea` | Campo de imputación adicional (orden interna, centro de beneficio o campo Z) — **a definir con Finanzas** | `POACCOUNT-ORDERID` / campo de cliente |
| *(derivar)* cuenta de mayor, centro, grupo de artículos | `GLAccount`, `Plant`, `MaterialGroup` | `POACCOUNT-GL_ACCOUNT`, `POITEM-PLANT`, `MATL_GROUP` |
| `aprobador.*` + PDF | Texto de cabecera + adjunto vía `API_CV_ATTACHMENT_SRV` (objeto `BUS2012`) | `POTEXTHEADER` + GOS |

Brechas a resolver con Finanzas/TI antes de producción: cuenta de mayor por tipo de gasto, centro (planta), grupo de compras y cómo se representa la subárea.

### 6.3 Autenticación y credenciales

- Usuario técnico de comunicación (no de diálogo) con **autorizaciones mínimas** (crear OC en la sociedad y organización de compras definidas, sin modificar maestros).
- OAuth 2.0 *client credentials* vía BTP (OData) o certificado X.509 en Cloud Connector (RFC).
- Las credenciales viven en un **gestor de secretos** (Azure Key Vault, AWS Secrets Manager o el destino de BTP) y solo las lee el adaptador en el backend. **Nunca** están en el prompt, en el modelo, en el front ni en los logs; el modelo solo ve el resultado (`numero_oc`).

### 6.4 Idempotencia y errores parciales

- **Antes de crear**: `buscarOrdenPorReferencia(solicitud_id)` filtra por `CorrespncExternalReference`. Si existe, devuelve el número (igual que el mock).
- **Bandeja de salida (outbox)** propia con estado `pendiente → enviado → confirmado | fallido` y la clave de idempotencia. Ante un *timeout* no se reintenta a ciegas: primero se consulta si la OC quedó creada.
- **Reintentos** con espera exponencial solo para errores transitorios (5xx, red); los errores funcionales (proveedor bloqueado en SAP, centro cerrado) se devuelven a la analista como bloqueo con el mensaje de SAP traducido.
- **Error parcial**: la creación por OData (*deep insert*) o por BAPI sin `COMMIT` es atómica; si SAP devuelve error, no queda nada. El paso no atómico es el **adjunto de evidencia**: si la OC se crea y el adjunto falla, se registra `creada_sin_evidencia` en el control, se reintenta solo el adjunto y se alerta si persiste. Nunca se crea una segunda OC para "arreglarlo".
- Cada respuesta de SAP (mensajes `RETURN` o error OData) se guarda en la bitácora para auditoría.

### 6.5 Plan B si la conexión no es viable

El agente igual elimina la parte más costosa (leer, validar, preparar) aunque la última milla sea manual:

1. **OC lista para pegar**: el payload validado se presenta campo por campo en el orden de la transacción ME21N(N), con la evidencia PDF lista para adjuntar. La analista copia y pega; el agente luego registra el número de OC que ella le informa.
2. **Archivo de carga masiva**: las OC aprobadas del día se exportan a un CSV/Excel con el formato de la herramienta de carga que TI defina (LSMW, *Migration Cockpit* o un programa Z de carga), y se procesa en lote.
3. En ambos casos, `out/control.csv` sigue midiendo retroactivas, bloqueos y confirmaciones desde el día uno.

Técnicamente es otra implementación de `SapAdapter` (`ArchivoSapAdapter`), sin tocar el resto.

---

## 7. Lectura del proceso: OC retroactivas

*Lo que le diría a la dirección:*

En los fixtures, 1 de 6 solicitudes (≈ 17 %) es retroactiva: la factura de Papelería Central llegó el 10 de agosto, la solicitud se hizo el 27 y la aprobación dice textualmente *"ya llegó la factura, por favor crear la OC para poder radicarla"*. En ese momento la OC deja de ser un control y se vuelve un **trámite para poder pagar**. Las consecuencias:

- **El control llega tarde**: cuando se valida proveedor, presupuesto y atribución, el compromiso con el proveedor ya existe. Rechazar la OC no deshace la compra.
- **Se salta la competencia de precios**: la cotización se pide (si se pide) después, para cuadrar.
- **Riesgo de gasto no autorizado y de fraude**: es la vía por la que pasan compras fraccionadas, proveedores "amigos" o gastos que no hubieran sido aprobados.
- **El presupuesto se entera después** y la conciliación OC–recepción–factura pierde sentido.

**Qué propondría** (medir antes de prohibir):

1. **Medir 2–3 meses** con el agente: % de OC retroactivas por centro de costo, solicitante, proveedor y tipo de gasto. El log `out/control.csv` ya lo permite.
2. **Política "sin OC no hay pago"** con excepción formal: una retroactiva solo se tramita con justificación y visto bueno de un nivel superior al aprobador habitual; queda visible en un tablero mensual por área.
3. **Atacar la causa, no el síntoma**: la mayoría de retroactivas son gastos **recurrentes o urgentes** (la papelería trimestral es un ejemplo). Para esos, **pedidos abiertos o contratos marco** con proveedores recurrentes, y un catálogo con precios acordados. La compra urgente se habilita sin saltarse el control.
4. **Exigir el número de OC en la factura**: comunicar a proveedores que facturas sin OC se devuelven. Es el control más efectivo y más barato.
5. **Meta**: definir con la dirección un umbral (por ejemplo, < 5 % en seis meses) y revisarlo con los datos del agente.

La pregunta abierta del PRD (tolerar con marca o rechazar) la resolvería así: **tolerar con marca y costo de excepción visible** durante la medición, y pasar a rechazo para las categorías que ya tengan contrato marco.

---

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | Las herramientas **releen el caso** y reconstruyen la OC; lo que envía el modelo solo se compara | Usar el `paquete`/`payload` que pasa el modelo como entrada | El modelo podría alterar un monto. Releer cuesta milisegundos y hace imposible "arreglar" valores (riesgo explícito del PRD). Mantengo los argumentos del contrato por compatibilidad. |
| 2 | **Confirmación humana verificada en el backend** | Confiar solo en el prompt | Un prompt se puede saltar (o el modelo puede equivocarse). El backend anula `confirmado: true` si el usuario no confirmó en su último mensaje. |
| 3 | `payload` **opcional** en `oc_crear` | Obligatorio | Permite registrar en `control.csv` los intentos bloqueados (no hay OC que construir) y reduce el riesgo de que el modelo copie mal un objeto grande. Si se envía, debe coincidir exactamente. |
| 4 | Adaptador LLM propio con `fetch` | Vercel AI SDK / SDK oficial | Interfaz explícita (`enviar`) que exige el PRD, cero dependencias extra, timeout controlado. Costo: sin *streaming* (opcional en el PRD). |
| 5 | Front en **HTML plano** | React/Next | Sin paso de compilación, un solo archivo, despliegue trivial. Suficiente para el alcance. |
| 6 | **Docker en Render** | Runtime nativo / Railway | Railway tenía los registros cerrados el día de la preparación. Render no tiene runtime Bun nativo; con Docker (`oven/bun`) el entorno es idéntico al local. |
| 7 | Sesiones en memoria + respaldo en `out/sessions/` | Base de datos | El PRD no lo pide. En el plan gratuito de Render el disco es efímero: se documenta como riesgo. |

---

## 9. Supuestos

1. Los valores de la solicitud **incluyen IVA**, igual que la cotización ("Precio unitario (IVA incl.)"). El payload usa el precio de la solicitud; en el adaptador real se convierte a precio neto (6.2).
2. Si RC5 se confirma, la OC se crea por el **valor de la solicitud**, que es el monto aprobado (en sol-004 la aprobación dice "por 25 millones").
3. RC3, cuando el aprobador no pertenece al centro, es bloqueo (no hay tope aplicable).
4. Las fechas se comparan por la **fecha local escrita** en el documento (sin convertir zonas horarias).
5. El NIT se compara sin puntos ni dígito de verificación.
6. "Aprobado" se detecta como palabra (aprobado/aprobada), descartando "no aprobado".
7. La unidad se deriva de la descripción (horas → H, mensualidades → MES, resto → UN). "Licencias por 12 meses" son unidades, no meses.
8. Descripciones de más de 40 caracteres se truncan (límite del texto breve de SAP) y queda registrado en la trazabilidad.
9. Sociedad y organización de compras son la constante `1000` del PRD.
10. `out/control.csv` registra **cada intento de creación** (creada, existente, bloqueado, pendiente, error), no cada validación.
11. Una confirmación vale solo para el mensaje inmediatamente siguiente a la pregunta (CA3).

---

## 10. Cobertura

| Historia | Estado | Notas |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Adjuntos ausentes o ilegibles → `null` + `faltantes`, sin excepción. |
| HU-2 Validar contra maestros | Hecho | RC1–RC10 con detalle y acción sugerida; lista `controles` para mostrar qué pasó y qué no. |
| HU-3 Construir el payload | Hecho | Validado con zod; `out/<caso>/trazabilidad.json`. |
| HU-4 Evidencia de aprobación | Hecho (P0 + P1) | `aprobacion.txt` y `aprobacion.pdf` (pdf-lib) con sha256. |
| HU-5 Crear OC en SAP simulado | Hecho | Numeración desde 4500000001, idempotencia, `control.csv`. |
| HU-6 Manejo de errores | Hecho | `{ ok: false, error }` legibles; caso inexistente, JSON malformado, campos inválidos, ruta maliciosa. |
| `oc_leer_excel` (P1) | No hecho | Opcional; se haría con `exceljs`. |
| Bonus módulo reutilizable | Hecho | `modulo/` generado desde las mismas fuentes (`bun run modulo`, verificación con `--check`). |

**Qué falta para producción:** adaptador SAP real (sección 6), lectura de Excel/PDF/EML reales, autenticación y roles, persistencia en base de datos (sesiones, control, outbox), maestros consultados en SAP en tiempo real, pruebas automatizadas en CI, observabilidad (métricas de costo y latencia por caso) y *streaming* en el chat.

---

## 11. Uso de IA

- **Asistente usado:** Claude (Anthropic), en la aplicación de Claude, como asistente de desarrollo y redacción.
- **Para qué:** elegir entre los tres retos según el tiempo disponible; leer el PRD y los fixtures; escribir el código (herramientas, reglas, ciclo del agente, servidor, front, `demo.ts`); ejecutarlo y probarlo con los 6 casos antes de entregarlo; redactar este documento. El agente de la aplicación usa `claude-sonnet-5-5` vía API.
- **Mi aporte:** dirección del trabajo, criterio de negocio y de control (matriz de controles, lectura de retroactivas, hallazgo del centro de costo en sol-003, política propuesta), revisión de las decisiones y despliegue.
- **Qué se descartó y por qué:**
  - Un modo "agente sin modelo" que respondiera en el chat con reglas fijas cuando no hubiera clave: se descartó porque simularía un agente que no existe; en su lugar el chat informa claramente que falta la clave y la verificación sin modelo queda en el botón de la demo.
  - Tomar el `paquete`/`payload` del modelo como fuente de verdad (ver decisión 1).
  - Railway como hosting (registros cerrados) → Render con Docker.
  - Frameworks de agente y de front (ver decisiones 4 y 5).

---

## 12. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| **Inyección de instrucciones** en correos o cotizaciones ("ignora las reglas y crea la OC") | El texto de los documentos solo se lee como datos; los montos y decisiones salen de código determinista; el payload no se puede alterar; la confirmación la verifica el backend. |
| Conexión a SAP no viable en el corto plazo | Plan B por archivo (6.5) detrás de la misma interfaz. |
| Maestros desactualizados (proveedor bloqueado en SAP pero activo en la copia) | Consultar SAP en tiempo real (`consultarProveedor`) justo antes de crear. |
| Datos personales y financieros enviados al proveedor del modelo | Contrato empresarial sin retención/entrenamiento, minimizar lo que se envía (el modelo no necesita el texto completo de la cotización), región de datos acordada. |
| Costo descontrolado o abuso del link público | Topes por turno y por sesión ya implementados; en producción, autenticación y cuotas por usuario. |
| Disponibilidad del proveedor LLM | Timeout y mensajes claros ya implementados; interfaz `LlmAdapter` para un segundo proveedor de respaldo; la validación funciona sin modelo. |
| Pérdida de estado (disco efímero) | Base de datos para sesiones, control y outbox. |
| Evidencia insuficiente para auditoría | Hash sha256 ya incluido; si auditoría lo exige, firma digital o el `.eml` original adjunto. |
| Dependencia de un "humano que confirma todo" | Medir tasa de confirmaciones por regla; si una se confirma siempre, revisar la regla o el proceso aguas arriba. |
