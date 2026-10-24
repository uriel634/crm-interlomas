const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../v2/logic/finance.js');
const { loadBackend } = require('./helpers');

// Cliente y servidor calculan el dinero con código duplicado: si divergen, esta prueba falla.
test('finance.js y Code.gs dan exactamente lo mismo', () => {
  const be = loadBackend();
  const listas = ['l1', 'l2', 'l3', 'zz'];
  const rates = [undefined, { l1: 5, l2: 4, l3: 3 }, { l1: 6.5, l2: 0, l3: 2.25 }];
  let n = 0;
  for (let i = 0; i < 2000; i++) {
    const monto = Math.round(Math.random() * 500000 * 100) / 100;
    const tc = Math.round(Math.random() * 25 * 100) / 100;
    const lista = listas[i % 4], r = rates[i % 3], mon = i % 2 ? 'USD' : 'MXN';
    assert.equal(be.toMXN(monto, mon, tc), F.toMXN(monto, mon, tc));
    assert.equal(be.calcComision(monto, lista, r), F.calcComision(monto, lista, r));
    n++;
  }
  assert.equal(n, 2000);
});
