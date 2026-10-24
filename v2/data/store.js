// Capa de datos. Regla: NUNCA se muestra "guardado" hasta que el servidor confirma.
// Lo que no se pudo enviar queda en una cola persistente y se reintenta.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrmStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var ENTITIES = ['prospectos', 'ventas', 'pagos', 'cortes', 'productos', 'vendedores', 'actividad', 'config'];

  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
    };
  }

  function defaultUid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // transport: { all(): Promise<{entidad:[...]}>, send(op): Promise }   op = {op:'upsert',entity,record} | {op:'remove',entity,id}
  function createStore(opts) {
    var transport = opts.transport;
    var storage = opts.storage || memoryStorage();
    var uid = opts.uid || defaultUid;
    var QKEY = 'crm_pending', CKEY = 'crm_cache';

    var state = {};
    ENTITIES.forEach(function (e) { state[e] = []; });
    var pending = read(QKEY, []);
    var cached = read(CKEY, null);
    if (cached) ENTITIES.forEach(function (e) { if (Array.isArray(cached[e])) state[e] = cached[e]; });

    var status = { state: 'idle', pending: pending.length, message: '' };
    var listeners = [];
    var flushing = null;

    function read(key, fallback) {
      try { var v = storage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    }
    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* almacenamiento lleno o bloqueado: seguimos en memoria */ }
    }
    function persist() { write(QKEY, pending); write(CKEY, state); }
    function setStatus(s, message) {
      status = { state: s, pending: pending.length, message: message || '' };
      listeners.slice().forEach(function (fn) { try { fn(status); } catch (e) {} });
    }
    function check(entity) { if (ENTITIES.indexOf(entity) < 0) throw new Error('Entidad desconocida: ' + entity); }

    function applyUpsert(entity, record) {
      var list = state[entity], i = list.findIndex(function (x) { return x.id === record.id; });
      if (i >= 0) list[i] = record; else list.push(record);
    }
    function enqueue(op) {
      // Colapsa operaciones pendientes sobre el mismo registro: solo importa la última.
      var id = op.op === 'upsert' ? op.record.id : op.id;
      pending = pending.filter(function (p) {
        return !(p.entity === op.entity && (p.op === 'upsert' ? p.record.id : p.id) === id);
      });
      pending.push(op);
    }

    function flush() {
      if (flushing) return flushing;
      flushing = (async function () {
        try {
          if (!pending.length) { setStatus('idle'); return true; }
          setStatus('saving');
          var rejected = null;
          while (pending.length) {
            try {
              var res = await transport.send(pending[0]);
              // El servidor devuelve el registro normalizado (p. ej. comisión recalculada): lo adoptamos.
              if (pending[0].op === 'upsert' && res && res.id) applyUpsert(pending[0].entity, res);
              pending.shift();
              persist();
            } catch (e) {
              persist();
              if (e && e.code === 'AUTH') { setStatus('auth', 'Sesión vencida: vuelve a entrar'); }
              else if (e && e.code && e.code !== 'NETWORK') {
                // Rechazo del servidor (validación/permiso): reintentar no sirve; se descarta y se avisa.
                pending.shift(); persist();
                rejected = 'El servidor rechazó el cambio: ' + e.message;
                continue;
              } else { setStatus('error', 'Sin conexión: ' + pending.length + ' cambio(s) pendiente(s)'); }
              return false;
            }
          }
          if (rejected) { setStatus('error', rejected); return false; }
          setStatus('saved', 'Guardado');
          return true;
        } finally { flushing = null; }
      })();
      return flushing;
    }

    async function save(entity, rec) {
      check(entity);
      var record = Object.assign({}, rec);
      if (!record.id) record.id = uid();
      applyUpsert(entity, record);
      enqueue({ op: 'upsert', entity: entity, record: record });
      persist();
      setStatus('saving');
      var saved = await flush();
      return { saved: saved, record: state[entity].find(function (x) { return x.id === record.id; }) || record };
    }

    async function remove(entity, id) {
      check(entity);
      state[entity] = state[entity].filter(function (x) { return x.id !== id; });
      if (entity === 'ventas') state.pagos = state.pagos.filter(function (p) { return p.ventaId !== id; });
      enqueue({ op: 'remove', entity: entity, id: id });
      persist();
      setStatus('saving');
      return { saved: await flush() };
    }

    // Carga desde el servidor. Si hay cambios sin enviar NO se sobrescribe nada.
    async function load() {
      await flush();
      if (pending.length) return { ok: false, reason: 'pending' };
      try {
        var data = await transport.all();
        ENTITIES.forEach(function (e) { state[e] = Array.isArray(data[e]) ? data[e] : []; });
        persist();
        setStatus('idle');
        return { ok: true };
      } catch (e) {
        setStatus(e && e.code === 'AUTH' ? 'auth' : 'error', e && e.code === 'AUTH' ? 'Sesión vencida: vuelve a entrar' : 'Sin conexión: se muestran los últimos datos conocidos');
        return { ok: false, reason: e && e.code === 'AUTH' ? 'auth' : 'offline' };
      }
    }

    function retryEvery(ms) {
      var t = setInterval(function () { if (pending.length) flush(); }, ms);
      return function () { clearInterval(t); };
    }

    return {
      state: state,
      list: function (entity) { check(entity); return state[entity]; },
      save: save, remove: remove, load: load, flush: flush, retryEvery: retryEvery,
      pendingCount: function () { return pending.length; },
      getStatus: function () { return status; },
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
      clearLocal: function () { pending = []; ENTITIES.forEach(function (e) { state[e] = []; }); persist(); },
    };
  }

  return { createStore: createStore, ENTITIES: ENTITIES, memoryStorage: memoryStorage };
});
