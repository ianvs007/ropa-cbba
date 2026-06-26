import React from 'react';
import { X } from 'lucide-react';
import { db, generateBarcode, generateBarcodesForProduct, getLocalISOString } from '../db';
import TypeaheadInput from './ui/TypeaheadInput';
import { detectColorFromCanvas } from '../utils/colorDetection';
import { classifyGarment } from '../utils/garmentClassifier';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Talla Única',
    '6', '8', '10', '12', '14', '16', '18', '20', '22', '24',
    '26', '28', '30', '32', '34', '36', '38', '40'];

const EMPTY = {
    name: '', barcode: '', category: '', brand: '', size: '', color: '',
    cost: '', price: '', stock: '', description: '', photo: '', extraData: '',
    shortCode: '', customData: {},
};

/**
 * 📝 ProductForm — Pantalla completa de alta/edición de producto
 *
 * @prop {Object}   form              - Estado del formulario
 * @prop {number|null} editing        - ID del producto en edición (null = nuevo)
 * @prop {Function} onClose           - Callback para cerrar el formulario
 * @prop {Function} showToast         - ({text, type}) para notificaciones
 * @prop {string[]} categoryOptions
 * @prop {string[]} nameOptions
 * @prop {string[]} brandOptions
 * @prop {string[]} colorOptions
 * @prop {string[]} extraDataOptions
 */
export default function ProductForm({
    form: formProp,
    editing,
    onClose,
    showToast,
    categoryOptions = [],
    nameOptions = [],
    brandOptions = [],
    colorOptions = [],
    extraDataOptions = [],
}) {
    const [form, setForm] = React.useState(formProp);
    const [cameraOn, setCamera] = React.useState(false);
    const [cameraError, setCameraError] = React.useState(null);
    const [cameraLoading, setCameraLoading] = React.useState(false);
    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const streamRef = React.useRef(null);
    const formScrollRef = React.useRef(null);

    // ── Reconocimiento (color + categoría) a partir de la foto capturada ──
    const [suggestions, setSuggestions] = React.useState(null); // { color, categorias }
    const [analyzing, setAnalyzing] = React.useState(false);

    // ── Códigos pre-generados (en memoria, no guardados hasta presionar Guardar) ──
    const [unitCodes, setUnitCodes] = React.useState([]);
    // Ref con los sets de EANs y códigos cortos ya usados en la BD (cargados al montar)
    const existingRef = React.useRef({ eans: new Set(), nums: new Set() });

    React.useEffect(() => {
        if (editing) return;
        Promise.all([db.products.toArray(), db.barcodes.toArray()]).then(([prods, bars]) => {
            const eans = new Set();
            const nums = new Set();
            prods.forEach(p => {
                if (p.barcode)   eans.add(p.barcode);
                if (p.shortCode) { const n = parseInt(p.shortCode, 10); if (n > 0) nums.add(n); }
            });
            bars.forEach(b => {
                if (b.barcode)   eans.add(b.barcode);
                if (b.shortCode) { const n = parseInt(b.shortCode, 10); if (n > 0) nums.add(n); }
            });
            existingRef.current = { eans, nums };
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Genera N códigos únicos y los guarda en estado (síncrono, en memoria)
    const buildCodes = (stockVal) => {
        if (stockVal <= 0) { setUnitCodes([]); return; }
        const usedEANs = new Set(existingRef.current.eans);
        const usedNums = new Set(existingRef.current.nums);
        const codes = [];
        let counter = 1;
        for (let i = 0; i < stockVal; i++) {
            let ean;
            let tries = 0;
            do { ean = generateBarcode(); tries++; } while (usedEANs.has(ean) && tries < 200);
            usedEANs.add(ean);
            while (usedNums.has(counter)) counter++;
            const shortCode = counter.toString().padStart(5, '0');
            usedNums.add(counter);
            counter++;
            codes.push({ barcode: ean, shortCode });
        }
        setUnitCodes(codes);
    };

    React.useEffect(() => {
        setTimeout(() => { if (formScrollRef.current) formScrollRef.current.scrollTop = 0; }, 100);
    }, []);

    // Limpiar cámara al desmontar
    React.useEffect(() => {
        return () => {
            stopCamera();
        };
    }, []);

    const change = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setCamera(false);
        setCameraError(null);
    };

    const startCamera = async () => {
        setCameraLoading(true);
        setCameraError(null);
        try {
            // Minimalismo absoluto para evitar conflictos de hardware
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
            
            streamRef.current = stream;
            setCamera(true);

            // Forzar play tras un breve delay para asegurar que el DOM cargó
            setTimeout(() => {
                const v = videoRef.current;
                if (v) {
                    v.srcObject = stream;
                    v.onloadedmetadata = () => {
                        v.play().catch(e => console.error("Error al reproducir:", e));
                    };
                }
            }, 300);

        } catch (err) {
            console.error('Error crítico cámara:', err);
            setCameraError('Error al iniciar cámara: ' + (err.message || 'Sin acceso'));
            setCamera(false);
        } finally {
            setCameraLoading(false);
        }
    };

    // Resize imagen a máx 400x400 antes de guardar
    const resizeImage = (dataUrl, maxW = 400, maxH = 400) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
            const w = Math.round(img.width * ratio);
            const h = Math.round(img.height * ratio);
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = w; tmpCanvas.height = h;
            tmpCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(tmpCanvas.toDataURL('image/jpeg', 0.85)); // Mejor calidad
        };
        img.onerror = () => resolve(dataUrl); // Fallback a la imagen original si falla
        img.src = dataUrl;
    });

    const capturePhoto = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) {
            showToast('Error: No se pudo acceder al video', 'error');
            return;
        }

        try {
            // Esperar a que el video esté listo
            if (video.readyState < 2) {
                await new Promise(resolve => {
                    video.onloadeddata = resolve;
                    setTimeout(resolve, 500); // Timeout por seguridad
                });
            }

            // Configurar canvas con el tamaño real del video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            // Capturar el frame actual
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convertir a data URL y redimensionar
            const rawData = canvas.toDataURL('image/jpeg', 0.9);
            const resized = await resizeImage(rawData);
            
            change('photo', resized);

            // ── Reconocimiento sobre el mismo frame (no bloquea el guardado de la foto) ──
            analyzeFromCanvas(canvas);

            stopCamera();
            showToast('✓ Foto capturada exitosamente');
        } catch (err) {
            console.error('Error al capturar foto:', err);
            showToast('Error al capturar la foto. Inténtalo de nuevo.', 'error');
        }
    };

    /**
     * Analiza el frame capturado para sugerir color y categoría.
     * - Color: análisis de píxeles (instantáneo, sin IA).
     * - Categoría: MobileNet (la primera vez descarga ~16MB del CDN).
     * Las sugerencias NO se aplican solas; el usuario las confirma.
     */
    const analyzeFromCanvas = async (canvas) => {
        setSuggestions(null);
        setAnalyzing(true);
        try {
            // 1) Color — inmediato.
            let color = null;
            try {
                const c = detectColorFromCanvas(canvas, { centralRatio: 0.5 });
                color = c.name;
            } catch (e) {
                console.warn('Detección de color falló:', e);
            }

            // 2) Categoría — puede tardar (carga del modelo la 1ra vez).
            let categorias = [];
            try {
                const results = await classifyGarment(canvas);
                categorias = results
                    .filter(r => r.categoria)        // solo las que mapean a una categoría real
                    .map(r => r.categoria.toUpperCase());
                categorias = [...new Set(categorias)]; // sin duplicados
            } catch (e) {
                console.warn('Clasificación de categoría falló:', e);
            }

            setSuggestions({ color, categorias });
        } finally {
            setAnalyzing(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const costVal = parseFloat(form.cost) || 0;
        const priceVal = parseFloat(form.price) || 0;
        const stockVal = parseInt(form.stock) || 0;

        if (!form.name) { showToast('Nombre obligatorio', 'error'); return; }
        if (priceVal <= 0) { showToast('Precio inválido', 'error'); return; }

        // Validar EAN duplicado
        if (form.barcode) {
            const dup = await db.products.where('barcode').equals(form.barcode).first();
            if (dup && dup.id !== editing) {
                showToast('El código EAN ya pertenece a otro producto', 'error');
                return;
            }
        }

        const data = {
            ...form,
            name: form.name.trim().toUpperCase(),
            category: form.category.toUpperCase(),
            brand: form.brand.toUpperCase(),
            color: form.color?.toUpperCase() || '',
            size: form.size?.toUpperCase() || '',
            extraData: form.extraData?.trim() || '',
            cost: costVal,
            price: priceVal,
            stock: stockVal,
            updatedAt: new Date().toISOString(),
        };

        try {
            const autoAdd = async (table, val, extra = {}) => {
                if (!val) return;
                const upperVal = val.trim().toUpperCase();
                const exists = await table.where('name').equals(upperVal).first();
                if (!exists) await table.add({ name: upperVal, ...extra });
            };

            await Promise.all([
                autoAdd(db.productNames, data.name),
                autoAdd(db.categories, data.category),
                autoAdd(db.brands, data.brand),
                autoAdd(db.colors, data.color),
                autoAdd(db.productFields, data.extraData, { type: 'text' }),
            ]);

            if (editing) {
                await db.products.update(editing, data);
            } else {
                data.createdAt = new Date().toISOString();
                const id = await db.products.add(data);
                if (stockVal > 0) {
                    await db.kardex.add({
                        productId: id, type: 'entrada', qty: stockVal,
                        notes: 'STOCK INICIAL', balanceAfter: stockVal,
                        date: getLocalISOString(),
                    });
                    // Guardar exactamente los códigos pre-generados y mostrados al usuario
                    const codesToSave = unitCodes.length === stockVal ? unitCodes
                        : await generateBarcodesForProduct(id, stockVal).then(c => c);
                    if (unitCodes.length === stockVal) {
                        const now = getLocalISOString();
                        await db.transaction('rw', db.barcodes, async () => {
                            for (const { barcode, shortCode } of codesToSave) {
                                await db.barcodes.add({ productId: id, barcode, shortCode, used: false, createdAt: now });
                            }
                        });
                    }
                }
            }
            onClose();
            showToast('Guardado correctamente ✓');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    return (
        <div className="max-w-5xl mx-auto fade-in pb-72" ref={formScrollRef}>
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { stopCamera(); onClose(); }}
                        className="w-8 h-8 rounded-full bg-white border flex items-center justify-center text-pink-500"
                    >
                        <X size={18} />
                    </button>
                    <h1 className="text-2xl font-black text-pink-950">
                        {editing ? 'Editar Producto' : 'Nuevo Producto'}
                    </h1>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-8">
                <div className="fashion-card p-8 space-y-6">
                    <TypeaheadInput
                        label="Nombre" value={form.name}
                        onChange={v => change('name', v.toUpperCase())}
                        options={nameOptions} required
                    />
                    {/* ── Panel de sugerencias del reconocimiento por cámara ── */}
                    {(analyzing || suggestions) && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                            {analyzing ? (
                                <p className="text-sm text-blue-700 flex items-center gap-2">
                                    <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                    Analizando la prenda… (la primera vez puede tardar al cargar el modelo)
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-semibold text-blue-800">
                                            🔎 Sugerencias (revisa y aplica las que quieras)
                                        </p>
                                        <button type="button" onClick={() => setSuggestions(null)}
                                            className="text-xs text-blue-500 hover:text-blue-700">
                                            Descartar
                                        </button>
                                    </div>

                                    {/* Color sugerido */}
                                    {suggestions.color && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-gray-600">Color:</span>
                                            <button type="button"
                                                onClick={() => change('color', suggestions.color)}
                                                className="px-3 py-1 rounded-full bg-white border border-blue-300 text-sm hover:bg-blue-100 transition-colors">
                                                {suggestions.color} ＋
                                            </button>
                                        </div>
                                    )}

                                    {/* Categorías sugeridas */}
                                    {suggestions.categorias && suggestions.categorias.length > 0 && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-gray-600">Categoría:</span>
                                            {suggestions.categorias.map(cat => (
                                                <button key={cat} type="button"
                                                    onClick={() => change('category', cat)}
                                                    className="px-3 py-1 rounded-full bg-white border border-blue-300 text-sm hover:bg-blue-100 transition-colors">
                                                    {cat} ＋
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Sin resultados útiles */}
                                    {!suggestions.color && (!suggestions.categorias || suggestions.categorias.length === 0) && (
                                        <p className="text-xs text-gray-500">
                                            No se obtuvieron sugerencias claras. Completa los campos manualmente.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <TypeaheadInput label="Categoría" value={form.category}
                            onChange={v => change('category', v.toUpperCase())} options={categoryOptions} />
                        <TypeaheadInput label="Marca" value={form.brand}
                            onChange={v => change('brand', v.toUpperCase())} options={brandOptions} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <TypeaheadInput label="Color" value={form.color}
                            onChange={v => change('color', v.toUpperCase())} options={colorOptions} />
                        <TypeaheadInput label="Talla" value={form.size}
                            onChange={v => change('size', v.toUpperCase())} options={SIZES} />
                        <TypeaheadInput label="Datos Extras" value={form.extraData}
                            onChange={v => change('extraData', v)} options={extraDataOptions}
                            placeholder="Ej. Material, Temporada" />
                    </div>

                    {/* Foto del producto */}
                    {form.photo ? (
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative">
                                <img src={form.photo} alt="Producto" className="w-40 h-40 rounded-xl object-cover border-2 border-pink-200 shadow-lg" />
                                <div className="absolute -top-2 -right-2 bg-pink-500 text-white rounded-full p-1.5 shadow-md">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                        <circle cx="12" cy="13" r="4"/>
                                    </svg>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => change('photo', '')}
                                    className="px-4 py-2 text-xs text-rose-500 hover:text-rose-700 font-semibold hover:bg-rose-50 rounded-lg transition">
                                    🗑️ Quitar foto
                                </button>
                                <button type="button" onClick={startCamera}
                                    className="px-4 py-2 text-xs text-pink-600 hover:text-pink-800 font-semibold hover:bg-pink-50 rounded-lg transition">
                                    🔄 Retomar foto
                                </button>
                            </div>
                        </div>
                    ) : cameraOn ? (
                        <div className="space-y-3">
                            <div className="relative bg-black rounded-xl overflow-hidden border-2 border-pink-300 shadow-lg">
                                <video 
                                    ref={el => {
                                        videoRef.current = el;
                                        if (el && streamRef.current && !el.srcObject) {
                                            el.srcObject = streamRef.current;
                                        }
                                    }}
                                    autoPlay 
                                    playsInline
                                    muted
                                    className="w-full h-auto bg-black"
                                    style={{ maxHeight: '400px' }}
                                />
                                <canvas ref={canvasRef} className="hidden" />
                                {/* Overlay de guía */}
                                <div className="absolute inset-0 border-2 border-white/30 rounded-xl pointer-events-none">
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-2 border-white/50 rounded-lg"></div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button 
                                    type="button" 
                                    onClick={capturePhoto}
                                    disabled={cameraLoading}
                                    className="flex-1 py-3 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white rounded-xl font-bold text-sm shadow-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"/>
                                        <circle cx="12" cy="12" r="4" fill="currentColor"/>
                                    </svg>
                                    Capturar Foto
                                </button>
                                <button 
                                    type="button" 
                                    onClick={stopCamera}
                                    disabled={cameraLoading}
                                    className="px-6 py-3 border-2 border-pink-300 hover:border-pink-400 rounded-xl text-pink-500 hover:text-pink-700 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    ) : cameraLoading ? (
                        <div className="w-full py-8 border-2 border-dashed border-pink-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-pink-50/50">
                            <div className="w-10 h-10 border-4 border-pink-300 border-t-pink-600 rounded-full animate-spin"></div>
                            <p className="text-pink-600 font-semibold text-sm">Activando cámara...</p>
                        </div>
                    ) : cameraError ? (
                        <div className="w-full p-4 bg-red-50 border-2 border-red-200 rounded-xl">
                            <div className="flex items-start gap-3">
                                <div className="text-red-500 mt-0.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="12" y1="8" x2="12" y2="12"/>
                                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <p className="text-red-700 font-semibold text-sm">{cameraError}</p>
                                    <button 
                                        type="button" 
                                        onClick={startCamera}
                                        className="mt-2 text-xs text-red-600 hover:text-red-800 font-semibold underline"
                                    >
                                        Reintentar
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <button 
                            type="button" 
                            onClick={startCamera}
                            className="w-full py-4 border-2 border-dashed border-pink-300 hover:border-pink-500 hover:bg-pink-50 rounded-xl text-pink-600 hover:text-pink-800 text-sm font-bold transition-all flex items-center justify-center gap-2 group"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                <circle cx="12" cy="13" r="4"/>
                            </svg>
                            📷 Agregar foto desde cámara
                        </button>
                    )}
                </div>

                <div className="fashion-card p-8 grid grid-cols-3 gap-6">
                    <div className="space-y-1">
                        <label className="block text-sm font-bold text-pink-800">Stock Inicial</label>
                        <input type="number" value={form.stock}
                            onChange={e => {
                                change('stock', e.target.value);
                                if (!editing) buildCodes(parseInt(e.target.value) || 0);
                            }}
                            className="fashion-input" disabled={!!editing} />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-sm font-bold text-pink-800">Costo</label>
                        <input type="number" step="0.01" value={form.cost}
                            onChange={e => change('cost', e.target.value)} className="fashion-input" />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-sm font-bold text-pink-500">Precio Venta</label>
                        <input type="number" step="0.01" value={form.price}
                            onChange={e => change('price', e.target.value)}
                            className="fashion-input border-pink-500" required />
                    </div>
                </div>

                {/* ── Preview de códigos individuales por unidad ── */}
                {!editing && unitCodes.length > 0 && (
                    <div className="fashion-card p-8">
                        <h3 className="text-xs font-black text-pink-400 uppercase tracking-widest mb-4">
                            Códigos por unidad — {unitCodes.length} unidades (se guardarán al presionar GUARDAR)
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-pink-50 text-pink-600">
                                        <th className="px-3 py-2 text-left font-bold text-xs">#</th>
                                        <th className="px-3 py-2 text-left font-bold text-xs">Cód. Corto</th>
                                        <th className="px-3 py-2 text-left font-bold text-xs">Cód. Barras (EAN)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-pink-50">
                                    {unitCodes.map((uc, i) => (
                                        <tr key={i} className="hover:bg-pink-50/50">
                                            <td className="px-3 py-2 text-pink-400 font-mono text-xs">Unidad {i + 1}</td>
                                            <td className="px-3 py-2">
                                                <span className="font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 text-xs">{uc.shortCode}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 text-[10px]">{uc.barcode}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Footer flotante */}
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-4xl px-4 z-50">
                    <div className="bg-white/80 backdrop-blur-xl border p-4 rounded-[2.5rem] shadow-2xl flex gap-4">
                        <button type="button" onClick={() => { stopCamera(); onClose(); }}
                            className="px-10 py-5 border-2 rounded-3xl font-black text-pink-500">
                            CANCELAR
                        </button>
                        <button type="submit"
                            className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black rounded-3xl shadow-xl">
                            GUARDAR
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}

export { EMPTY };
