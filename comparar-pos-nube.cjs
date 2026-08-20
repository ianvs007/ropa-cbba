#!/usr/bin/env node
/**
 * comparar-pos-nube.cjs — Comparador POS ↔ tienda virtual (SOLO LECTURA).
 *
 * Detecta por qué algunas prendas "no se guardan" en la tienda virtual:
 * cruces de nombre (el shortCode existe en la nube pero con otro nombre),
 * prendas que solo existen en un lado, y variantes talla/color que no cruzan.
 *
 * Uso:
 *   node comparar-pos-nube.cjs [pos-productos.json] [--salida=reporte.txt]
 *
 * Entradas:
 *   1) El JSON que genera public/volcar-pos.html (abrir en el navegador del POS
 *      en http://localhost:3001/volcar-pos.html y pulsar "Descargar").
 *   2) La base D1 de producción de la tienda virtual (se consulta por wrangler,
 *      read-only). Requiere auth de wrangler ya configurada.
 *
 * Opciones:
 *   --salida=archivo   guarda el reporte completo en un archivo (además de consola)
 *   TIENDA_VIRTUAL_DIR variable de entorno: carpeta del proyecto tienda-virtual
 *      (necesaria para que wrangler resuelva el D1). Por defecto:
 *      D:/software/MisProyectos/tienda virtual - compra de ropa
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ────────────────────────── utilidades de normalización ──────────────────────────

/** Igual que functions/lib/codigo.js de la nube: rellena a 5 dígitos si es numérico. */
function normalizarCodigo(valor) {
  const c = String(valor ?? '').trim();
  return /^\d+$/.test(c) ? c.padStart(5, '0') : c;
}

/** Igual que nubeDifiere() de functions/lib/sincronizar.js de la nube. */
function nubeDifiere(a, b) {
  return Boolean(a && b) && a.trim().toUpperCase().replace(/\s+/g, ' ') !== b.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Normalización tolerante (quita tildes) para distinguir "falso cruce por tilde". */
function normalizarNombreTolerante(v) {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function upper(v) {
  return String(v ?? '').trim().toUpperCase();
}

// ─────────────────────────────── argumentos ───────────────────────────────

const args = process.argv.slice(2);
let posPath = 'pos-productos.json';
let salidaPath = null;
for (const a of args) {
  if (a.startsWith('--salida=')) salidaPath = a.slice('--salida='.length);
  else if (!a.startsWith('--')) posPath = a;
}

const TIENDA_VIRTUAL_DIR = process.env.TIENDA_VIRTUAL_DIR || 'D:/software/MisProyectos/tienda virtual - compra de ropa';

// ─────────────────────────────── leer POS ───────────────────────────────

if (!fs.existsSync(posPath)) {
  console.error(`No encontré el archivo del POS: ${posPath}`);
  console.error('Generalo abriendo http://localhost:3001/volcar-pos.html en el navegador del POS y pulsando "Descargar pos-productos.json".');
  process.exit(1);
}

const posData = JSON.parse(fs.readFileSync(posPath, 'utf8'));
const posProductos = Array.isArray(posData.productos) ? posData.productos : [];
console.log(`POS: ${posProductos.length} producto(s) leídos de ${posPath}`);

// ─────────────────────────────── leer nube (D1) ───────────────────────────────

const SQL = [
  "SELECT p.id, p.codigo, p.nombre, p.activo, v.talla, v.color, v.stock",
  "FROM products p LEFT JOIN product_variants v ON v.product_id = p.id",
  "WHERE p.codigo IS NOT NULL AND p.codigo != ''",
  "ORDER BY p.codigo, v.id;",
].join(' ');

// Ejecutamos wrangler directamente con node (sin shell) para que el SQL con
// espacios viaje como UN solo argumento, sin problemas de comillas en Windows.
const wranglerBin = path.join(TIENDA_VIRTUAL_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerArgs = ['d1', 'execute', 'tienda-virtual-db', '--remote', '--json', '--command', SQL];
let r;
if (fs.existsSync(wranglerBin)) {
  r = spawnSync(process.execPath, [wranglerBin, ...wranglerArgs], {
    cwd: TIENDA_VIRTUAL_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} else {
  r = spawnSync('npx.cmd', ['wrangler', ...wranglerArgs], {
    cwd: TIENDA_VIRTUAL_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
  });
}

if (r.status !== 0) {
  console.error('Fallo al consultar la nube con wrangler:');
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

let nubeRows;
try {
  const parsed = JSON.parse(r.stdout);
  nubeRows = (parsed[0] && parsed[0].results) || [];
} catch (e) {
  console.error('No pude interpretar la salida de wrangler. Salida recibida:');
  console.error(r.stdout);
  process.exit(1);
}

console.log(`Nube: ${nubeRows.length} fila(s) (producto + variante) obtenidas de D1`);

// ─────────────────────── construir mapas ───────────────────────

// POS: code -> array de productos (detecta duplicados)
const posPorCodigo = new Map();
for (const p of posProductos) {
  const code = normalizarCodigo(p.shortCode);
  if (!code) continue;
  if (!posPorCodigo.has(code)) posPorCodigo.set(code, []);
  posPorCodigo.get(code).push(p);
}

// Nube: code -> { nombre, activo, variantes: [{talla, color, stock}] }
const nubePorCodigo = new Map();
for (const row of nubeRows) {
  const code = normalizarCodigo(row.codigo);
  if (!code) continue;
  if (!nubePorCodigo.has(code)) {
    nubePorCodigo.set(code, { nombre: row.nombre ?? '', activo: row.activo === 1, variantes: [] });
  }
  if (row.talla !== null && row.talla !== undefined || row.color !== null && row.color !== undefined) {
    nubePorCodigo.get(code).variantes.push({ talla: row.talla ?? '', color: row.color ?? '', stock: row.stock ?? 0 });
  }
}

// ─────────────────────────────── comparar ───────────────────────────────

const todosCodigos = new Set([...posPorCodigo.keys(), ...nubePorCodigo.keys()]);

const reporte = {
  duplicadosPOS: [],     // el mismo shortCode en 2+ prendas del POS
  cruces: [],            // mismo código, nombre distinto (la nube NO guardará stock)
  crucesPorTilde: [],    // cruce que en realidad es solo una diferencia de tildes
  soloPOS: [],           // en POS, no en nube (se creará en la próxima sync)
  soloNube: [],          // en nube, no en POS (huérfana / archivada en POS)
  varianteNoCoincide: [],// código y nombre OK, pero talla/color no cruza
  coinciden: [],         // todo OK (puede diferir el stock)
};

for (const code of [...todosCodigos].sort()) {
  const enPOS = posPorCodigo.get(code);
  const enNube = nubePorCodigo.get(code);

  if (enPOS && enPOS.length > 1) {
    reporte.duplicadosPOS.push({ codigo: code, prendas: enPOS.map((p) => p.name) });
    continue; // duplicado local: la sync se bloquea hasta reparar
  }

  if (enPOS && !enNube) {
    reporte.soloPOS.push({ codigo: code, nombre: enPOS[0].name });
    continue;
  }
  if (!enPOS && enNube) {
    reporte.soloNube.push({ codigo: code, nombre: enNube.nombre, activo: enNube.activo });
    continue;
  }
  if (!enPOS || !enNube) continue;

  const pos = enPOS[0];
  const nombreNube = enNube.nombre;

  if (nubeDifiere(nombreNube, pos.name)) {
    if (normalizarNombreTolerante(nombreNube) === normalizarNombreTolerante(pos.name)) {
      reporte.crucesPorTilde.push({ codigo: code, nombreNube, nombrePOS: pos.name });
    } else {
      reporte.cruces.push({ codigo: code, nombreNube, nombrePOS: pos.name });
    }
    continue;
  }

  // Variante: ¿existe en la nube una variante con talla/color == size/color del POS?
  const size = upper(pos.size);
  const color = upper(pos.color);
  let variante = null;
  if (!size && !color && enNube.variantes.length === 1) {
    variante = enNube.variantes[0];
  } else {
    variante = enNube.variantes.find((v) => upper(v.talla) === size && upper(v.color) === color);
  }

  if (!variante) {
    reporte.varianteNoCoincide.push({
      codigo: code,
      nombre: pos.name,
      size,
      color,
      variantesNube: enNube.variantes.map((v) => `${v.talla}/${v.color}`),
    });
    continue;
  }

  reporte.coinciden.push({
    codigo: code,
    nombre: pos.name,
    stockPOS: Number(pos.stock) || 0,
    stockNube: Number(variante.stock) || 0,
  });
}

// ─────────────────────────────── imprimir ───────────────────────────────

const lineas = [];
const w = (s) => { lineas.push(s); console.log(s); };

// Límite de filas por lista en consola (el total siempre va en el resumen).
const CAP = 120;
function listar(items, fmt) {
  items.slice(0, CAP).forEach((it) => w(`  ${fmt(it)}`));
  if (items.length > CAP) w(`  … y ${items.length - CAP} más`);
}

function encabezado(titulo, items) {
  w('');
  w('═'.repeat(78));
  w(`${titulo}  (${items.length})`);
  w('═'.repeat(78));
}

w('');
w('REPORTE DE COMPARACIÓN POS ↔ TIENDA VIRTUAL');
w(`Generado: ${new Date().toLocaleString()}`);
w(`POS: ${posProductos.length} productos · Nube: ${nubePorCodigo.size} códigos únicos`);

encabezado('🔴 DUPLICADOS EN EL POS (bloquean la sync)', reporte.duplicadosPOS);
listar(reporte.duplicadosPOS, (d) => `${d.codigo}: ${d.prendas.join(' · ')}`);
if (reporte.duplicadosPOS.length === 0) w('  (ninguno)');

encabezado('🔴 CRUCES — mismo código, nombre distinto (la nube NO guardará el stock)', reporte.cruces);
listar(reporte.cruces, (c) => `${c.codigo}  POS="${c.nombrePOS}"  NUBE="${c.nombreNube}"`);
if (reporte.cruces.length === 0) w('  (ninguno)');

encabezado('🟠 CRUCES POR TILDE (probable falso cruce: misma prenda, tildes distintas)', reporte.crucesPorTilde);
listar(reporte.crucesPorTilde, (c) => `${c.codigo}  POS="${c.nombrePOS}"  NUBE="${c.nombreNube}"`);
if (reporte.crucesPorTilde.length === 0) w('  (ninguno)');

encabezado('🟡 SOLO EN EL POS (se crearán en la próxima sync)', reporte.soloPOS);
listar(reporte.soloPOS, (s) => `${s.codigo}  ${s.nombre}`);
if (reporte.soloPOS.length === 0) w('  (ninguno)');

encabezado('🟡 SOLO EN LA NUBE (huérfanas / archivadas en el POS)', reporte.soloNube);
listar(reporte.soloNube, (s) => `${s.codigo}  ${s.nombre}${s.activo ? '' : '  [inactiva en nube]'}`);
if (reporte.soloNube.length === 0) w('  (ninguno)');

encabezado('🟠 VARIANTE TALLA/COLOR NO COINCIDE (no se guarda)', reporte.varianteNoCoincide);
listar(reporte.varianteNoCoincide, (v) => `${v.codigo}  ${v.nombre}  POS=${v.size}/${v.color}  NUBE=${v.variantesNube.join(', ')}`);
if (reporte.varianteNoCoincide.length === 0) w('  (ninguno)');

encabezado('✅ COINCIDEN (nombre + talla/color)', reporte.coinciden);
const difStock = reporte.coinciden.filter((c) => c.stockPOS !== c.stockNube);
w(`  Total: ${reporte.coinciden.length} · con stock distinto al de la nube: ${difStock.length}`);
if (difStock.length > 0) {
  w('  (los que difieren se ajustarán en la próxima sync; muestra hasta 40):');
  listar(difStock.slice(0, 40), (c) => `${c.codigo}  ${c.nombre}  POS=${c.stockPOS}  NUBE=${c.stockNube}`);
}
if (reporte.coinciden.length === 0) w('  (ninguno)');

w('');
w('Resumen:');
w(`  Duplicados POS:        ${reporte.duplicadosPOS.length}`);
w(`  Cruces (nombre):       ${reporte.cruces.length}`);
w(`  Cruces por tilde:      ${reporte.crucesPorTilde.length}`);
w(`  Solo POS:              ${reporte.soloPOS.length}`);
w(`  Solo nube:             ${reporte.soloNube.length}`);
w(`  Variante no coincide:  ${reporte.varianteNoCoincide.length}`);
w(`  Coinciden:             ${reporte.coinciden.length}`);

if (salidaPath) {
  fs.writeFileSync(salidaPath, lineas.join('\n'), 'utf8');
  console.log(`\nReporte guardado en: ${salidaPath}`);
}
