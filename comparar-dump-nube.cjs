// Comparador dump del POS (pos-productos.json) vs catálogo de la nube
// (nube-productos.json). Diagnóstico del 04/09/2026: etiquetas físicas vs web.
// Uso: node comparar-dump-nube.cjs
const fs = require('fs');
const path = require('path');

const base = __dirname;

function leerJSON(nombre) {
    const texto = fs.readFileSync(path.join(base, nombre), 'utf8');
    const inicio = texto.indexOf('[');
    if (inicio < 0) throw new Error(`${nombre}: no se encontró el arreglo JSON`);
    return JSON.parse(texto.slice(inicio));
}

const dump = JSON.parse(fs.readFileSync(path.join(base, 'pos-productos.json'), 'utf8'));
const nube = leerJSON('nube-productos.json')[0].results;

const productos = dump.productos || [];
const unidades = dump.unidades || [];
const porShortCode = new Map(productos.filter((p) => p.shortCode).map((p) => [p.shortCode, p]));
const unidadPorShortCode = new Map();
for (const u of unidades) if (u.shortCode) unidadPorShortCode.set(u.shortCode, u);
const productoPorId = new Map(productos.map((p) => [p.id, p]));
const normaliza = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

console.log('=== RESUMEN DEL DUMP (generado_en: ' + dump.generado_en + ') ===');
console.log(`productos: ${productos.length} (activos: ${productos.filter((p) => p.active).length}, con globalId: ${productos.filter((p) => p.globalId).length})`);
console.log(`unidades: ${unidades.length} (con shortCode: ${unidades.filter((u) => u.shortCode).length}, usadas/vendidas: ${unidades.filter((u) => u.used).length})`);
console.log(`nube: ${nube.length} productos`);

console.log('\n=== LOS 5 CÓDIGOS DE LAS ETIQUETAS (Alain) ===');
for (const c of ['03303', '01952', '02797', '02969', '02418']) {
    const p = porShortCode.get(c);
    const u = unidadPorShortCode.get(c);
    const dueno = u ? productoPorId.get(u.productId) : null;
    const parteProducto = p ? `producto directo: "${p.name}" (id ${p.id}${p.active ? '' : ', INACTIVO'})` : 'no es shortCode de ningún producto';
    const parteUnidad = u
        ? `unidad/etiqueta de: "${dueno ? dueno.name + '" (shortCode de producto ' + dueno.shortCode + ')' : 'producto id ' + u.productId + ' (no está en el dump)"'}${u.used ? ' [VENDIDA]' : ''}`
        : 'tampoco es código de unidad';
    console.log(`- ${c} → ${parteProducto} | ${parteUnidad}`);
}

console.log('\n=== NUBE vs DUMP (emparejados por codigo = shortCode) ===');
let coinciden = 0;
const difieren = [];
const faltaEnPos = [];
for (const n of nube) {
    const p = porShortCode.get(n.codigo);
    if (!p) {
        faltaEnPos.push(`${n.codigo} "${n.nombre}"`);
        continue;
    }
    if (normaliza(p.name) === normaliza(n.nombre)) coinciden++;
    else difieren.push(`${n.codigo}: nube "${n.nombre}" vs POS "${p.name}"`);
}
const codigosNube = new Set(nube.map((n) => n.codigo));
const activosSinNube = productos.filter((p) => p.active && p.shortCode && !codigosNube.has(p.shortCode));

console.log(`coinciden nombre: ${coinciden}`);
console.log(`nombre distinto: ${difieren.length}`);
difieren.slice(0, 40).forEach((d) => console.log('  ' + d));
console.log(`códigos de la nube que NO existen en el POS: ${faltaEnPos.length}`);
faltaEnPos.slice(0, 40).forEach((d) => console.log('  ' + d));
console.log(`productos ACTIVOS del POS sin su código en la nube: ${activosSinNube.length}`);
activosSinNube.slice(0, 40).forEach((p) => console.log(`  ${p.shortCode} "${p.name}"`));

console.log('\n=== AMBIGÜEDAD DE CÓDIGOS (mismo número en ambos sistemas) ===');
let solape = 0;
const ejemplosSolape = [];
for (const c of unidadPorShortCode.keys()) {
    if (porShortCode.has(c)) {
        solape++;
        if (ejemplosSolape.length < 10) {
            const p = porShortCode.get(c);
            const u = unidadPorShortCode.get(c);
            const dueno = productoPorId.get(u.productId);
            ejemplosSolape.push(`${c}: producto "${p.name}" vs etiqueta de "${dueno ? dueno.name : '?'}"`);
        }
    }
}
console.log(`números que son shortCode de producto Y de unidad a la vez: ${solape}`);
ejemplosSolape.forEach((e) => console.log('  ' + e));

console.log('\n=== GLOBALID ===');
const globalIdsNube = new Set(nube.map((n) => n.global_id));
const compartidos = productos.filter((p) => p.globalId && globalIdsNube.has(p.globalId)).length;
console.log(`globalIds del POS que ya existen en la nube: ${compartidos} (0 = la nube nunca recibió un globalId del POS)`);
