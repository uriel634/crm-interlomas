const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Carga Code.gs tal cual en un contexto aislado (sin servicios de Google).
function loadBackend() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../v2/backend/Code.gs'), 'utf8'), ctx);
  return ctx;
}

// Entorno en memoria equivalente al de Google (props, cache con expiración, hash, token, tablas).
function makeEnv(seed = {}) {
  const props = {}, cache = {}, tables = {};
  let tok = 0;
  const env = {
    props: { get: k => (k in props ? props[k] : null), set: (k, v) => { props[k] = v; } },
    cache: { get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } },
    hash: s => crypto.createHash('sha256').update(s).digest('hex'),
    token: () => 'tok' + (++tok) + crypto.randomBytes(8).toString('hex'),
    db: {
      list: e => (tables[e] || []).map(r => ({ ...r })),
      upsert: (e, r) => { tables[e] = tables[e] || []; const i = tables[e].findIndex(x => x.id === r.id); if (i >= 0) tables[e][i] = { ...r }; else tables[e].push({ ...r }); },
      remove: (e, id) => { tables[e] = (tables[e] || []).filter(x => x.id !== id); },
    },
    _tables: tables, _cache: cache, _props: props,
  };
  Object.entries(seed).forEach(([e, rows]) => rows.forEach(r => env.db.upsert(e, r)));
  return env;
}

// Prepara un entorno con PINs ya configurados (lo que hace setupInicial en producción).
function seededEnv(be) {
  const env = makeEnv({
    vendedores: [
      { id: 'v1', name: 'Ana', color: '#3b82f6', cuota: 150000, bono: 20 },
      { id: 'v2', name: 'Luis', color: '#22c55e', cuota: 150000, bono: 20 },
    ],
  });
  env.props.set('salt', 'sal-de-prueba');
  const pin = (id, p) => env.props.set('pin_' + id, env.hash('sal-de-prueba:' + id + ':' + p));
  pin('gerente', '1234'); pin('v1', '1111'); pin('v2', '2222');
  return env;
}

module.exports = { loadBackend, makeEnv, seededEnv };
