// Prueba de humo del CRM: API de Google Sheets simulada; registra qué se envía realmente.
const { chromium } = require(process.env.PW_PATH || 'playwright');
const path = require('path');

const posts = [];
const store = { prospectos: [], ventas: [] };
let failPosts = false;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await page.route('https://script.google.com/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      if (failPosts) return route.abort();
      const b = JSON.parse(req.postData());
      posts.push(b);
      if (b.action === 'save_lead') store.prospectos = store.prospectos.filter(x => x.id != b.data.id).concat(b.data);
      if (b.action === 'save_venta') store.ventas = store.ventas.filter(x => x.id != b.data.id).concat(b.data);
      return route.fulfill({ json: { ok: true, data: {} } });
    }
    const action = new URL(req.url()).searchParams.get('action');
    const data = action === 'all' ? { productos: [], vendedores: [], prospectos: store.prospectos, ventas: store.ventas, actividad: [] } : {};
    route.fulfill({ json: { ok: true, data } });
  });

  const load = async () => { await page.goto('file://' + path.resolve(__dirname, '../index.html')); await page.waitForTimeout(800); };
  const res = [];
  const check = (name, ok, detail) => res.push({ name, ok, detail });

  await load();

  // 1. Prospecto
  await page.evaluate(() => {
    openM('m-lead');
    document.getElementById('l-nom').value = 'Cliente Prueba';
    document.getElementById('l-tel').value = '5551234567';
    saveLead();
  });
  await page.waitForTimeout(300);
  check('Prospecto: se envía save_lead', posts.some(p => p.action === 'save_lead' && p.data.nombre === 'Cliente Prueba'));

  // 2. Venta con lista L2 y USD
  await page.evaluate(() => {
    document.getElementById('v-cli').value = 'Venta Prueba';
    document.getElementById('v-tot').value = '10000';
    document.getElementById('v-cob').value = '5000';
    document.getElementById('v-lista').value = 'l2';
    saveVenta();
  });
  await page.waitForTimeout(300);
  const pv = posts.find(p => p.action === 'save_venta');
  check('Venta: se envía save_venta', !!pv);
  check('Venta: se envía la lista de precios (l2)', pv && pv.data.lista === 'l2', pv && JSON.stringify(pv.data));
  check('Venta: se envía la comisión calculada', pv && pv.data.comision > 0, 'comision=' + (pv && pv.data.comision));

  // 3. Cobro posterior
  const before = posts.length;
  await page.evaluate(() => {
    const id = ventas[ventas.length - 1].id;
    openCobro(id);
    document.getElementById('cb-mnt').value = '2000';
    saveCobro();
  });
  await page.waitForTimeout(300);
  check('Cobro: se persiste en Sheets', posts.length > before, 'POSTs nuevos: ' + (posts.length - before));

  // 4. Recargar: ¿sobrevive lo guardado?
  await load();
  const after = await page.evaluate(() => ({ n: leads.length, v: ventas.map(x => ({ cob: x.cobrado, lista: x.lista, com: x.comision, pagos: pagos.reduce((s, p) => s + (p.montoMxn || 0), 0) })) }));
  check('Recarga: el prospecto sigue', after.n === 1);
  check('Recarga: cobro (5000+2000) conservado', after.v[0] && after.v[0].pagos === 7000, JSON.stringify(after.v[0]));
  check('Recarga: lista l2 conservada', after.v[0] && after.v[0].lista === 'l2', JSON.stringify(after.v[0]));

  // 5. Sin conexión: ¿avisa o dice "guardado"?
  failPosts = true;
  await page.evaluate(() => {
    openM('m-lead');
    document.getElementById('l-nom').value = 'Offline';
    document.getElementById('l-tel').value = '1';
    saveLead();
  });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => document.getElementById('ls-status').textContent);
  check('Sin conexión: NO muestra "Guardado"', !/Guardado en Google Sheets/.test(st), 'estado: ' + st);

  check('Sin errores JS en consola', errors.length === 0, errors.join(' | '));

  for (const r of res) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '   -> ' + r.detail));
  await browser.close();
  process.exit(res.every(r => r.ok) ? 0 : 1);
})();
