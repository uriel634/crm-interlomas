const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../v2/logic/finance.js');

test('comisión = (cobrado ÷ 1.16) × % de la lista', () => {
  assert.equal(F.calcComision(11600, 'l1'), 500);   // 10,000 × 5 %
  assert.equal(F.calcComision(11600, 'l2'), 400);
  assert.equal(F.calcComision(11600, 'l3'), 300);
  assert.equal(F.calcComision(0, 'l1'), 0);
});
test('lista desconocida cae en L1; tasas personalizadas se respetan', () => {
  assert.equal(F.calcComision(11600, 'xx'), 500);
  assert.equal(F.calcComision(11600, 'l2', { l1: 5, l2: 10, l3: 3 }), 1000);
  assert.equal(F.calcComision(11600, 'l2', { l1: 5, l2: 0, l3: 3 }), 0); // una tasa de 0 es válida
});
test('USD se convierte con el tipo de cambio y se redondea', () => {
  assert.equal(F.toMXN(100, 'USD', 17.5), 1750);
  assert.equal(F.toMXN(100, 'MXN', 17.5), 100);
  assert.equal(F.toMXN(10.4, 'MXN'), 10);
  assert.equal(F.toMXN('x', 'MXN'), 0);
});
test('el cobrado y el saldo se derivan de los pagos', () => {
  const venta = { id: 'a', total: 10000, moneda: 'MXN', lista: 'l2' };
  const pagos = [
    F.buildPago({ id: 'p1', monto: 5000, fecha: '2026-01-01' }, venta),
    F.buildPago({ id: 'p2', monto: 2000, fecha: '2026-01-02' }, venta),
    { ventaId: 'otra', montoMxn: 999 },
  ];
  assert.equal(F.cobradoMxn(venta, pagos), 7000);
  assert.equal(F.saldoMxn(venta, pagos), 3000);
  assert.equal(pagos[0].comision, F.calcComision(5000, 'l2'));
});
test('bono solo con 100 % de la cuota', () => {
  assert.equal(F.bono(1000, 0.99, 20), 0);
  assert.equal(F.bono(1000, 1, 20), 200);
  assert.equal(F.cumplimiento(75000, 150000), 0.5);
  assert.equal(F.cumplimiento(1, 0), 0);
});
test('resumen de vendedor: cobros de otro mes no cuentan, ventas ajenas tampoco', () => {
  const vend = { name: 'Ana', cuota: 10000, bono: 10 };
  const ventas = [
    { id: 'a', vendedor: 'Ana', fecha: '2026-03-10', total: 12000, moneda: 'MXN', lista: 'l1' },
    { id: 'b', vendedor: 'Luis', fecha: '2026-03-11', total: 99999, moneda: 'MXN', lista: 'l1' },
  ];
  const pagos = [
    { ventaId: 'a', fecha: '2026-03-12', montoMxn: 11600, comision: 500 },
    { ventaId: 'a', fecha: '2026-04-02', montoMxn: 1000, comision: 43 },
    { ventaId: 'b', fecha: '2026-03-12', montoMxn: 5000, comision: 200 },
  ];
  const marzo = F.resumenVendedor(vend, ventas, pagos, { mes: 3 });
  assert.deepEqual([marzo.ventas, marzo.vendido, marzo.cobrado, marzo.comision], [1, 12000, 11600, 500]);
  assert.equal(marzo.cumplimiento, 1.2);
  assert.equal(marzo.bono, 50);
  assert.equal(F.resumenVendedor(vend, ventas, pagos, { mes: 'all' }).comision, 543);
});
