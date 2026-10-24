// Reglas de dinero del CRM. Única fuente de verdad en el navegador (el backend tiene una copia idéntica, ver tests/unit/parity.test.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Finance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var IVA = 1.16;
  var DEFAULT_RATES = { l1: 5, l2: 4, l3: 3 };

  function toMXN(monto, moneda, tc) {
    var m = Number(monto) || 0;
    return moneda === 'USD' ? Math.round(m * (Number(tc) || 1)) : Math.round(m);
  }

  function rateFor(lista, rates) {
    var r = rates || DEFAULT_RATES;
    var v = r[lista];
    return v === undefined || v === null || isNaN(v) ? r.l1 : Number(v);
  }

  // Comisión = (cobrado MXN ÷ 1.16) × % de la lista. Solo sobre lo cobrado, antes de IVA.
  function calcComision(cobradoMxn, lista, rates) {
    return Math.round(((Number(cobradoMxn) || 0) / IVA) * (rateFor(lista, rates) / 100));
  }

  function totalMxn(venta) {
    return toMXN(venta.total, venta.moneda, venta.tc);
  }

  // Construye un pago con sus importes en MXN y su comisión ya calculados.
  function buildPago(input, venta, rates) {
    var montoMxn = toMXN(input.monto, input.moneda, input.tc);
    return {
      id: input.id,
      ventaId: venta.id,
      fecha: input.fecha,
      monto: Number(input.monto) || 0,
      moneda: input.moneda || 'MXN',
      tc: Number(input.tc) || 1,
      montoMxn: montoMxn,
      metodo: input.metodo || 'Transferencia',
      referencia: input.referencia || '',
      comision: calcComision(montoMxn, venta.lista || 'l1', rates),
    };
  }

  function sum(list, f) {
    return list.reduce(function (s, x) { return s + (f(x) || 0); }, 0);
  }

  // El cobrado de una venta SIEMPRE se deriva de sus pagos.
  function cobradoMxn(venta, pagos) {
    return sum(pagos.filter(function (p) { return p.ventaId === venta.id; }), function (p) { return p.montoMxn; });
  }

  function saldoMxn(venta, pagos) {
    return totalMxn(venta) - cobradoMxn(venta, pagos);
  }

  function cumplimiento(vendidoMxn, cuota) {
    return cuota ? vendidoMxn / cuota : 0;
  }

  // Bono: solo si se alcanzó el 100 % de la cuota; es % de la comisión.
  function bono(comision, cumpl, bonoPct) {
    return cumpl >= 1 ? comision * (bonoPct / 100) : 0;
  }

  function enMes(fecha, mes) {
    if (mes === undefined || mes === null || mes === 'all') return true;
    return new Date(fecha).getUTCMonth() + 1 === Number(mes);
  }

  // Resumen de un vendedor para un mes (o 'all').
  function resumenVendedor(vendedor, ventas, pagos, opts) {
    opts = opts || {};
    var vs = ventas.filter(function (v) { return v.vendedor === vendedor.name && enMes(v.fecha, opts.mes); });
    var ids = {};
    vs.forEach(function (v) { ids[v.id] = true; });
    var ps = pagos.filter(function (p) { return ids[p.ventaId] && enMes(p.fecha, opts.mes); });
    var vendido = sum(vs, totalMxn);
    var cobrado = sum(ps, function (p) { return p.montoMxn; });
    var comision = sum(ps, function (p) { return p.comision; });
    var cumpl = cumplimiento(vendido, vendedor.cuota);
    return {
      ventas: vs.length, vendido: vendido, cobrado: cobrado, comision: comision,
      cumplimiento: cumpl, bono: bono(comision, cumpl, vendedor.bono),
    };
  }

  return {
    IVA: IVA, DEFAULT_RATES: DEFAULT_RATES, toMXN: toMXN, calcComision: calcComision,
    totalMxn: totalMxn, buildPago: buildPago, cobradoMxn: cobradoMxn, saldoMxn: saldoMxn,
    cumplimiento: cumplimiento, bono: bono, resumenVendedor: resumenVendedor,
  };
});
