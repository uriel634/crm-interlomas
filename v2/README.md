# CRM Interlomas v2 (reconstrucción por etapas)

El `index.html` actual NO se toca hasta que v2 esté completo y probado. Reglas de negocio: `docs/ESTRUCTURA.md`.

## Etapas
| # | Contenido | Estado |
|---|---|---|
| 1 | Lógica de dinero, capa de datos (cola offline), API cliente, backend con login seguro + pruebas | ✅ hecha (`npm test`, 37 pruebas) |
| 2 | Login con PIN, shell/navegación, roles, barra de estado de guardado | pendiente |
| 3 | Prospectos: pipeline, detalle, seguimientos, perdidos con motivo | pendiente |
| 4 | Ventas y cobros (pagos), saldo, USD | pendiente |
| 5 | Comisiones, cuotas/bono, cortes, reporte | pendiente |
| 6 | Productos y tasas, vendedores, PINs, carga CSV, backup, dashboard | pendiente |
| 7 | Migración de datos del Sheet actual + pruebas de navegador de punta a punta + cambio de `index.html` | pendiente |

## Estructura
- `logic/finance.js` — única fórmula de comisión/moneda/cuota (navegador).
- `data/store.js` — guardar/borrar/cargar; nunca dice "guardado" sin confirmación; cola persistente de pendientes.
- `data/api.js` — transporte HTTP + sesión por token.
- `backend/Code.gs` — Apps Script: login, permisos por rol, validación y recálculo de importes en el servidor.

## Publicar el backend (cuando se llegue a la etapa 2)
1. Crea una hoja de cálculo NUEVA de Google (no uses la actual) → Extensiones → Apps Script → pega `Code.gs`.
2. En `setupInicial` pon los PIN de 4 dígitos, ejecútala UNA vez y borra los PIN del código.
3. Implementar → Aplicación web → Ejecutar como: yo · Acceso: cualquiera. Copia la URL.
4. Los PIN y el token nunca viajan en la URL; no hay PIN de respaldo sin conexión.
