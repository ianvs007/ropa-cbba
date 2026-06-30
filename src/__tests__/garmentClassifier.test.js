/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🧪 TESTS DE SIMILITUD POR EMBEDDINGS — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Verifican la lógica pura de comparación visual usada por "Buscar por foto":
 *   - cosineSimilarity: producto punto de dos vectores YA normalizados.
 *     Como las entradas vienen normalizadas (norma L2 = 1), la similitud cae
 *     en 0..1: ≈1 idénticas, ≈0 sin parecido.
 *
 * getEmbedding NO se prueba aquí: requiere cargar MobileNet (~16MB) y un canvas
 * real del navegador. Se valida manualmente en uso real (registrar/buscar una
 * prenda con la cámara), igual que las funciones de muestreo de píxeles en
 * colorDetection.test.js.
 *
 * Nota: cosineSimilarity NO normaliza por su cuenta; asume vectores
 * normalizados. Por eso los vectores de prueba se escriben normalizados a mano.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../utils/garmentClassifier';

describe('cosineSimilarity — vectores normalizados', () => {
    it('un vector consigo mismo da ≈ 1', () => {
        // [0.6, 0.8] ya está normalizado: 0.6² + 0.8² = 1.
        const v = [0.6, 0.8];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
    });

    it('dos vectores ortogonales dan ≈ 0', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    it('un ángulo de 45° da ≈ 0.7071', () => {
        // [1,0] contra el unitario a 45°: cos(45°) = √2/2 ≈ 0.7071.
        expect(cosineSimilarity([1, 0], [0.7071, 0.7071])).toBeCloseTo(0.7071, 3);
    });
});

describe('cosineSimilarity — casos de guarda', () => {
    it('vectores de distinta longitud devuelven 0', () => {
        expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
    });

    it('entradas nulas/undefined devuelven 0', () => {
        expect(cosineSimilarity(null, [1, 0])).toBe(0);
        expect(cosineSimilarity([1, 0], undefined)).toBe(0);
    });
});

describe('cosineSimilarity — orden por parecido', () => {
    it('mayor similitud = más parecido (un vector cercano gana al lejano)', () => {
        const query = [1, 0];
        const cercano = [0.7071, 0.7071]; // 45° respecto al query
        const lejano = [0, 1];            // 90° respecto al query (ortogonal)

        const simCercano = cosineSimilarity(query, cercano);
        const simLejano = cosineSimilarity(query, lejano);

        expect(simCercano).toBeGreaterThan(simLejano);

        // Ordenando por similitud descendente, el cercano queda primero.
        const ranking = [
            { name: 'lejano', sim: simLejano },
            { name: 'cercano', sim: simCercano },
        ].sort((a, b) => b.sim - a.sim);
        expect(ranking[0].name).toBe('cercano');
    });
});
