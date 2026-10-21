-- CRM Eurofloors — D1 Schema
-- Ejecutar: wrangler d1 execute crm-eurofloors --file=schema.sql

CREATE TABLE IF NOT EXISTS prospectos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL DEFAULT '',
  tel TEXT DEFAULT '',
  red TEXT DEFAULT '',
  medio TEXT DEFAULT '',
  vendedor TEXT DEFAULT '',
  producto TEXT DEFAULT '',
  monto REAL DEFAULT 0,
  followup TEXT DEFAULT '',
  stage TEXT DEFAULT 'lead',
  obs TEXT DEFAULT '',
  fecha TEXT DEFAULT '',
  razon TEXT DEFAULT '',
  proyecto TEXT DEFAULT '',
  m2 REAL DEFAULT 0,
  finicio TEXT DEFAULT '',
  moneda TEXT DEFAULT 'MXN',
  tcLead REAL DEFAULT 1,
  fechaPerdido TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY,
  fecha TEXT DEFAULT '',
  cliente TEXT DEFAULT '',
  vendedor TEXT DEFAULT '',
  producto TEXT DEFAULT '',
  lista TEXT DEFAULT 'l1',
  moneda TEXT DEFAULT 'MXN',
  tc REAL DEFAULT 1,
  total REAL DEFAULT 0,
  totalMxn REAL DEFAULT 0,
  cobrado REAL DEFAULT 0,
  cobradoMxn REAL DEFAULT 0,
  pedido TEXT DEFAULT '',
  metodo TEXT DEFAULT '',
  notas TEXT DEFAULT '',
  comision REAL DEFAULT 0,
  razon TEXT DEFAULT '',
  ref TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ventaId INTEGER,
  fecha TEXT DEFAULT '',
  monto REAL DEFAULT 0,
  montoMxn REAL DEFAULT 0,
  moneda TEXT DEFAULT 'MXN',
  tc REAL DEFAULT 1,
  metodo TEXT DEFAULT '',
  notas TEXT DEFAULT '',
  comision REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL DEFAULT 3,
  price REAL DEFAULT 0,
  p_l1 REAL DEFAULT 0,
  p_l2 REAL DEFAULT 0,
  p_l3 REAL DEFAULT 0,
  unit TEXT DEFAULT 'm²'
);

CREATE TABLE IF NOT EXISTS vendedores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  cuota REAL DEFAULT 150000,
  bono REAL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS actividad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT DEFAULT '',
  texto TEXT DEFAULT '',
  color TEXT DEFAULT '#3b82f6'
);

CREATE TABLE IF NOT EXISTS pines (
  id TEXT PRIMARY KEY,
  pin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_cargas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT DEFAULT '',
  usuario TEXT DEFAULT '',
  registros INTEGER DEFAULT 0,
  monto REAL DEFAULT 0,
  estado TEXT DEFAULT ''
);

-- PINs por defecto (cámbialos en ⚙️ Config)
INSERT OR IGNORE INTO pines (id, pin) VALUES ('gerente', '0000');
INSERT OR IGNORE INTO pines (id, pin) VALUES ('v1', '1111');
INSERT OR IGNORE INTO pines (id, pin) VALUES ('v2', '2222');
INSERT OR IGNORE INTO pines (id, pin) VALUES ('v3', '3333');
