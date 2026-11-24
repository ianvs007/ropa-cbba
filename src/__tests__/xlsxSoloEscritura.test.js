import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guarda de seguridad: `xlsx` 0.18.5 tiene avisos conocidos (prototype pollution y ReDoS)
 * que solo se explotan AL LEER archivos de terceros. El POS únicamente ESCRIBE Excel
 * (exportación de stock). Si alguien agrega lectura de archivos, este test obliga a
 * revisar la mitigación documentada en AGENTS.md antes de aceptar el cambio.
 */
const RAIZ_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LECTURAS_PROHIBIDAS = [/XLSX\.read\s*\(/, /XLSX\.readFile\s*\(/, /\bread(File)?\s*\(\s*[^)]*type\s*:\s*['"](array|binary|buffer)/];

function archivosFuente(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const completa = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : archivosFuente(completa);
        return /\.(js|jsx)$/.test(e.name) ? [completa] : [];
    });
}

describe('xlsx: uso solo de escritura', () => {
    it('ningún archivo de src/ lee libros Excel', () => {
        const infractores = archivosFuente(RAIZ_SRC).filter(f => {
            const texto = fs.readFileSync(f, 'utf-8');
            return texto.includes('xlsx') && LECTURAS_PROHIBIDAS.some(re => re.test(texto));
        });
        expect(infractores).toEqual([]);
    });

    it('el único consumidor de xlsx escribe el archivo con writeFile', () => {
        const consumidores = archivosFuente(RAIZ_SRC).filter(f =>
            /import\(\s*['"]xlsx['"]\s*\)|from\s+['"]xlsx['"]/.test(fs.readFileSync(f, 'utf-8'))
        );
        expect(consumidores.map(f => path.basename(f))).toEqual(['Sync.jsx']);
    });
});
