/**
 * Herramienta de línea de comandos para convertir cualquier archivo de backup `.json`
 * (incluso de 300+ MB con fotos en Base64) directamente a:
 *   - `datos-pos/pos.sqlite` (tablas relacionales SQLite WAL + vectores separados)
 *   - `datos-pos/imagenes/`  (archivos físicos .jpg / .png deduplicados)
 *
 * Uso en CMD (con el servicio detenido):
 *   node --max-old-space-size=4096 migrar-json-a-sqlite.mjs "C:\ruta\a\tu_backup.json"
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SqlitePosStore } from './src/server/sqliteStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputArg = process.argv[2];
const dataDirArg = process.argv[3] || path.join(__dirname, 'datos-pos');

if (!inputArg) {
    console.error('Uso:');
    console.error('  node --max-old-space-size=4096 migrar-json-a-sqlite.mjs "C:\\ruta\\a\\tu_backup.json"');
    process.exit(1);
}

const fullInputPath = path.resolve(inputArg);
if (!fs.existsSync(fullInputPath)) {
    console.error(`Error: No existe el archivo "${fullInputPath}"`);
    process.exit(1);
}

const sizeMb = (fs.statSync(fullInputPath).size / (1024 * 1024)).toFixed(1);
console.log(`1/3 Leyendo backup JSON (${sizeMb} MB): ${fullInputPath}`);
const rawJson = fs.readFileSync(fullInputPath, 'utf-8');

console.log(`2/3 Importando en SQLite y extrayendo fotos físicas en: ${dataDirArg}`);
const store = new SqlitePosStore({ dataDir: dataDirArg });
try {
    const res = store.importBackupJsonString(rawJson);
    const st = store.getStatus();
    const sqliteMb = fs.existsSync(st.dbPath)
        ? (fs.statSync(st.dbPath).size / (1024 * 1024)).toFixed(2)
        : '0';

    console.log('3/3 ¡Conversión a SQLite completada con éxito!');
    console.log(`    • Archivo SQLite : ${st.dbPath} (${sqliteMb} MB)`);
    console.log(`    • Carpeta fotos  : ${st.imagesDir} (${st.imagesCount} imágenes físicas)`);
    console.log(`    • Prendas        : ${st.stats.products}`);
    console.log(`    • Unidades       : ${st.stats.barcodes}`);
    console.log(`    • Ventas         : ${st.stats.sales}`);
    console.log(`    • Revisión       : ${res.revision}`);
} finally {
    store.close();
}
