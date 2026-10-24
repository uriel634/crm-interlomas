const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, seededEnv } = require('./helpers');

const be = loadBackend();
const call = (env, req) => { try { return { ok: true, data: be.handleRequest(req, env) }; } catch (e) { return { ok: false, code: e.code, error: e.message }; } };
const login = (env, userId, pin) => call(env, { action: 'login', userId, pin });
const tokenOf = (env, userId, pin) => login(env, userId, pin).data.token;

test('login correcto devuelve token y usuario; PIN malo, no', () => {
  const env = seededEnv(be);
  const ok = login(env, 'gerente', '1234');
  assert.ok(ok.ok && ok.data.token && ok.data.user.role === 'gerente');
  const bad = login(env, 'gerente', '0000');
  assert.deepEqual([bad.ok, bad.code], [false, 'BADPIN']);
});
test('NO existen PINs por defecto: usuario sin PIN no entra (ni con 0000/1111)', () => {
  const env = seededEnv(be);
  delete env._props['pin_v2'];
  for (const p of ['0000', '1111', '2222', '3333']) assert.equal(login(env, 'v2', p).code, 'NOPIN');
});
test('5 PIN malos bloquean la cuenta, incluso con el PIN correcto', () => {
  const env = seededEnv(be);
  for (let i = 0; i < 5; i++) assert.equal(login(env, 'v1', '9999').code, 'BADPIN');
  assert.equal(login(env, 'v1', '1111').code, 'LOCKED');
  assert.equal(login(env, 'gerente', '1234').ok, true); // otra cuenta no se ve afectada
});
test('sin token o con token falso: AUTH', () => {
  const env = seededEnv(be);
  assert.equal(call(env, { action: 'all' }).code, 'AUTH');
  assert.equal(call(env, { action: 'all', token: 'falso' }).code, 'AUTH');
});
test('los PIN nunca se devuelven en ninguna lectura', () => {
  const env = seededEnv(be);
  const t = tokenOf(env, 'gerente', '1234');
  assert.ok(!JSON.stringify(call(env, { action: 'all', token: t }).data).toLowerCase().includes('pin'));
});

function setup() {
  const env = seededEnv(be);
  const g = tokenOf(env, 'gerente', '1234'), v1 = tokenOf(env, 'v1', '1111');
  return { env, g, v1 };
}
const venta = (o = {}) => ({ id: 'ven1', fecha: '2026-03-10', cliente: 'Cli', vendedor: 'Ana', producto: 'Piso', total: 10000, lista: 'l2', ...o });

test('ventas: el servidor calcula totalMxn; pagos: calcula montoMxn y comisión ignorando lo que manda el navegador', () => {
  const { env, g } = setup();
  assert.equal(call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta({ moneda: 'USD', tc: 20, total: 1000 }) }).data.totalMxn, 20000);
  call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta() });
  const p = call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'p1', ventaId: 'ven1', fecha: '2026-03-12', monto: 11600, montoMxn: 1, comision: 99999 } }).data;
  assert.equal(p.montoMxn, 11600);
  assert.equal(p.comision, 400); // L2 = 4 % sobre 10,000
});
test('pago de una venta inexistente se rechaza', () => {
  const { env, g } = setup();
  assert.equal(call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'p', ventaId: 'nada', fecha: '2026-01-01', monto: 5 } }).code, 'VALIDATION');
});
test('validación: faltantes, enums, números, textos largos', () => {
  const { env, g } = setup();
  const up = (entity, record) => call(env, { action: 'upsert', token: g, entity, record });
  assert.equal(up('ventas', venta({ cliente: '' })).code, 'VALIDATION');
  assert.equal(up('ventas', venta({ total: 0 })).code, 'VALIDATION');
  assert.equal(up('ventas', venta({ total: 'abc' })).code, 'VALIDATION');
  assert.equal(up('ventas', venta({ lista: 'l9' })).code, 'VALIDATION');
  assert.equal(up('prospectos', { id: 'x', nombre: 'a', tel: '1', vendedor: 'Ana', stage: 'inventada', fecha: '2026-01-01' }).code, 'VALIDATION');
  assert.equal(up('ventas', venta({ notas: 'x'.repeat(501) })).code, 'VALIDATION');
  assert.equal(up('basura', {}).code, 'VALIDATION');
});
test('campos desconocidos se descartan', () => {
  const { env, g } = setup();
  const r = call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta({ hack: '<script>' }) }).data;
  assert.ok(!('hack' in r));
});
test('vendedor: solo ve lo suyo y no puede suplantar a otro', () => {
  const { env, g, v1 } = setup();
  call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta({ id: 'a', vendedor: 'Ana' }) });
  call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta({ id: 'b', vendedor: 'Luis' }) });
  call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'pa', ventaId: 'a', fecha: '2026-03-01', monto: 100 } });
  call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'pb', ventaId: 'b', fecha: '2026-03-01', monto: 100 } });
  const all = call(env, { action: 'all', token: v1 }).data;
  assert.deepEqual(all.ventas.map(v => v.id), ['a']);
  assert.deepEqual(all.pagos.map(p => p.id), ['pa']);
  // intenta crear un prospecto "a nombre de Luis": el servidor lo fuerza a Ana
  const r = call(env, { action: 'upsert', token: v1, entity: 'prospectos', record: { id: 'pr', nombre: 'N', tel: '1', vendedor: 'Luis', stage: 'lead', fecha: '2026-01-01' } }).data;
  assert.equal(r.vendedor, 'Ana');
  // intenta pisar la venta de Luis
  assert.equal(call(env, { action: 'upsert', token: v1, entity: 'ventas', record: venta({ id: 'b', vendedor: 'Ana' }) }).code, 'FORBIDDEN');
});
test('vendedor no puede tocar pagos, cortes, productos, vendedores, config ni PINs', () => {
  const { env, v1 } = setup();
  for (const entity of ['pagos', 'cortes', 'productos', 'vendedores', 'config'])
    assert.equal(call(env, { action: 'upsert', token: v1, entity, record: { id: 'x' } }).code, 'FORBIDDEN', entity);
  assert.equal(call(env, { action: 'set_pin', token: v1, userId: 'gerente', pin: '0000' }).code, 'FORBIDDEN');
});
test('borrar una venta borra sus pagos; el vendedor solo borra prospectos propios', () => {
  const { env, g, v1 } = setup();
  call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta() });
  call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'p1', ventaId: 'ven1', fecha: '2026-03-12', monto: 100 } });
  assert.equal(call(env, { action: 'remove', token: v1, entity: 'ventas', id: 'ven1' }).code, 'FORBIDDEN');
  call(env, { action: 'remove', token: g, entity: 'ventas', id: 'ven1' });
  assert.equal(env.db.list('pagos').length, 0);
});
test('cambiar tasas recalcula comisiones de pagos nuevos', () => {
  const { env, g } = setup();
  call(env, { action: 'upsert', token: g, entity: 'config', record: { id: 'x', l1: 5, l2: 10, l3: 3 } });
  call(env, { action: 'upsert', token: g, entity: 'ventas', record: venta() });
  const p = call(env, { action: 'upsert', token: g, entity: 'pagos', record: { id: 'p1', ventaId: 'ven1', fecha: '2026-03-12', monto: 11600 } }).data;
  assert.equal(p.comision, 1000);
});
test('set_pin: el gerente cambia un PIN y el anterior deja de servir', () => {
  const { env, g } = setup();
  assert.equal(call(env, { action: 'set_pin', token: g, userId: 'v1', pin: '12ab' }).code, 'VALIDATION');
  assert.ok(call(env, { action: 'set_pin', token: g, userId: 'v1', pin: '4321' }).ok);
  assert.equal(login(env, 'v1', '1111').code, 'BADPIN');
  assert.ok(login(env, 'v1', '4321').ok);
});
