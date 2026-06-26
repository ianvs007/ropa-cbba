/**
 * garmentClassifier.js
 * ─────────────────────────────────────────────────────────────
 * Clasificación de prendas con MobileNet (TensorFlow.js), 100% en el navegador.
 *
 * MobileNet es un modelo GENÉRICO entrenado en ImageNet (1000 clases en inglés).
 * No fue entrenado específicamente para ropa de tienda, así que:
 *   - Mapeamos sus etiquetas en inglés a las categorías reales del catálogo
 *     (en español) mediante IMAGENET_TO_CATEGORY.
 *   - Si una etiqueta no tiene mapeo, se devuelve traducida/cruda con menor
 *     confianza, para que el usuario decida (clasificación "nivel B").
 *
 * Offline-first: el modelo (~16MB) se descarga del CDN la PRIMERA vez y queda
 * cacheado por el navegador. Las siguientes veces funciona sin internet.
 *
 * Uso:
 *   import { classifyGarment } from '../utils/garmentClassifier';
 *   const results = await classifyGarment(canvasOrImageElement);
 *   // results = [{ categoria, etiquetaOriginal, probability }, ...] top-3
 */

// Catálogo real de categorías de la tienda (debe coincidir con seed.js).
export const STORE_CATEGORIES = [
    'Blusas', 'Camisas', 'Camisetas', 'Pantalones', 'Jeans', 'Faldas',
    'Vestidos', 'Chaquetas', 'Abrigos', 'Ropa Interior', 'Calzado',
    'Accesorios', 'Ropa Deportiva', 'Ropa de Niños', 'Otros',
];

/**
 * Mapeo de etiquetas ImageNet (inglés) → categoría de la tienda (español).
 * Las claves se comparan en minúsculas. Una etiqueta de ImageNet puede
 * contener varias palabras separadas por coma (ej. "jersey, T-shirt, tee shirt");
 * el matcher revisa cada fragmento.
 */
export const IMAGENET_TO_CATEGORY = {
    // Camisetas / poleras
    'jersey': 'Camisetas',
    't-shirt': 'Camisetas',
    'tee shirt': 'Camisetas',
    // Camisas
    'cardigan': 'Camisas',
    // Abrigos / chaquetas
    'sweatshirt': 'Ropa Deportiva',
    'suit': 'Chaquetas',
    'suit of clothes': 'Chaquetas',
    'trench coat': 'Abrigos',
    'fur coat': 'Abrigos',
    'lab coat': 'Abrigos',
    'coat': 'Abrigos',
    'kimono': 'Chaquetas',
    'poncho': 'Chaquetas',
    // Vestidos
    'gown': 'Vestidos',
    'overskirt': 'Vestidos',
    'hoopskirt': 'Vestidos',
    // Faldas
    'miniskirt': 'Faldas',
    'sarong': 'Faldas',
    // Pantalones / jeans
    'jean': 'Jeans',
    'blue jean': 'Jeans',
    'denim': 'Jeans',
    'sweatpant': 'Pantalones',
    'pajama': 'Ropa Interior',
    // Ropa interior
    'brassiere': 'Ropa Interior',
    'bra': 'Ropa Interior',
    'maillot': 'Ropa Interior',
    'swimming trunks': 'Ropa Interior',
    'bikini': 'Ropa Interior',
    // Calzado
    'running shoe': 'Calzado',
    'sandal': 'Calzado',
    'clog': 'Calzado',
    'loafer': 'Calzado',
    'cowboy boot': 'Calzado',
    'shoe shop': 'Calzado',
    'sneaker': 'Calzado',
    // Accesorios
    'sunglass': 'Accesorios',
    'sunglasses': 'Accesorios',
    'necklace': 'Accesorios',
    'bow tie': 'Accesorios',
    'tie': 'Accesorios',
    'windsor tie': 'Accesorios',
    'mitten': 'Accesorios',
    'sock': 'Accesorios',
    'hat': 'Accesorios',
    'cowboy hat': 'Accesorios',
    'sombrero': 'Accesorios',
    'bonnet': 'Accesorios',
    'crash helmet': 'Accesorios',
    'backpack': 'Accesorios',
    'purse': 'Accesorios',
    'handbag': 'Accesorios',
    'wallet': 'Accesorios',
    'belt': 'Accesorios',
};

let _modelPromise = null;

/**
 * Carga (perezosa y cacheada) el modelo MobileNet.
 * La primera llamada descarga el modelo; las siguientes reutilizan la promesa.
 * @returns {Promise<any>} instancia del modelo MobileNet.
 */
export async function loadModel() {
    if (_modelPromise) return _modelPromise;

    _modelPromise = (async () => {
        // Imports dinámicos: el bundle no carga TensorFlow hasta que se usa.
        const tf = await import('@tensorflow/tfjs');
        const mobilenet = await import('@tensorflow-models/mobilenet');
        await tf.ready();
        // version 2 / alpha 1.0 = mejor precisión (modelo más grande).
        return mobilenet.load({ version: 2, alpha: 1.0 });
    })();

    return _modelPromise;
}

/**
 * Intenta mapear una etiqueta ImageNet a una categoría de la tienda.
 * @param {string} className  Etiqueta cruda de MobileNet (puede tener comas).
 * @returns {string|null}  Categoría de la tienda, o null si no hay mapeo.
 */
function mapToCategory(className) {
    const parts = className.toLowerCase().split(',').map(s => s.trim());
    for (const part of parts) {
        if (IMAGENET_TO_CATEGORY[part]) return IMAGENET_TO_CATEGORY[part];
    }
    // Coincidencia parcial: alguna palabra clave contenida en el fragmento.
    for (const part of parts) {
        for (const key of Object.keys(IMAGENET_TO_CATEGORY)) {
            if (part.includes(key)) return IMAGENET_TO_CATEGORY[key];
        }
    }
    return null;
}

/**
 * Clasifica una imagen y devuelve las 3 mejores sugerencias de categoría.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement|ImageData} input
 *        Imagen a clasificar (un <canvas> con el frame capturado sirve).
 * @returns {Promise<Array<{
 *   categoria: string|null,       // categoría de la tienda (o null si sin mapeo)
 *   etiquetaOriginal: string,     // etiqueta cruda de MobileNet (inglés)
 *   probability: number,          // 0..1 confianza de MobileNet
 *   mapeada: boolean,             // true si se mapeó a una categoría conocida
 * }>>}
 */
export async function classifyGarment(input) {
    const model = await loadModel();
    // topk=5 para tener margen tras filtrar; devolvemos top-3 al final.
    const predictions = await model.classify(input, 5);

    const mapped = predictions.map(p => {
        const categoria = mapToCategory(p.className);
        return {
            categoria: categoria || null,
            etiquetaOriginal: p.className,
            probability: p.probability,
            mapeada: Boolean(categoria),
        };
    });

    // Prioriza las que sí mapean a una categoría conocida, manteniendo el orden
    // de probabilidad dentro de cada grupo.
    const conMapeo = mapped.filter(m => m.mapeada);
    const sinMapeo = mapped.filter(m => !m.mapeada);
    return [...conMapeo, ...sinMapeo].slice(0, 3);
}

/**
 * Libera el modelo de memoria (opcional, para liberar recursos).
 * Tras llamarlo, la próxima clasificación recargará el modelo.
 */
export function disposeModel() {
    _modelPromise = null;
}
