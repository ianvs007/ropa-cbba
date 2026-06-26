/**
 * colorDetection.js
 * ─────────────────────────────────────────────────────────────
 * Detección de color por análisis de píxeles (SIN IA).
 *
 * Flujo:
 *   1. Toma un <canvas> / ImageData con la prenda capturada por webcam.
 *   2. Promedia el color de la ZONA CENTRAL (ignora fondo, sombras de borde).
 *   3. Mapea ese RGB al color más cercano de la PALETA de referencia
 *      por distancia euclidiana, y devuelve su nombre en MAYÚSCULAS.
 *
 * El nombre devuelto (ej. "ROJO") encaja directamente en el campo
 * de texto `color` de ProductForm.jsx y en el catálogo `colors`,
 * que guarda los nombres en MAYÚSCULAS. No requiere cambios de esquema.
 */

/**
 * Paleta de referencia: nombre (MAYÚSCULAS, español) → [R, G, B].
 * Convención de mayúsculas alineada con ProductForm (form.color.toUpperCase()).
 * Ampliable libremente; el matcher siempre devuelve el más cercano.
 * @type {{ name: string, rgb: [number, number, number] }[]}
 */
export const COLOR_PALETTE = [
    { name: 'NEGRO',    rgb: [20, 20, 20] },
    { name: 'BLANCO',   rgb: [245, 245, 245] },
    { name: 'GRIS',     rgb: [128, 128, 128] },
    { name: 'PLOMO',    rgb: [105, 105, 110] }, // sinónimo boliviano de gris oscuro
    { name: 'ROJO',     rgb: [200, 30, 40] },
    { name: 'GUINDO',   rgb: [120, 30, 40] },   // rojo vino, común en Bolivia
    { name: 'ROSADO',   rgb: [240, 130, 170] },
    { name: 'NARANJA',  rgb: [230, 120, 30] },
    { name: 'AMARILLO', rgb: [240, 215, 50] },
    { name: 'VERDE',    rgb: [40, 150, 70] },
    { name: 'CELESTE',  rgb: [120, 195, 230] },
    { name: 'AZUL',     rgb: [40, 70, 180] },
    { name: 'MARINO',   rgb: [25, 35, 80] },    // azul marino
    { name: 'MORADO',   rgb: [110, 50, 160] },
    { name: 'CAFE',     rgb: [110, 70, 40] },
    { name: 'BEIGE',    rgb: [225, 210, 175] },
    { name: 'CREMA',    rgb: [240, 235, 210] },
];

/**
 * Distancia euclidiana al cuadrado entre dos colores RGB.
 * Se usa el cuadrado (sin sqrt) porque solo importa el orden relativo,
 * y así se evita el costo de la raíz.
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
function rgbDistanceSq(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

/**
 * Calcula el RGB promedio de la zona central de un ImageData.
 *
 * @param {ImageData} imageData  Datos de píxeles (canvas.getContext('2d').getImageData()).
 * @param {number} [centralRatio=0.5]  Fracción central a analizar (0..1).
 *        0.5 = recuadro central del 50% del ancho y alto.
 * @returns {[number, number, number]}  RGB promedio [0..255].
 */
export function averageCentralColor(imageData, centralRatio = 0.5) {
    const { data, width, height } = imageData;

    const ratio = Math.min(Math.max(centralRatio, 0.05), 1);
    const halfW = (width * ratio) / 2;
    const halfH = (height * ratio) / 2;
    const cx = width / 2;
    const cy = height / 2;

    const xStart = Math.floor(cx - halfW);
    const xEnd = Math.ceil(cx + halfW);
    const yStart = Math.floor(cy - halfH);
    const yEnd = Math.ceil(cy + halfH);

    let rSum = 0, gSum = 0, bSum = 0, count = 0;

    for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
            const i = (y * width + x) * 4;
            const alpha = data[i + 3];
            if (alpha < 16) continue; // ignora píxeles casi transparentes
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
            count++;
        }
    }

    if (count === 0) return [0, 0, 0];
    return [
        Math.round(rSum / count),
        Math.round(gSum / count),
        Math.round(bSum / count),
    ];
}

/**
 * Dado un RGB, encuentra el color más cercano de la paleta.
 *
 * @param {[number, number, number]} rgb
 * @param {{ name: string, rgb: [number, number, number] }[]} [palette=COLOR_PALETTE]
 * @returns {{ name: string, rgb: [number, number, number], distance: number, confidence: number }}
 *          confidence: 0..1 (heurística; 1 = coincidencia exacta).
 */
export function nearestPaletteColor(rgb, palette = COLOR_PALETTE) {
    let best = palette[0];
    let bestDistSq = Infinity;

    for (const color of palette) {
        const d = rgbDistanceSq(rgb, color.rgb);
        if (d < bestDistSq) {
            bestDistSq = d;
            best = color;
        }
    }

    // Distancia máxima posible en RGB: sqrt(3 * 255^2) ≈ 441.67
    const MAX_DIST = 441.6729559300637;
    const distance = Math.sqrt(bestDistSq);
    const confidence = Math.max(0, 1 - distance / MAX_DIST);

    return { name: best.name, rgb: best.rgb, distance, confidence };
}

/**
 * Función principal: de un ImageData (o canvas) al nombre de color del catálogo.
 *
 * @param {ImageData} imageData
 * @param {object} [options]
 * @param {number} [options.centralRatio=0.5]  Zona central a muestrear.
 * @param {{ name: string, rgb: [number, number, number] }[]} [options.palette=COLOR_PALETTE]
 * @returns {{ name: string, rgb: [number, number, number], sampledRgb: [number, number, number], distance: number, confidence: number }}
 */
export function detectColor(imageData, options = {}) {
    const { centralRatio = 0.5, palette = COLOR_PALETTE } = options;
    const sampledRgb = averageCentralColor(imageData, centralRatio);
    const match = nearestPaletteColor(sampledRgb, palette);
    return { ...match, sampledRgb };
}

/**
 * Helper opcional: extrae ImageData de un <canvas> y detecta el color.
 * Útil cuando ya tienes un canvas con el frame capturado.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]  Mismas opciones que detectColor.
 * @returns {ReturnType<typeof detectColor>}
 */
export function detectColorFromCanvas(canvas, options = {}) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return detectColor(imageData, options);
}
