---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia: reglas de control RC1–RC10, cómo explicar excepciones, códigos SAP y archivos de auditoría.
---

# Conocimiento del proceso: órdenes de compra

## Para qué existe la OC
La OC es el compromiso formal de gasto antes de comprar. Permite validar presupuesto, proveedor y atribuciones **antes** de que exista la obligación con el proveedor, y después cruzar OC ↔ recepción ↔ factura (conciliación a tres vías).

## Piezas del paquete
- **Solicitud** (Excel): qué se compra, cuánto, para qué centro de costo y subárea.
- **Cotización** del proveedor: precio ofrecido y validez.
- **Aprobación** del líder: correo que dice "Aprobado". Es la evidencia que se adjunta a la OC (PDF + hash sha256).
- **Factura** (solo si llegó antes): indica una compra retroactiva.

## Reglas de control
| Código | Qué protege | Tipo |
|---|---|---|
| RC1 | Pagar solo a proveedores registrados y activos (evita pagos a terceros no vinculados). | Bloqueo |
| RC2 | Que apruebe quien tiene atribución sobre ese centro de costo. | Bloqueo |
| RC3 | Que el monto esté dentro del tope de atribución del aprobador. | Bloqueo |
| RC4 | Imputación contable correcta (subárea del centro). | Bloqueo |
| RC5 | Que lo que se compra corresponda a lo cotizado (±2 %). | Confirmación |
| RC6 | Tratamiento tributario correcto (IVA). | Confirmación + derivado |
| RC7 | Condiciones de pago correctas. | Derivado (informativo) |
| RC8 | Detectar compras retroactivas (factura antes de la solicitud). | Confirmación + medición |
| RC9 | Que la aprobación no sea anterior a la solicitud. | Confirmación |
| RC10 | Coherencia aritmética de la solicitud. | Bloqueo |

## Cómo explicar las excepciones
- **Proveedor inexistente (RC1):** no se puede crear la OC; el área de compras debe vincular al proveedor (RUT, certificación bancaria) o el solicitante debe elegir uno registrado.
- **Aprobador sin autoridad (RC2/RC3):** pedir aprobación a un aprobador del centro con tope suficiente. Si ningún aprobador del centro alcanza el monto, escalar según la matriz de atribuciones. Si el aprobador sí tiene atribución en otro centro, señalar que posiblemente la solicitud tiene mal el centro de costo. **Nunca** sugerir fraccionar la compra para quedar bajo el tope.
- **Cotización ≠ solicitud (RC5):** la OC se crea por el valor de la solicitud, que es el monto aprobado. Si el valor real será el de la cotización, lo correcto es devolver al solicitante para ajustar valor y obtener una aprobación por el nuevo monto; si se confirma igual, la diferencia aparecerá al conciliar con la factura.
- **IVA no informado (RC6):** se propone el indicador por defecto del proveedor; la analista confirma.
- **Retroactiva (RC8):** la compra se hizo antes de la OC. Se puede crear con confirmación para no frenar el pago, pero queda marcada `retroactiva = true` en `out/control.csv` para que la dirección mida el desvío.

## Códigos útiles
- Indicadores IVA: C0 excluido, C1 IVA 19 %, C2 IVA 5 %.
- Condiciones de pago: Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días.
- Unidades SAP: UN (unidad), H (hora), MES (mes).
- Texto breve de posición en SAP: máximo 40 caracteres (las descripciones más largas se truncan y queda en la trazabilidad).

## Archivos que genera el proceso
- `out/sap/ordenes.jsonl`: OC creadas en el SAP simulado (numeración desde 4500000001).
- `out/<caso>/trazabilidad.json`: origen de cada campo de la OC.
- `out/<caso>/aprobacion.txt` y `.pdf`: evidencia de aprobación con sha256.
- `out/control.csv`: un registro por intento (creada, existente, bloqueado, pendiente) para auditoría.
- `out/log.jsonl`: bitácora de todas las llamadas a herramientas.
