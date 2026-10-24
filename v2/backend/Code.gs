/**
 * CRM Showroom Interlomas — API (Google Apps Script + Google Sheets)
 *
 * - Todo es POST con cuerpo JSON (text/plain). Respuesta: {ok, data} | {ok:false, error, code}
 * - Login por PIN -> token de sesión (6 h). Los PIN se guardan con hash+sal en Script Properties.
 * - SIN PIN de respaldo ni PIN por defecto: si un usuario no tiene PIN, no puede entrar (ver setPinDesdeEditor).
 * - El servidor valida y RECALCULA importes en MXN y comisiones: nunca confía en lo que manda el navegador.
 * - La lógica de handleRequest recibe sus dependencias (env), por eso se puede probar fuera de Google (tests/unit/backend.test.js).
 */

var ENTITIES = {
  prospectos: { f: { id: 's', nombre: 's', tel: 's', red: 's', medio: 's', vendedor: 's', producto: 's', monto: 'n', stage: 's', obs: 's', followup: 's', fecha: 's', motivo: 's' },
                req: ['id', 'nombre', 'tel', 'vendedor', 'stage', 'fecha'],
                enums: { stage: ['lead', 'contacto', 'visita', 'cotizacion', 'negociacion', 'cierre', 'perdido'] } },
  ventas:     { f: { id: 's', fecha: 's', cliente: 's', vendedor: 's', producto: 's', lista: 's', moneda: 's', tc: 'n', total: 'n', totalMxn: 'n', pedido: 's', metodo: 's', notas: 's', prospectoId: 's' },
                req: ['id', 'fecha', 'cliente', 'vendedor', 'producto', 'total'],
                enums: { lista: ['l1', 'l2', 'l3'], moneda: ['MXN', 'USD'] } },
  pagos:      { f: { id: 's', ventaId: 's', fecha: 's', monto: 'n', moneda: 's', tc: 'n', montoMxn: 'n', metodo: 's', referencia: 's', comision: 'n' },
                req: ['id', 'ventaId', 'fecha', 'monto'], enums: { moneda: ['MXN', 'USD'] } },
  cortes:     { f: { id: 's', mes: 's', vendedor: 's', comision: 'n', pagado: 'b', fechaCorte: 's', fechaPago: 's' }, req: ['id', 'mes', 'vendedor'], enums: {} },
  productos:  { f: { id: 's', name: 's', rate: 'n', price: 'n', p_l1: 'n', p_l2: 'n', p_l3: 'n', unit: 's' }, req: ['id', 'name'], enums: {} },
  vendedores: { f: { id: 's', name: 's', color: 's', cuota: 'n', bono: 'n' }, req: ['id', 'name'], enums: {} },
  actividad:  { f: { id: 's', texto: 's', fecha: 's', color: 's', usuario: 's' }, req: ['id', 'texto'], enums: {} },
  config:     { f: { id: 's', l1: 'n', l2: 'n', l3: 'n' }, req: ['id'], enums: {} }
};
var DEFAULTS = { lista: 'l1', moneda: 'MXN', tc: 1, cuota: 150000, bono: 20, metodo: 'Transferencia' };
var GERENTE_ONLY_WRITE = ['pagos', 'cortes', 'productos', 'vendedores', 'config'];
var IVA = 1.16;
var DEFAULT_RATES = { l1: 5, l2: 4, l3: 3 };
var TOKEN_TTL = 21600;      // 6 h (máximo de CacheService)
var MAX_FAILS = 5, LOCK_SECONDS = 300;

// ── Errores ──────────────────────────────────────────────
function fail(code, msg) { var e = new Error(msg); e.code = code; throw e; }

// ── Finanzas (copia exacta de v2/logic/finance.js; la prueba de paridad lo verifica) ──
function toMXN(monto, moneda, tc) {
  var m = Number(monto) || 0;
  return moneda === 'USD' ? Math.round(m * (Number(tc) || 1)) : Math.round(m);
}
function rateFor(lista, rates) {
  var r = rates || DEFAULT_RATES, v = r[lista];
  return v === undefined || v === null || isNaN(v) ? r.l1 : Number(v);
}
function calcComision(cobradoMxn, lista, rates) {
  return Math.round(((Number(cobradoMxn) || 0) / IVA) * (rateFor(lista, rates) / 100));
}

// ── Validación ───────────────────────────────────────────
function clean(entity, rec) {
  var spec = ENTITIES[entity], out = {};
  if (!rec || typeof rec !== 'object') fail('VALIDATION', 'Registro inválido');
  Object.keys(spec.f).forEach(function (k) {
    var t = spec.f[k], v = rec[k];
    if (v === undefined || v === null || v === '') {
      out[k] = DEFAULTS[k] !== undefined && spec.req.indexOf(k) < 0 ? DEFAULTS[k] : (t === 'n' ? 0 : (t === 'b' ? false : ''));
      return;
    }
    if (t === 'n') { var n = Number(v); if (isNaN(n)) fail('VALIDATION', 'Campo numérico inválido: ' + k); out[k] = n; }
    else if (t === 'b') out[k] = v === true || v === 'true';
    else { var s = String(v).trim(); if (s.length > 500) fail('VALIDATION', 'Texto demasiado largo: ' + k); out[k] = s; }
  });
  spec.req.forEach(function (k) { if (out[k] === '' || out[k] === undefined) fail('VALIDATION', 'Falta el campo obligatorio: ' + k); });
  Object.keys(spec.enums).forEach(function (k) { if (spec.enums[k].indexOf(out[k]) < 0) fail('VALIDATION', 'Valor no permitido en ' + k + ': ' + out[k]); });
  if (entity === 'ventas' && !(out.total > 0)) fail('VALIDATION', 'El total debe ser mayor a 0');
  if (entity === 'pagos' && !(out.monto > 0)) fail('VALIDATION', 'El monto debe ser mayor a 0');
  if (entity === 'config') ['l1', 'l2', 'l3'].forEach(function (k) { if (out[k] < 0 || out[k] > 100) fail('VALIDATION', 'Tasa fuera de rango: ' + k); });
  return out;
}

function getRates(env) {
  var c = env.db.list('config').filter(function (x) { return x.id === 'rates'; })[0];
  return c ? { l1: c.l1, l2: c.l2, l3: c.l3 } : DEFAULT_RATES;
}

// ── Autenticación ────────────────────────────────────────
function userDirectory(env) {
  var users = [{ id: 'gerente', name: 'Gerente', role: 'gerente' }];
  env.db.list('vendedores').forEach(function (v) { users.push({ id: v.id, name: v.name, role: 'vendedor' }); });
  return users;
}
function hashPin(env, userId, pin) { return env.hash(env.props.get('salt') + ':' + userId + ':' + pin); }

function login(env, req) {
  var userId = String(req.userId || ''), pin = String(req.pin || '');
  var user = userDirectory(env).filter(function (u) { return u.id === userId; })[0];
  var failKey = 'fail_' + userId;
  var fails = Number(env.cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) fail('LOCKED', 'Demasiados intentos. Espera 5 minutos.');
  var stored = env.props.get('pin_' + userId);
  if (!user || !stored) fail('NOPIN', 'Este usuario no tiene PIN configurado. Pídele al administrador que lo configure.');
  if (!/^\d{4}$/.test(pin) || hashPin(env, userId, pin) !== stored) {
    env.cache.put(failKey, String(fails + 1), LOCK_SECONDS);
    fail('BADPIN', 'PIN incorrecto');
  }
  env.cache.remove(failKey);
  var token = env.token();
  env.cache.put('tok_' + token, JSON.stringify(user), TOKEN_TTL);
  return { token: token, user: user };
}

function session(env, req) {
  var raw = req.token ? env.cache.get('tok_' + req.token) : null;
  if (!raw) fail('AUTH', 'Sesión vencida');
  return JSON.parse(raw);
}

// ── Filtros por rol ──────────────────────────────────────
function visible(env, entity, user) {
  var rows = env.db.list(entity);
  if (user.role === 'gerente') return rows;
  if (entity === 'prospectos' || entity === 'ventas') return rows.filter(function (r) { return r.vendedor === user.name; });
  if (entity === 'cortes') return rows.filter(function (r) { return r.vendedor === user.name; });
  if (entity === 'pagos') {
    var mine = {};
    env.db.list('ventas').forEach(function (v) { if (v.vendedor === user.name) mine[v.id] = true; });
    return rows.filter(function (r) { return mine[r.ventaId]; });
  }
  return rows;
}

// ── Punto de entrada (testeable) ─────────────────────────
function handleRequest(req, env) {
  if (!req || typeof req !== 'object') fail('VALIDATION', 'Solicitud inválida');
  if (req.action === 'login') return login(env, req);

  var user = session(env, req);
  var isG = user.role === 'gerente';

  if (req.action === 'all') {
    var data = {};
    Object.keys(ENTITIES).forEach(function (e) { data[e] = visible(env, e, user); });
    return data;
  }

  if (req.action === 'upsert') {
    var entity = req.entity;
    if (!ENTITIES[entity]) fail('VALIDATION', 'Entidad desconocida');
    if (!isG && GERENTE_ONLY_WRITE.indexOf(entity) >= 0) fail('FORBIDDEN', 'Solo el gerente puede modificar ' + entity);
    var rec = clean(entity, req.record);
    var existing = env.db.list(entity).filter(function (x) { return x.id === rec.id; })[0];

    if (!isG) { // el vendedor solo toca lo suyo
      if (existing && existing.vendedor && existing.vendedor !== user.name) fail('FORBIDDEN', 'Ese registro no es tuyo');
      if (rec.vendedor !== undefined && ENTITIES[entity].f.vendedor) rec.vendedor = user.name;
    }
    if (entity === 'ventas') rec.totalMxn = toMXN(rec.total, rec.moneda, rec.tc);
    if (entity === 'pagos') {
      var venta = env.db.list('ventas').filter(function (v) { return v.id === rec.ventaId; })[0];
      if (!venta) fail('VALIDATION', 'La venta del pago no existe');
      rec.montoMxn = toMXN(rec.monto, rec.moneda, rec.tc);
      rec.comision = calcComision(rec.montoMxn, venta.lista, getRates(env));
    }
    if (entity === 'config') rec.id = 'rates';
    env.db.upsert(entity, rec);
    return rec; // el cliente adopta el registro normalizado
  }

  if (req.action === 'remove') {
    var ent = req.entity;
    if (!ENTITIES[ent]) fail('VALIDATION', 'Entidad desconocida');
    var row = env.db.list(ent).filter(function (x) { return x.id === req.id; })[0];
    if (!row) return { removed: false };
    if (!isG) {
      if (ent !== 'prospectos' || row.vendedor !== user.name) fail('FORBIDDEN', 'No puedes eliminar esto');
    }
    if (ent === 'ventas') env.db.list('pagos').forEach(function (p) { if (p.ventaId === req.id) env.db.remove('pagos', p.id); });
    env.db.remove(ent, req.id);
    return { removed: true };
  }

  if (req.action === 'set_pin') {
    if (!isG) fail('FORBIDDEN', 'Solo el gerente cambia PINs');
    var target = String(req.userId || '');
    if (!userDirectory(env).some(function (u) { return u.id === target; })) fail('VALIDATION', 'Usuario inexistente');
    if (!/^\d{4}$/.test(String(req.pin))) fail('VALIDATION', 'El PIN debe tener 4 dígitos');
    if (!env.props.get('salt')) env.props.set('salt', env.token());
    env.props.set('pin_' + target, hashPin(env, target, String(req.pin)));
    return { updated: true };
  }

  fail('VALIDATION', 'Acción desconocida: ' + req.action);
}

// ── Adaptadores de Google (no se ejecutan en las pruebas) ─
function makeEnv() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  function sheet(entity) {
    var sh = ss.getSheetByName(entity), cols = Object.keys(ENTITIES[entity].f);
    if (!sh) { sh = ss.insertSheet(entity); sh.appendRow(cols); sh.getRange(1, 1, 1, cols.length).setFontWeight('bold'); }
    return { sh: sh, cols: cols };
  }
  function coerce(entity, cols, row) {
    var o = {};
    cols.forEach(function (c, i) {
      var t = ENTITIES[entity].f[c], v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
      o[c] = t === 'n' ? (Number(v) || 0) : (t === 'b' ? (v === true || v === 'true' || v === 'TRUE') : (v === null || v === undefined ? '' : String(v)));
    });
    return o;
  }
  return {
    props: { get: function (k) { return props.getProperty(k); }, set: function (k, v) { props.setProperty(k, v); } },
    cache: { get: function (k) { return cache.get(k); }, put: function (k, v, s) { cache.put(k, v, s); }, remove: function (k) { cache.remove(k); } },
    hash: function (s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); },
    token: function () { return Utilities.getUuid() + Utilities.getUuid().replace(/-/g, ''); },
    db: {
      list: function (entity) {
        var s = sheet(entity), last = s.sh.getLastRow();
        if (last < 2) return [];
        return s.sh.getRange(2, 1, last - 1, s.cols.length).getValues().map(function (r) { return coerce(entity, s.cols, r); });
      },
      upsert: function (entity, rec) {
        var s = sheet(entity), last = s.sh.getLastRow(), row = -1;
        if (last >= 2) { var ids = s.sh.getRange(2, 1, last - 1, 1).getValues(); for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === rec.id) { row = i + 2; break; } }
        if (row < 0) row = last + 1;
        var rng = s.sh.getRange(row, 1, 1, s.cols.length);
        rng.setNumberFormat('@');                       // texto: evita fechas automáticas y fórmulas inyectadas
        rng.setValues([s.cols.map(function (c) { return rec[c]; })]);
      },
      remove: function (entity, id) {
        var s = sheet(entity), last = s.sh.getLastRow();
        if (last < 2) return;
        var ids = s.sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { s.sh.deleteRow(i + 2); return; }
      }
    }
  };
}

function doPost(e) {
  var lock = LockService.getScriptLock(), out;
  try {
    lock.waitLock(20000);
    out = { ok: true, data: handleRequest(JSON.parse(e.postData.contents), makeEnv()) };
  } catch (err) {
    out = { ok: false, error: String(err.message || err), code: err.code || 'ERROR' };
  } finally { try { lock.releaseLock(); } catch (x) {} }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: 'CRM Interlomas API' })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * CONFIGURACIÓN INICIAL (se ejecuta UNA vez desde el editor de Apps Script, nunca desde la web).
 * 1) Edita los PIN de abajo, 2) Ejecuta setupInicial, 3) Vuelve a borrar los PIN del código.
 */
function setupInicial() {
  var env = makeEnv();
  var pins = { gerente: 'CAMBIAME' };   // ej.: { gerente: '4821', v1: '...', v2: '...' } — 4 dígitos
  if (!env.props.get('salt')) env.props.set('salt', env.token());
  Object.keys(pins).forEach(function (id) {
    if (!/^\d{4}$/.test(pins[id])) throw new Error('PIN inválido para ' + id + ' (deben ser 4 dígitos)');
    env.props.set('pin_' + id, hashPin(env, id, pins[id]));
  });
}
