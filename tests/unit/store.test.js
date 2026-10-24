const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, memoryStorage } = require('../../v2/data/store.js');

// Servidor falso: puede caerse y puede rechazar.
function fakeServer() {
  const db = { prospectos: [], ventas: [], pagos: [], cortes: [], productos: [], vendedores: [], actividad: [], config: [] };
  const s = { up: true, reject: null, sent: [], db };
  s.transport = {
    all: async () => { if (!s.up) { const e = new Error('x'); e.code = 'NETWORK'; throw e; } return JSON.parse(JSON.stringify(db)); },
    send: async op => {
      if (!s.up) { const e = new Error('x'); e.code = 'NETWORK'; throw e; }
      if (s.reject) { const e = new Error(s.reject); e.code = 'VALIDATION'; throw e; }
      s.sent.push(op);
      if (op.op === 'upsert') { const l = db[op.entity], i = l.findIndex(x => x.id === op.record.id); if (i >= 0) l[i] = op.record; else l.push(op.record); return op.record; }
      db[op.entity] = db[op.entity].filter(x => x.id !== op.id); return { removed: true };
    },
  };
  return s;
}

test('guardado exitoso: saved=true y el servidor lo tiene', async () => {
  const srv = fakeServer(), st = createStore({ transport: srv.transport });
  const r = await st.save('prospectos', { nombre: 'A' });
  assert.equal(r.saved, true);
  assert.equal(srv.db.prospectos.length, 1);
  assert.equal(st.getStatus().state, 'saved');
  assert.equal(st.pendingCount(), 0);
});
test('sin conexión: saved=false, NO dice guardado, queda pendiente y se ve en pantalla', async () => {
  const srv = fakeServer(); srv.up = false;
  const st = createStore({ transport: srv.transport });
  const r = await st.save('ventas', { cliente: 'X' });
  assert.equal(r.saved, false);
  assert.equal(st.getStatus().state, 'error');
  assert.equal(st.pendingCount(), 1);
  assert.equal(st.list('ventas').length, 1);
});
test('al volver la conexión, flush envía lo pendiente en orden', async () => {
  const srv = fakeServer(); srv.up = false;
  const st = createStore({ transport: srv.transport });
  await st.save('prospectos', { id: 'a', nombre: '1' });
  await st.save('prospectos', { id: 'b', nombre: '2' });
  srv.up = true;
  assert.equal(await st.flush(), true);
  assert.deepEqual(srv.sent.map(o => o.record.id), ['a', 'b']);
  assert.equal(st.getStatus().state, 'saved');
});
test('varias ediciones del mismo registro offline se colapsan en una', async () => {
  const srv = fakeServer(); srv.up = false;
  const st = createStore({ transport: srv.transport });
  await st.save('prospectos', { id: 'a', nombre: 'v1' });
  await st.save('prospectos', { id: 'a', nombre: 'v2' });
  assert.equal(st.pendingCount(), 1);
  srv.up = true; await st.flush();
  assert.equal(srv.db.prospectos[0].nombre, 'v2');
});
test('lo pendiente sobrevive a recargar la página (persistencia)', async () => {
  const srv = fakeServer(); srv.up = false;
  const storage = memoryStorage();
  await createStore({ transport: srv.transport, storage }).save('ventas', { id: 'v', cliente: 'Persistente' });
  srv.up = true;
  const st2 = createStore({ transport: srv.transport, storage }); // "recarga"
  assert.equal(st2.pendingCount(), 1);
  assert.equal(st2.list('ventas')[0].cliente, 'Persistente'); // se ve aun sin conexión
  await st2.flush();
  assert.equal(srv.db.ventas[0].cliente, 'Persistente');
});
test('load() NO pisa cambios sin enviar', async () => {
  const srv = fakeServer(); srv.up = false;
  const st = createStore({ transport: srv.transport });
  await st.save('prospectos', { id: 'a', nombre: 'local' });
  const r = await st.load();
  assert.deepEqual([r.ok, r.reason], [false, 'pending']);
  assert.equal(st.list('prospectos')[0].nombre, 'local');
});
test('load() trae los datos del servidor; sin conexión conserva el último caché', async () => {
  const srv = fakeServer(); srv.db.prospectos.push({ id: 'z', nombre: 'Remoto' });
  const storage = memoryStorage();
  const st = createStore({ transport: srv.transport, storage });
  assert.equal((await st.load()).ok, true);
  assert.equal(st.list('prospectos')[0].nombre, 'Remoto');
  srv.up = false;
  const st2 = createStore({ transport: srv.transport, storage });
  assert.equal((await st2.load()).reason, 'offline');
  assert.equal(st2.list('prospectos')[0].nombre, 'Remoto');
});
test('el store adopta el registro normalizado por el servidor (comisión recalculada)', async () => {
  const srv = fakeServer();
  const orig = srv.transport.send;
  srv.transport.send = async op => { const r = await orig(op); return op.op === 'upsert' ? { ...r, comision: 400 } : r; };
  const st = createStore({ transport: srv.transport });
  const r = await st.save('pagos', { id: 'p', comision: 1 });
  assert.equal(r.record.comision, 400);
});
test('rechazo del servidor (validación): se avisa y NO se reintenta infinitamente', async () => {
  const srv = fakeServer(); srv.reject = 'Falta cliente';
  const st = createStore({ transport: srv.transport });
  const r = await st.save('ventas', { id: 'v' });
  assert.equal(st.getStatus().state, 'error');
  assert.match(st.getStatus().message, /Falta cliente/);
  assert.equal(st.pendingCount(), 0);
  assert.equal(r.saved, false); // el cambio NO quedó guardado y no se reintenta
});
test('sesión vencida: estado auth y se conserva lo pendiente', async () => {
  const srv = fakeServer();
  srv.transport.send = async () => { const e = new Error('x'); e.code = 'AUTH'; throw e; };
  const st = createStore({ transport: srv.transport });
  await st.save('prospectos', { id: 'a', nombre: 'n' });
  assert.equal(st.getStatus().state, 'auth');
  assert.equal(st.pendingCount(), 1);
});
test('remove de una venta quita también sus pagos en pantalla', async () => {
  const srv = fakeServer(), st = createStore({ transport: srv.transport });
  await st.save('ventas', { id: 'v' }); await st.save('pagos', { id: 'p', ventaId: 'v' });
  await st.remove('ventas', 'v');
  assert.equal(st.list('pagos').length, 0);
});
test('entidad inexistente lanza error', async () => {
  const st = createStore({ transport: fakeServer().transport });
  await assert.rejects(() => st.save('cosas', {}), /Entidad desconocida/);
});
