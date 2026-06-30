/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔁 TESTS DE REGISTRO CONTINUO ("GUARDAR Y NUEVO") — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * El entorno de tests es Node (sin IndexedDB ni React DOM), por lo que — igual que
 * orphanData.test.js / transfer.test.js — modelamos la lógica como funciones PURAS,
 * replicando exactamente el comportamiento implementado en ProductForm.jsx:
 *
 *   allocateShortCodes()  ↔ ProductForm.buildCodes() (parte de códigos cortos)
 *   El set "usedNums"      ↔ existingRef.current.nums (snapshot cargado al montar)
 *   El refresco tras guardar ↔ el bloque keepOpen de handleSave, que añade los
 *                              códigos recién usados a existingRef antes de limpiar.
 *
 * Verifican el invariante crítico del registro continuo: al pulsar "GUARDAR Y NUEVO",
 * el SIGUIENTE producto no debe regenerar los shortCodes ya usados por el anterior,
 * porque existingRef se actualiza con lo recién guardado.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// MODELO PURO de la asignación de códigos cortos de buildCodes() (ProductForm.jsx).
// usedNums es una COPIA del set persistente (igual que `new Set(existingRef.current.nums)`),
// así que esta función NO muta el set recibido: emula la copia interna de buildCodes.
// ──────────────────────────────────────────────────────────────────────────────
function allocateShortCodes(count, persistentNums) {
    const usedNums = new Set(persistentNums); // copia, como en buildCodes()
    const codes = [];
    let counter = 1;
    for (let i = 0; i < count; i++) {
        while (usedNums.has(counter)) counter++;
        const shortCode = counter.toString().padStart(5, '0');
        usedNums.add(counter);
        counter++;
        codes.push(shortCode);
    }
    return codes;
}

/** Emula el bloque keepOpen: añade los códigos recién guardados al set persistente. */
function refreshUsedAfterSave(persistentNums, justSavedShortCodes) {
    justSavedShortCodes.forEach(sc => {
        const n = parseInt(sc, 10);
        if (n > 0) persistentNums.add(n);
    });
}

describe('Registro continuo — no reutilizar shortCodes entre productos consecutivos', () => {
    it('el segundo lote NO reutiliza ningún shortCode del primero tras "Guardar y nuevo"', () => {
        const persistentNums = new Set(); // BD vacía al montar el formulario

        // Producto 1: stock 3 → genera 00001, 00002, 00003
        const batch1 = allocateShortCodes(3, persistentNums);
        expect(batch1).toEqual(['00001', '00002', '00003']);

        // "Guardar y nuevo": refrescar el ref con lo recién usado y limpiar (no se testea el form aquí)
        refreshUsedAfterSave(persistentNums, batch1);

        // Producto 2: stock 2 → debe continuar en 00004, 00005 (sin reusar)
        const batch2 = allocateShortCodes(2, persistentNums);
        expect(batch2).toEqual(['00004', '00005']);

        // Invariante central: no hay solapamiento entre lotes consecutivos
        const overlap = batch2.filter(sc => batch1.includes(sc));
        expect(overlap).toEqual([]);
    });

    it('demuestra el bug que se previene: SIN refrescar el ref, el segundo lote SÍ reutilizaría', () => {
        const persistentNums = new Set();
        const batch1 = allocateShortCodes(3, persistentNums);
        // (omitimos refreshUsedAfterSave a propósito)
        const batch2 = allocateShortCodes(2, persistentNums);
        // Sin el refresco, ambos arrancan desde 00001 → colisión
        expect(batch2.filter(sc => batch1.includes(sc))).toEqual(['00001', '00002']);
    });

    it('respeta códigos ya existentes en la BD al arrancar (no empieza desde 00001)', () => {
        const persistentNums = new Set([1, 2, 5]); // BD ya tenía 00001, 00002, 00005
        const batch = allocateShortCodes(3, persistentNums);
        expect(batch).toEqual(['00003', '00004', '00006']);
    });
});
