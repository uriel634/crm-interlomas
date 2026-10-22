// Cloudflare Pages Function — CRM Eurofloors API
// Handles GET /api and POST /api, connected to D1 (binding: DB)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const action = new URL(request.url).searchParams.get('action');
  try {
    const data = await handleGet(action, env.DB);
    return Response.json({ ok: true, data }, { headers: CORS });
  } catch (e) {
    return Response.json({ ok: false, data: { error: e.message } }, { status: 500, headers: CORS });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const { action, data } = await request.json();
    const result = await handlePost(action, data, env.DB);
    return Response.json({ ok: true, data: result }, { headers: CORS });
  } catch (e) {
    return Response.json({ ok: false, data: { error: e.message } }, { status: 500, headers: CORS });
  }
}

// ── GET handlers ──────────────────────────────────────────

async function handleGet(action, DB) {
  if (action === 'init') {
    await initDB(DB);
    return {};
  }

  if (action === 'all') {
    const [productos, vendedores, prospectos, ventas, actividad, pines] = await Promise.all([
      DB.prepare('SELECT * FROM productos').all(),
      DB.prepare('SELECT * FROM vendedores').all(),
      DB.prepare('SELECT * FROM prospectos ORDER BY id').all(),
      DB.prepare('SELECT * FROM ventas ORDER BY id').all(),
      DB.prepare('SELECT * FROM actividad ORDER BY id DESC LIMIT 50').all(),
      DB.prepare('SELECT * FROM pines').all(),
    ]);
    return {
      productos:  productos.results,
      vendedores: vendedores.results,
      prospectos: prospectos.results,
      ventas:     ventas.results,
      actividad:  actividad.results,
      pines:      pines.results,
    };
  }

  throw new Error('Acción desconocida: ' + action);
}

// ── POST handlers ─────────────────────────────────────────

async function handlePost(action, data, DB) {
  switch (action) {

    case 'save_lead':
      await DB.prepare(`
        INSERT OR REPLACE INTO prospectos
          (id, nombre, tel, red, medio, vendedor, producto, monto, followup,
           stage, obs, fecha, razon, proyecto, m2, finicio, moneda, tcLead, fechaPerdido)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          data.id, s(data.nombre), s(data.tel), s(data.red), s(data.medio),
          s(data.vendedor), s(data.producto), n(data.monto), s(data.followup),
          s(data.stage, 'lead'), s(data.obs), s(data.fecha),
          s(data.razon), s(data.proyecto), n(data.m2), s(data.finicio),
          s(data.moneda, 'MXN'), n(data.tcLead, 1), s(data.fechaPerdido)
        ).run();
      return {};

    case 'save_venta':
      await DB.prepare(`
        INSERT OR REPLACE INTO ventas
          (id, fecha, cliente, vendedor, producto, lista, moneda, tc,
           total, totalMxn, cobrado, cobradoMxn, pedido, metodo, notas, comision, razon, ref)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          data.id, s(data.fecha), s(data.cliente), s(data.vendedor),
          s(data.producto), s(data.lista, 'l1'), s(data.moneda, 'MXN'), n(data.tc, 1),
          n(data.total), n(data.totalMxn ?? data.total), n(data.cobrado),
          n(data.cobradoMxn ?? data.cobrado), s(data.pedido), s(data.metodo),
          s(data.notas), n(data.comision), s(data.razon), s(data.ref)
        ).run();
      return {};

    case 'delete_lead':
      await DB.prepare('DELETE FROM prospectos WHERE id = ?').bind(data.id).run();
      return {};

    case 'save_productos': {
      const stmts = [DB.prepare('DELETE FROM productos')];
      for (const p of data) {
        stmts.push(DB.prepare(`INSERT INTO productos (id, name, rate, price, p_l1, p_l2, p_l3, unit) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(p.id, s(p.name), n(p.rate, 3), n(p.price), n(p.p_l1), n(p.p_l2), n(p.p_l3), s(p.unit, 'm²')));
      }
      await DB.batch(stmts);
      return {};
    }

    case 'save_vendedores': {
      const stmts = [DB.prepare('DELETE FROM vendedores')];
      for (const v of data) {
        stmts.push(DB.prepare(`INSERT INTO vendedores (id, name, color, cuota, bono) VALUES (?,?,?,?,?)`)
          .bind(s(v.id), s(v.name), s(v.color, '#3b82f6'), n(v.cuota, 150000), n(v.bono, 20)));
      }
      await DB.batch(stmts);
      return {};
    }

    case 'log_activity':
      await DB.prepare('INSERT INTO actividad (fecha, texto, color) VALUES (?,?,?)')
        .bind(s(data.fecha), s(data.texto), s(data.color, '#3b82f6')).run();
      return {};

    case 'save_pins': {
      const stmts = Object.entries(data.pins || {}).map(([id, pin]) =>
        DB.prepare('INSERT OR REPLACE INTO pines (id, pin) VALUES (?,?)').bind(id, pin));
      if (stmts.length) await DB.batch(stmts);
      return {};
    }

    case 'validate_pin': {
      const row = await DB.prepare('SELECT pin FROM pines WHERE id = ?').bind(data.userId).first();
      return { valid: row ? row.pin === data.pin : false };
    }

    case 'full_backup': {
      const { prospectos, ventas: vs, productos, vendedores } = data;
      const stmts = [];

      // Use !== undefined so DELETE runs even when the array is empty (clear operation)
      if (productos !== undefined) {
        stmts.push(DB.prepare('DELETE FROM productos'));
        for (const p of productos)
          stmts.push(DB.prepare(`INSERT INTO productos (id, name, rate, price, p_l1, p_l2, p_l3, unit) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(p.id, s(p.name), n(p.rate,3), n(p.price), n(p.p_l1), n(p.p_l2), n(p.p_l3), s(p.unit,'m²')));
      }
      if (vendedores !== undefined) {
        stmts.push(DB.prepare('DELETE FROM vendedores'));
        for (const v of vendedores)
          stmts.push(DB.prepare(`INSERT INTO vendedores (id, name, color, cuota, bono) VALUES (?,?,?,?,?)`)
            .bind(s(v.id), s(v.name), s(v.color,'#3b82f6'), n(v.cuota,150000), n(v.bono,20)));
      }
      if (prospectos !== undefined) {
        stmts.push(DB.prepare('DELETE FROM prospectos'));
        for (const l of prospectos)
          stmts.push(DB.prepare(`INSERT INTO prospectos (id,nombre,tel,red,medio,vendedor,producto,monto,followup,stage,obs,fecha,razon,proyecto,m2,finicio,moneda,tcLead,fechaPerdido) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(l.id,s(l.nombre),s(l.tel),s(l.red),s(l.medio),s(l.vendedor),s(l.producto),n(l.monto),s(l.followup),s(l.stage,'lead'),s(l.obs),s(l.fecha),s(l.razon),s(l.proyecto),n(l.m2),s(l.finicio),s(l.moneda,'MXN'),n(l.tcLead,1),s(l.fechaPerdido)));
      }
      if (vs !== undefined) {
        stmts.push(DB.prepare('DELETE FROM ventas'));
        stmts.push(DB.prepare('DELETE FROM pagos'));
        for (const v of vs)
          stmts.push(DB.prepare(`INSERT INTO ventas (id,fecha,cliente,vendedor,producto,lista,moneda,tc,total,totalMxn,cobrado,cobradoMxn,pedido,metodo,notas,comision,razon,ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(v.id,s(v.fecha),s(v.cliente),s(v.vendedor),s(v.producto),s(v.lista,'l1'),s(v.moneda,'MXN'),n(v.tc,1),n(v.total),n(v.totalMxn??v.total),n(v.cobrado),n(v.cobradoMxn??v.cobrado),s(v.pedido),s(v.metodo),s(v.notas),n(v.comision),s(v.razon),s(v.ref)));
      }

      if (stmts.length) await DB.batch(stmts);
      return {};
    }

    default:
      throw new Error('Acción desconocida: ' + action);
  }
}

// ── DB init ───────────────────────────────────────────────

async function initDB(DB) {
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS prospectos (
      id INTEGER PRIMARY KEY, nombre TEXT, tel TEXT, red TEXT, medio TEXT,
      vendedor TEXT, producto TEXT, monto REAL DEFAULT 0, followup TEXT,
      stage TEXT DEFAULT 'lead', obs TEXT, fecha TEXT,
      razon TEXT, proyecto TEXT, m2 REAL DEFAULT 0, finicio TEXT,
      moneda TEXT DEFAULT 'MXN', tcLead REAL DEFAULT 1, fechaPerdido TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY, fecha TEXT, cliente TEXT, vendedor TEXT,
      producto TEXT, lista TEXT DEFAULT 'l1', moneda TEXT DEFAULT 'MXN',
      tc REAL DEFAULT 1, total REAL DEFAULT 0, totalMxn REAL DEFAULT 0,
      cobrado REAL DEFAULT 0, cobradoMxn REAL DEFAULT 0, pedido TEXT,
      metodo TEXT, notas TEXT, comision REAL DEFAULT 0, razon TEXT, ref TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ventaId INTEGER, fecha TEXT,
      monto REAL DEFAULT 0, montoMxn REAL DEFAULT 0, moneda TEXT DEFAULT 'MXN',
      tc REAL DEFAULT 1, metodo TEXT, notas TEXT, comision REAL DEFAULT 0)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY, name TEXT, rate REAL DEFAULT 3,
      price REAL DEFAULT 0, p_l1 REAL DEFAULT 0, p_l2 REAL DEFAULT 0,
      p_l3 REAL DEFAULT 0, unit TEXT DEFAULT 'm²')`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS vendedores (
      id TEXT PRIMARY KEY, name TEXT, color TEXT DEFAULT '#3b82f6',
      cuota REAL DEFAULT 150000, bono REAL DEFAULT 20)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS actividad (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, texto TEXT,
      color TEXT DEFAULT '#3b82f6')`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS pines (id TEXT PRIMARY KEY, pin TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS log_cargas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, usuario TEXT,
      registros INTEGER DEFAULT 0, monto REAL DEFAULT 0, estado TEXT)`),
    // PINs por defecto (solo si no existen)
    DB.prepare(`INSERT OR IGNORE INTO pines (id, pin) VALUES ('gerente','0000')`),
    DB.prepare(`INSERT OR IGNORE INTO pines (id, pin) VALUES ('v1','1111')`),
    DB.prepare(`INSERT OR IGNORE INTO pines (id, pin) VALUES ('v2','2222')`),
    DB.prepare(`INSERT OR IGNORE INTO pines (id, pin) VALUES ('v3','3333')`),
  ]);
}

// ── Helpers ───────────────────────────────────────────────
const s = (v, def = '') => (v != null && v !== undefined) ? String(v) : def;
const n = (v, def = 0) => isFinite(parseFloat(v)) ? parseFloat(v) : def;
