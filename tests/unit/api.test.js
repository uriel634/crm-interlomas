const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../../v2/data/api.js');

const resp = body => ({ json: async () => body });

test('login guarda el token y lo envía en las siguientes llamadas', async () => {
  const calls = [];
  const fetch = async (url, init) => { const b = JSON.parse(init.body); calls.push({ init, b }); return resp(b.action === 'login' ? { ok: true, data: { token: 'T1', user: { id: 'g', role: 'gerente' } } } : { ok: true, data: { ventas: [] } }); };
  const api = createApi({ url: 'u', fetch });
  assert.equal((await api.login('gerente', '1234')).role, 'gerente');
  await api.transport.all();
  assert.equal(calls[1].b.token, 'T1');
  assert.equal(calls[0].init.headers['Content-Type'], 'text/plain');
});
test('caída de red => code NETWORK; error del servidor => su code', async () => {
  let mode = 'net';
  const fetch = async () => { if (mode === 'net') throw new Error('offline'); return resp({ ok: false, error: 'PIN incorrecto', code: 'BADPIN' }); };
  const api = createApi({ url: 'u', fetch });
  await assert.rejects(api.login('g', '1'), e => e.code === 'NETWORK');
  mode = 'srv';
  await assert.rejects(api.login('g', '1'), e => e.code === 'BADPIN' && /PIN/.test(e.message));
});
test('AUTH borra el token local; respuesta no-JSON se trata como red', async () => {
  const storage = { m: { crm_token: 'viejo' }, getItem(k) { return this.m[k] || null; }, setItem(k, v) { this.m[k] = v; }, removeItem(k) { delete this.m[k]; } };
  const api = createApi({ url: 'u', storage, fetch: async () => resp({ ok: false, error: 'x', code: 'AUTH' }) });
  assert.equal(api.hasToken(), true);
  await assert.rejects(api.transport.all(), e => e.code === 'AUTH');
  assert.equal(api.hasToken(), false);
  assert.equal(storage.getItem('crm_token'), null);
  const bad = createApi({ url: 'u', fetch: async () => ({ json: async () => { throw new Error('html'); } }) });
  await assert.rejects(bad.transport.all(), e => e.code === 'NETWORK');
});
test('send traduce upsert/remove a las acciones del backend', async () => {
  const bodies = [];
  const api = createApi({ url: 'u', fetch: async (u, i) => { bodies.push(JSON.parse(i.body)); return resp({ ok: true, data: {} }); } });
  await api.transport.send({ op: 'upsert', entity: 'ventas', record: { id: 'v' } });
  await api.transport.send({ op: 'remove', entity: 'ventas', id: 'v' });
  assert.deepEqual(bodies.map(b => [b.action, b.entity]), [['upsert', 'ventas'], ['remove', 'ventas']]);
});
