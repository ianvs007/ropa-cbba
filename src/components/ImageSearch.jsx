import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Search, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react';
import { db } from '../db';
import { getEmbedding, cosineSimilarity } from '../utils/garmentClassifier';
import CameraCapture from './camera/CameraCapture';

/**
 * 🔎 ImageSearch — "Buscar por foto"
 *
 * Toma una foto de una prenda física, genera su huella visual (embedding) con
 * MobileNet y la compara por similitud coseno contra todos los productos que ya
 * tienen embedding guardado. Muestra los 5 más parecidos.
 *
 * Requiere que los productos tengan `hasEmbedding === 1` (se genera al
 * registrar con foto, o con "Reindexar fotos" en Configuración).
 */
export default function ImageSearch() {
    const [cameraActive, setCameraActive] = React.useState(false);
    const [preview, setPreview] = React.useState(null);      // dataURL de la foto tomada
    const [searching, setSearching] = React.useState(false);
    const [results, setResults] = React.useState(null);      // [{ product, score }]
    const [noIndex, setNoIndex] = React.useState(false);     // no hay productos indexados
    const [error, setError] = React.useState(null);

    // Símbolo de moneda configurado (para mostrar el precio).
    const currency = useLiveQuery(
        async () => (await db.settings.get('currency'))?.value || 'Bs.',
        []
    ) || 'Bs.';

    // Cuántos productos tienen embedding (para el aviso de reindexar).
    const indexedCount = useLiveQuery(
        () => db.products.where('hasEmbedding').equals(1).count(),
        []
    );

    const reset = () => {
        setResults(null);
        setPreview(null);
        setError(null);
        setNoIndex(false);
    };

    const handleCapture = async ({ canvas, dataUrl }) => {
        setCameraActive(false);
        setPreview(dataUrl);
        setResults(null);
        setError(null);
        setNoIndex(false);
        setSearching(true);
        try {
            // 1) Huella visual de la foto tomada.
            const query = await getEmbedding(canvas);

            // 2) Todos los productos ya indexados.
            const indexed = await db.products.where('hasEmbedding').equals(1).toArray();
            if (indexed.length === 0) {
                setNoIndex(true);
                return;
            }

            // 3) Similitud coseno contra cada uno y top-5.
            const scored = indexed
                .filter(p => Array.isArray(p.embedding) && p.embedding.length === query.length)
                .map(p => ({ product: p, score: cosineSimilarity(query, p.embedding) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);

            setResults(scored);
        } catch (err) {
            console.error('Error en la búsqueda por foto:', err);
            setError('No se pudo procesar la imagen. Inténtalo de nuevo.');
        } finally {
            setSearching(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-2 flex items-center gap-2">
                <Search size={24} strokeWidth={1.8} className="text-pink-600" />
                Buscar por foto
            </h1>
            <p className="text-sm text-pink-400 mb-6">
                Toma una foto de una prenda y encuentra los productos más parecidos del catálogo.
            </p>

            {/* Aviso si no hay productos indexados todavía */}
            {indexedCount === 0 && (
                <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                        Ningún producto tiene aún huella visual. Ve a{' '}
                        <span className="font-semibold">Configuración → "Reindexar fotos para búsqueda"</span>{' '}
                        para indexar los productos con foto ya existentes.
                    </p>
                </div>
            )}

            {/* ── Cámara activa ── */}
            {cameraActive ? (
                <div className="fashion-card p-6">
                    <CameraCapture onCapture={handleCapture} />
                    <div className="flex justify-center mt-4">
                        <button
                            type="button"
                            onClick={() => setCameraActive(false)}
                            className="text-sm text-pink-500 hover:text-pink-700 font-semibold"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Botón principal / volver a buscar */}
                    {!preview && !searching && (
                        <button
                            type="button"
                            onClick={() => { reset(); setCameraActive(true); }}
                            className="w-full py-5 border-2 border-dashed border-pink-300 hover:border-pink-500 hover:bg-pink-50 rounded-xl text-pink-600 hover:text-pink-800 font-bold transition-all flex items-center justify-center gap-2"
                        >
                            <Camera size={20} /> Tomar foto y buscar
                        </button>
                    )}

                    {/* Preview + estado de búsqueda */}
                    {preview && (
                        <div className="fashion-card p-6">
                            <div className="flex items-center gap-4">
                                <img
                                    src={preview}
                                    alt="Foto buscada"
                                    className="w-28 h-28 rounded-xl object-cover border-2 border-pink-200 shadow"
                                />
                                <div className="flex-1">
                                    {searching ? (
                                        <p className="text-sm text-pink-700 flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Analizando la prenda… (la primera vez carga el modelo)
                                        </p>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => { reset(); setCameraActive(true); }}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white text-sm font-bold rounded-xl transition-colors"
                                        >
                                            <RotateCcw size={16} /> Buscar otra prenda
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={16} className="text-red-500" />
                    <span className="text-sm text-red-700">{error}</span>
                </div>
            )}

            {/* ── No hay índice (al intentar buscar) ── */}
            {noIndex && (
                <div className="mt-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                        No hay productos con huella visual para comparar. Indexa primero los productos
                        con foto desde <span className="font-semibold">Configuración → "Reindexar fotos para búsqueda"</span>.
                    </p>
                </div>
            )}

            {/* ── Resultados ── */}
            {results && results.length > 0 && (
                <div className="mt-6 space-y-3">
                    <h2 className="text-sm font-black text-pink-400 uppercase tracking-widest">
                        {results.length} producto(s) más parecido(s)
                    </h2>
                    {results.map(({ product: p, score }) => (
                        <div key={p.id} className="fashion-card p-4 flex items-center gap-4">
                            {p.photo ? (
                                <img src={p.photo} alt={p.name}
                                    className="w-20 h-20 rounded-xl object-cover border border-pink-100 shrink-0" />
                            ) : (
                                <div className="w-20 h-20 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-300 shrink-0">
                                    <Camera size={24} />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-pink-900 truncate">{p.name}</p>
                                <p className="text-xs text-pink-400 mt-0.5">
                                    {p.shortCode && <span className="font-mono">#{p.shortCode}</span>}
                                    {p.size && <span> · Talla {p.size}</span>}
                                    {p.color && <span> · {p.color}</span>}
                                </p>
                                <p className="text-sm font-semibold text-pink-700 mt-1">
                                    {currency} {Number(p.price).toFixed(2)}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <span className="inline-block px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-black">
                                    {Math.round(score * 100)}%
                                </span>
                                <p className="text-[10px] text-pink-300 mt-1 uppercase tracking-wide">similitud</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Sin resultados tras buscar ── */}
            {results && results.length === 0 && !noIndex && (
                <div className="mt-4 text-center text-sm text-pink-400 py-6">
                    No se encontraron productos comparables.
                </div>
            )}
        </div>
    );
}
