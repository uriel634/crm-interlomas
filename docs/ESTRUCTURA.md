# CRM Showroom Interlomas — Estructura para reconstruir desde cero

Documento extraído de `index.html` (3,417 líneas, un solo archivo, backend en Google Apps Script + Google Sheets).
Describe **qué hace** el sistema y **qué reglas debe respetar**. Al final: errores del sistema actual que NO hay que repetir.

---

## 1. Qué es
CRM de showroom de pisos/acabados. Dos roles: **Gerente** (ve todo) y **Vendedor** (solo lo suyo).
Flujo de negocio: prospecto → etapas de venta → venta → cobros (parciales) → comisión del vendedor → corte mensual → pago de comisión.

## 2. Roles y acceso
- Login por **PIN de 4 dígitos** (no usuario/contraseña). Usuarios: `gerente`, `v1`, `v2`, `v3` (vendedores configurables).
- 3 intentos fallidos → bloqueo 30 s.
- Gerente: todas las pantallas. Vendedor: solo Pipeline, Seguimientos y Comisiones, filtrados por su nombre.
- El gerente cambia los PINs en Configuración.
- Página de inicio: gerente → Dashboard; vendedor → Pipeline.

## 3. Pantallas
| Pantalla | Quién | Contenido |
|---|---|---|
| Dashboard | Gerente | KPIs generales, actividad reciente |
| Pipeline | Todos | Kanban por etapas; tarjeta abre detalle |
| Seguimientos | Todos | Prospectos con fecha de seguimiento vencida/próxima; banner al entrar |
| Ventas & Cobros | Gerente | Lista de ventas, KPIs, registrar cobros, editar venta/pago |
| Comisiones | Todos | KPIs, tarjeta por vendedor (cuota, cumplimiento, bono), cortes mensuales, exportar reporte |
| Productos & Tasas | Gerente | Catálogo, precios por lista, % por lista, cuotas/bonos de vendedores, PINs, backup/importar/borrar todo |
| Carga Diaria | Gerente | Importar ventas por CSV o captura manual en filas; bitácora de cargas |

Modales: nuevo prospecto, nueva venta, detalle de prospecto (editar, comentar, mover etapa, convertir a venta, marcar perdido), cobro, backup, confirmar perdido, confirmar borrado total.
Extras: búsqueda global (prospectos y ventas), botón flotante de venta (móvil), barra de estado de sincronización.

## 4. Modelo de datos
**Prospecto (lead)**: `id, nombre, tel, red, medio, vendedor, producto, monto, stage, obs, followup, fecha`
- Etapas (`stage`): `lead → contacto → visita → cotizacion → negociacion → cierre`
- Perdido: hoy se **elimina** el prospecto. Motivos disponibles: Precio alto, Eligió competencia, Sin presupuesto, Sin respuesta, Proyecto cancelado, No era el momento, Otro (el motivo no se guarda).

**Venta**: `id, fecha, cliente, vendedor, producto, lista (l1|l2|l3), moneda (MXN|USD), tc, total, totalMxn, cobrado, cobradoMxn, pedido, metodo, notas, comision`

**Pago (cobro)**: `id, ventaId, fecha, monto, moneda, tc, montoMxn, metodo, referencia, comision`
- Una venta tiene 0..N pagos. **La comisión se calcula por pago**, no por venta.

**Corte de comisión**: `id, mes, vendedor, comision, pagado, fechaCorte, fechaPago`

**Producto**: `id, name, rate, price, p_l1, p_l2, p_l3, unit (m²|pza|---)`
**Vendedor**: `id, name, color, cuota (default 150000), bono (default 20 %)`
**Actividad**: `texto/text, fecha/time, color`
**PIN**: `id, pin` (solo en el backend, nunca en el HTML)

Catálogo inicial: Piso Porcelánico, Piso Madera, Azulejo/Talavera, Piedra Natural, Mosaico Vítreo, Baño Completo, Cocina Integral, Accesorios, Servicio/Instalación, Otro.

## 5. Reglas de negocio (críticas)
1. **Comisión** = `(monto cobrado en MXN ÷ 1.16) × % de la lista de precios`. Solo sobre lo **cobrado**, antes de IVA. Redondeo a entero.
2. **% por lista** (configurable): L1 = 5 %, L2 = 4 %, L3 = 3 %. La tasa viene de la lista, **no del producto**.
3. **USD**: `MXN = monto × tipo de cambio`, redondeado. Todo reporte opera en MXN.
4. **Saldo** = total MXN − suma de pagos MXN.
5. **Cumplimiento de cuota** = total vendido MXN del vendedor ÷ su cuota.
6. **Bono** = si cumplimiento ≥ 100 %, `comisión × bono %`; si no, 0.
7. **Corte mensual**: suma las comisiones de los pagos del mes por vendedor; se puede marcar como pagado (con fecha). Avisar si ya existe un corte de ese mes.
8. **Convertir a venta**: mueve el prospecto a `cierre` y abre el formulario de venta.
9. **Seguimiento**: al entrar se avisa de prospectos con fecha vencida o de mañana.
10. Un vendedor solo ve y crea datos con su nombre (el campo vendedor queda fijo).

## 6. Contrato de API (Apps Script, JSON)
Respuesta siempre `{ ok: boolean, data: ... }`.
- GET `?action=init` (crea hojas si faltan) · `?action=all` (devuelve prospectos, ventas, productos, vendedores, actividad)
- POST (Content-Type `text/plain`, cuerpo `{action, data}`):
  `save_lead`, `delete_lead`, `save_venta`, `save_productos`, `save_vendedores`, `log_activity`, `validate_pin`, `save_pins`, `full_backup`
- **Faltan en el sistema actual** (hay que crearlas): `save_pago`, `delete_pago`, `save_corte`, y `lista/moneda/tc/totalMxn/cobradoMxn/comision` en venta.

## 7. Importación CSV
Columnas: `Fecha, Cliente, Vendedor, Producto, Total, Cobrado, Pedido, Notas`. Obligatorias: fecha, cliente, vendedor, producto, total.
Valida que vendedor y producto existan en el catálogo; muestra vista previa con errores por línea; registra la carga en bitácora.

## 8. Arquitectura recomendada para la reconstrucción
1. **Una sola capa de datos** (`store`) con `save(tipo, objeto)` que envía el objeto **completo** (sin mapear campo por campo) y devuelve éxito/fallo real.
2. **Estado visible**: si no se guardó, mostrar rojo y reintentar (cola de pendientes). Nunca "Guardado" sin confirmación del servidor.
3. **Una sola función de comisión** (`calcComision`) usada en TODO (venta, cobro, CSV, reportes).
4. **Pagos como entidad guardada**; el `cobrado` de la venta se deriva de sus pagos, no al revés.
5. Separar en archivos: `data/` (API + store), `logic/` (comisiones, moneda), `ui/` (pantallas), `auth/`.
6. **Pruebas automáticas** desde el día 1 (la base ya existe en `tests/verify.js`): crear prospecto, venta, cobro, recargar y comparar.
7. Validar en el servidor (Apps Script), no solo en el navegador.

## 9. Errores del sistema actual que NO se deben repetir
| # | Problema | Dónde |
|---|---|---|
| 1 | Los cobros nunca se guardan en Sheets; al recargar se pierden | `saveCobro`, `savePagoEdit`, `deletePago` sin sync |
| 2 | `ventaToSheet` omite lista, moneda, tc, totalMxn, cobradoMxn; la comisión se manda `undefined` | `ventaToSheet` / `saveVenta` |
| 3 | Dice "✅ Guardado" aunque falle la red | `syncLead`, `syncVenta` atrapan el error y luego se pone verde |
| 4 | Los cortes de comisión (`cortes`) solo viven en memoria | `generarCorte`, `pagarCorte` |
| 5 | Importación CSV calcula la comisión con la tasa **del producto** (regla antigua) y no crea pagos ni lista | `importCSV` |
| 6 | PIN de respaldo hardcodeado sin conexión (`0000/1111/2222/3333`): cortando internet se entra con eso | `validatePin` |
| 7 | La URL del Apps Script está en el HTML y `?action=all` devuelve todo sin autenticar | `API_URL` |
| 8 | Mapas de vendedores fijos (`v1/v2/v3`) en varias funciones; no escala a más vendedores | `myleads`, `selectUser`, `doLogin` |
| 9 | Prospecto perdido se borra sin guardar el motivo | `doLost` |
| 10 | `saveAll` definida dos veces; ids con `Date.now()` / contadores locales (`nLid`, `nVid`) que pueden chocar entre usuarios | varios |
| 11 | "Borrar todo" manda arrays vacíos a Sheets sin respaldo previo obligatorio | `doClearData` |
