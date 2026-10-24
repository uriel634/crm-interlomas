// Transporte HTTP hacia el Apps Script + sesión (token). Sin PIN de respaldo: sin servidor no hay acceso.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrmApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function createApi(opts) {
    var url = opts.url;
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    var storage = opts.storage || { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
    var TKEY = 'crm_token';
    var token = null;
    try { token = storage.getItem(TKEY); } catch (e) {}

    async function post(body) {
      var r;
      try {
        // text/plain evita el preflight CORS que Apps Script no soporta.
        r = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ token: token }, body)) });
      } catch (e) { var ne = new Error('Sin conexión'); ne.code = 'NETWORK'; throw ne; }
      var j;
      try { j = await r.json(); } catch (e) { var pe = new Error('Respuesta inválida del servidor'); pe.code = 'NETWORK'; throw pe; }
      if (!j.ok) {
        var err = new Error(j.error || 'Error del servidor');
        err.code = j.code || 'ERROR';
        if (err.code === 'AUTH') { token = null; try { storage.removeItem(TKEY); } catch (e) {} }
        throw err;
      }
      return j.data;
    }

    return {
      async login(userId, pin) {
        var d = await post({ action: 'login', userId: userId, pin: pin });
        token = d.token;
        try { storage.setItem(TKEY, token); } catch (e) {}
        return d.user; // { id, name, role }
      },
      logout: function () { token = null; try { storage.removeItem(TKEY); } catch (e) {} },
      hasToken: function () { return !!token; },
      setPin: function (userId, pin) { return post({ action: 'set_pin', userId: userId, pin: pin }); },
      // Interfaz que consume el store:
      transport: {
        all: function () { return post({ action: 'all' }); },
        send: function (op) { return post(op.op === 'upsert' ? { action: 'upsert', entity: op.entity, record: op.record } : { action: 'remove', entity: op.entity, id: op.id }); },
      },
    };
  }
  return { createApi: createApi };
});
