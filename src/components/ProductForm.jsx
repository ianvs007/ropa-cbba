import React from 'react';
import { X, Store, PackagePlus, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import {
    db,
    generateBarcode,
    generateBarcodesForProduct,
    generateShortCode,
    generateUniqueBarcode,
    ensureBranchExists,
    getLocalISOString,
    uploadProductImageToDisk,
} from '../db';
import { useUser } from '../contexts/UserContext';
import TypeaheadInput from './ui/TypeaheadInput';
import BranchSelect from './ui/BranchSelect';
import { getEmbedding } from '../utils/garmentClassifier';
import { codigoTomadoPorOtro } from '../utils/duplicateShortCodes';
import {
    normalizarCodigoSucursal,
    evaluarLoteCodigosSucursal,
    sugerirCodigoLibre,
    planificarIngresoSucursal,
} from '../utils/branchTransferIn';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Talla Única',
    '6', '8', '10', '12', '14', '16', '18', '20', '22', '24',
    '26', '28', '30', '32', '34', '36', '38', '40'];

const EMPTY = {
    name: '', barcode: '', category: '', brand: '', size: '', color: '',
    cost: '', price: '', stock: '', description: '', photo: '', extraData: '',
    shortCode: '', globalId: '', customData: {},
};

/**
 * 📝 ProductForm — Pantalla completa de alta/edición de producto
 * Soporta tanto el alta de Mercadería Nueva (Stock Inicial) como el registro
 * de productos traídos desde una Sucursal conservando su código corto.
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
    initialEntryMode = 'nuevo',
    initialBranchCode = '',
    initialOriginBranch = '',
}) {
    const { user } = useUser() || {};
    const [form, setForm] = React.useState(() => {
        if (!editing && initialEntryMode === 'sucursal' && !formProp.stock) {
            return { ...formProp, stock: '1' };
        }
        return formProp;
    });
    const [cameraOn, setCamera] = React.useState(false);
    const [cameraError, setCameraError] = React.useState(null);
    const [cameraLoading, setCameraLoading] = React.useState(false);
    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const streamRef = React.useRef(null);
    const formScrollRef = React.useRef(null);

    // ── Modo de alta: 'nuevo' (Stock Inicial) | 'sucursal' (Traído de Sucursal) ──
    const [entryMode, setEntryMode] = React.useState(
        !editing && initialEntryMode === 'sucursal' ? 'sucursal' : 'nuevo'
    );
    const [originBranch, setOriginBranch] = React.useState(initialOriginBranch || '');
    const [transferNotes, setTransferNotes] = React.useState('');
    const [branchUnitCodes, setBranchUnitCodes] = React.useState(() =>
        initialBranchCode ? [initialBranchCode] : ['']
    );
    const [dbSnapshot, setDbSnapshot] = React.useState({ products: [], barcodes: [] });

    // ── Códigos pre-generados (en memoria, no guardados hasta presionar Guardar) ──
    const [unitCodes, setUnitCodes] = React.useState([]);
    const [saving, setSaving] = React.useState(false);
    // Ref con los sets de EANs y códigos cortos ya usados en la BD (cargados al montar)
    const existingRef = React.useRef({ eans: new Set(), nums: new Set() });

    const refreshDbSnapshot = React.useCallback(async () => {
        const [prods, bars] = await Promise.all([db.products.toArray(), db.barcodes.toArray()]);
        const eans = new Set();
        const nums = new Set();
        prods.forEach((p) => {
            if (p.barcode) eans.add(p.barcode);
            if (p.shortCode) {
                const n = parseInt(p.shortCode, 10);
                if (n > 0) nums.add(n);
            }
        });
        bars.forEach((b) => {
            if (b.barcode) eans.add(b.barcode);
            if (b.shortCode) {
                const n = parseInt(b.shortCode, 10);
                if (n > 0) nums.add(n);
            }
        });
        existingRef.current = { eans, nums };
        setDbSnapshot({ products: prods, barcodes: bars });
    }, []);

    React.useEffect(() => {
        if (editing) return;
        refreshDbSnapshot();
    }, [editing, refreshDbSnapshot]);

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

    const syncBranchCodesLength = (qtyVal) => {
        const n = Math.max(0, Math.min(50, parseInt(qtyVal, 10) || 0));
        setBranchUnitCodes((prev) => {
            if (n === 0) return [];
            if (prev.length === n) return prev;
            if (prev.length > n) return prev.slice(0, n);
            return [...prev, ...Array(n - prev.length).fill('')];
        });
    };

    const handleSwitchEntryMode = (newMode) => {
        setEntryMode(newMode);
        if (newMode === 'sucursal') {
            const currentStock = parseInt(form.stock, 10);
            const targetStock = !currentStock || currentStock <= 0 ? 1 : Math.min(50, currentStock);
            setForm((prev) => ({ ...prev, stock: String(targetStock) }));
            syncBranchCodesLength(targetStock);
        } else {
            buildCodes(parseInt(form.stock, 10) || 0);
        }
    };

    const handleBranchUnitCodeChange = (idx, val) => {
        setBranchUnitCodes((prev) => {
            const next = [...prev];
            next[idx] = val;
            return next;
        });
    };

    const handleBranchUnitCodeBlur = (idx) => {
        setBranchUnitCodes((prev) => {
            const raw = prev[idx];
            const norm = normalizarCodigoSucursal(raw);
            if (!norm || norm === raw) return prev;
            const next = [...prev];
            next[idx] = norm;
            return next;
        });
    };

    const handleAssignFreeBranchCode = (idx) => {
        try {
            const libre = sugerirCodigoLibre(
                dbSnapshot.products,
                dbSnapshot.barcodes,
                branchUnitCodes
            );
            handleBranchUnitCodeChange(idx, libre);
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const evaluacionSucursal = React.useMemo(() => {
        if (editing || entryMode !== 'sucursal') return null;
        return evaluarLoteCodigosSucursal({
            rawCodes: branchUnitCodes,
            products: dbSnapshot.products,
            barcodes: dbSnapshot.barcodes,
            targetProductId: null,
        });
    }, [editing, entryMode, branchUnitCodes, dbSnapshot]);

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
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
            
            streamRef.current = stream;
            setCamera(true);

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
            resolve(tmpCanvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });

    const buildEmbedding = (dataUrl) => new Promise(resolve => {
        if (!dataUrl) { resolve(null); return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
            try {
                const vec = await getEmbedding(img);
                resolve(vec);
            } catch (e) {
                console.warn('No se pudo generar el embedding de la foto:', e);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
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
            if (video.readyState < 2) {
                await new Promise(resolve => {
                    video.onloadeddata = resolve;
                    setTimeout(resolve, 500);
                });
            }

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const rawData = canvas.toDataURL('image/jpeg', 0.9);
            const resized = await resizeImage(rawData);
            
            change('photo', resized);

            stopCamera();
            showToast('✓ Foto capturada exitosamente');
        } catch (err) {
            console.error('Error al capturar foto:', err);
            showToast('Error al capturar la foto. Inténtalo de nuevo.', 'error');
        }
    };

    const handleSave = async (e, keepOpen = false) => {
        e?.preventDefault();
        if (saving) return;
        const costVal = parseFloat(form.cost) || 0;
        const priceVal = parseFloat(form.price) || 0;
        const stockVal = parseInt(form.stock, 10) || 0;

        if (!form.name) { showToast('Nombre obligatorio', 'error'); return; }
        if (priceVal <= 0) { showToast('Precio inválido', 'error'); return; }

        const isBranchMode = !editing && entryMode === 'sucursal';
        if (isBranchMode) {
            if (!originBranch.trim()) {
                showToast('Selecciona la sucursal de origen', 'error');
                return;
            }
            if (stockVal <= 0 || branchUnitCodes.length !== stockVal) {
                showToast('Ingresa la cantidad y los códigos cortos de las unidades traídas de sucursal', 'error');
                return;
            }
            if (!evaluacionSucursal?.valido) {
                const primerError = evaluacionSucursal?.items?.find((it) => !it.valido);
                showToast(primerError?.mensaje || 'Revisa los códigos cortos de la sucursal', 'error');
                return;
            }
        }

        // Validar EAN duplicado
        if (form.barcode) {
            const dup = await db.products.where('barcode').equals(form.barcode).first();
            if (dup && dup.id !== editing) {
                showToast('El código EAN ya pertenece a otro producto', 'error');
                return;
            }
        }

        setSaving(true);
        try {
            let shortCodeFinal = form.shortCode;
            let planSucursal = null;

            if (isBranchMode) {
                const [freshProducts, freshBarcodes] = await Promise.all([
                    db.products.toArray(),
                    db.barcodes.toArray(),
                ]);
                const generatedEANs = new Set([form.barcode].filter(Boolean));
                const eanPool = [];
                for (let i = 0; i < stockVal; i++) {
                    eanPool.push(await generateUniqueBarcode(generatedEANs));
                }
                let eanIdx = 0;
                planSucursal = planificarIngresoSucursal({
                    modo: 'producto_nuevo',
                    originBranch,
                    notes: transferNotes,
                    rawCodes: branchUnitCodes,
                    products: freshProducts,
                    barcodes: freshBarcodes,
                    fallbackModelShortCode: form.shortCode,
                    buildEAN: () => eanPool[eanIdx++] || generateBarcode(),
                });
                shortCodeFinal = planSucursal.modelShortCode;
                await ensureBranchExists(planSucursal.originBranch);
            } else if (shortCodeFinal) {
                // ── Blindaje anti-duplicados de shortCode ──
                const dupProducto = await db.products.where('shortCode').equals(shortCodeFinal).first();
                const dupUnidades = await db.barcodes.where('shortCode').equals(shortCodeFinal).toArray();
                const enUso = codigoTomadoPorOtro({
                    productoConEseCodigo: dupProducto,
                    unidadesConEseCodigo: dupUnidades,
                    editing,
                });
                if (enUso) {
                    shortCodeFinal = (await generateShortCode()).shortCode;
                    showToast(`El código ${form.shortCode} ya estaba en uso; se asignó ${shortCodeFinal} automáticamente`, 'error');
                }
            }

            const data = {
                ...form,
                shortCode: shortCodeFinal,
                globalId: form.globalId || crypto.randomUUID(),
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

            if (isBranchMode && planSucursal) {
                data.originBranch = planSucursal.originBranch;
                data.isBranchTransfer = true;
            }

            // ── Embedding visual separado (`productEmbeddings`) y foto en disco (`/__local_media/...`) ──
            let pendingEmbedding = undefined; // undefined = conservar el actual, null = borrar, array = guardar
            const photoChanged = !editing || form.photo !== (formProp?.photo || '');

            if (!form.photo) {
                data.photo = '';
                data.hasEmbedding = 0;
                pendingEmbedding = null;
            } else {
                if (photoChanged || form.hasEmbedding !== 1) {
                    try {
                        const vec = await buildEmbedding(form.photo);
                        if (vec) {
                            pendingEmbedding = vec;
                            data.hasEmbedding = 1;
                        } else {
                            pendingEmbedding = null;
                            data.hasEmbedding = 0;
                        }
                    } catch (e) {
                        console.warn('Generación de embedding omitida:', e);
                        pendingEmbedding = null;
                        data.hasEmbedding = 0;
                    }
                } else {
                    data.hasEmbedding = 1;
                }

                if (form.photo.startsWith('data:image/')) {
                    data.photo = await uploadProductImageToDisk(
                        form.photo,
                        shortCodeFinal || data.globalId
                    );
                }
            }
            delete data.embedding;

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

                let savedProductId = editing;
                if (editing) {
                    await db.products.update(editing, data);
                } else {
                    data.createdAt = new Date().toISOString();
                    const id = await db.products.add(data);
                    savedProductId = id;

                    if (isBranchMode && planSucursal) {
                        const now = getLocalISOString();
                        await db.transaction('rw', db.barcodes, db.kardex, async () => {
                            for (const u of planSucursal.unidadesAInsertar) {
                                await db.barcodes.add({
                                    productId: id,
                                    barcode: u.barcode,
                                    shortCode: u.shortCode,
                                    used: false,
                                    isBranchTransfer: true,
                                    originBranch: planSucursal.originBranch,
                                    transferInDate: now,
                                    createdAt: now,
                                });
                            }
                            for (const u of planSucursal.unidadesAReactivar) {
                                await db.barcodes.update(u.id, {
                                    productId: id,
                                    used: false,
                                    transferStatus: 'retornado',
                                    returnDate: now,
                                    isBranchTransfer: true,
                                    originBranch: planSucursal.originBranch,
                                });
                            }
                            await db.kardex.add({
                                productId: id,
                                type: 'entrada',
                                subType: 'traslado_entrada',
                                originBranch: planSucursal.originBranch,
                                qty: stockVal,
                                notes: planSucursal.kardexNotes,
                                balanceAfter: stockVal,
                                date: now,
                                unitCodes: planSucursal.unitCodesKardex,
                                userId: user?.id ?? null,
                                registeredBy: user?.name || user?.username || 'Sistema',
                            });
                        });
                    } else if (stockVal > 0) {
                        const codesToSave = unitCodes.length === stockVal
                            ? unitCodes
                            : await generateBarcodesForProduct(id, stockVal).then(c => c);
                        if (unitCodes.length === stockVal) {
                            const now = getLocalISOString();
                            await db.transaction('rw', db.barcodes, async () => {
                                for (const { barcode, shortCode } of codesToSave) {
                                    await db.barcodes.add({
                                        productId: id,
                                        barcode,
                                        shortCode,
                                        used: false,
                                        createdAt: now,
                                    });
                                }
                            });
                        }
                        await db.kardex.add({
                            productId: id,
                            type: 'entrada',
                            qty: stockVal,
                            notes: 'STOCK INICIAL',
                            balanceAfter: stockVal,
                            date: getLocalISOString(),
                            unitCodes: codesToSave.map(({ shortCode, barcode }) => ({
                                shortCode: shortCode || '',
                                barcode: barcode || '',
                            })),
                            userId: user?.id ?? null,
                            registeredBy: user?.name || user?.username || 'Sistema',
                        });
                    }
                }

                // Persistir o limpiar vector visual en la tabla separada `productEmbeddings`
                if (db.productEmbeddings && savedProductId != null) {
                    if (pendingEmbedding === null) {
                        await db.productEmbeddings.delete(savedProductId);
                    } else if (Array.isArray(pendingEmbedding)) {
                        await db.productEmbeddings.put({
                            productId: savedProductId,
                            globalId: data.globalId || null,
                            embedding: pendingEmbedding,
                        });
                    }
                }

                showToast(
                    isBranchMode && planSucursal
                        ? `Prenda registrada desde ${planSucursal.originBranch} (Cód. ${shortCodeFinal}) ✓`
                        : 'Guardado correctamente ✓'
                );

                if (keepOpen && !editing) {
                    const justSaved = isBranchMode && planSucursal
                        ? planSucursal.unitCodesKardex
                        : (unitCodes || []);
                    justSaved.forEach(({ barcode, shortCode }) => {
                        if (barcode) existingRef.current.eans.add(barcode);
                        const n = parseInt(shortCode, 10);
                        if (n > 0) existingRef.current.nums.add(n);
                    });
                    const nModelo = parseInt(shortCodeFinal, 10);
                    if (nModelo > 0) existingRef.current.nums.add(nModelo);

                    const siguienteEAN = await generateUniqueBarcode();
                    existingRef.current.eans.add(siguienteEAN);
                    const { shortCode: siguienteCodigo, globalId: siguienteGlobalId } = await generateShortCode();
                    setForm({
                        ...EMPTY,
                        barcode: siguienteEAN,
                        shortCode: siguienteCodigo,
                        globalId: siguienteGlobalId,
                        stock: isBranchMode ? '1' : '',
                    });
                    setUnitCodes([]);
                    setBranchUnitCodes(['']);
                    await refreshDbSnapshot();
                    stopCamera();
                    if (formScrollRef?.current) {
                        formScrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                } else {
                    onClose();
                }
            } catch (err) {
                showToast(err.message, 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto fade-in pb-72" ref={formScrollRef}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { stopCamera(); onClose(); }}
                        className="w-8 h-8 rounded-full bg-white border flex items-center justify-center text-pink-500"
                    >
                        <X size={18} />
                    </button>
                    <h1 className="text-2xl font-black text-pink-950">
                        {editing ? 'Editar Producto' : entryMode === 'sucursal' ? 'Nuevo Producto desde Sucursal' : 'Nuevo Producto'}
                    </h1>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-8">
                {/* Selector de Modo de Registro (Solo en Alta Nueva) */}
                {!editing && (
                    <div className="fashion-card p-6 space-y-5 border-2 border-pink-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => handleSwitchEntryMode('nuevo')}
                                className={`py-4 px-5 rounded-2xl font-black text-xs uppercase tracking-wider border-2 flex items-center justify-center gap-2.5 transition-all ${
                                    entryMode === 'nuevo'
                                        ? 'border-pink-500 bg-pink-50 text-pink-800 shadow-md shadow-pink-100'
                                        : 'border-gray-100 bg-white text-gray-400 hover:border-pink-200'
                                }`}
                            >
                                <PackagePlus size={18} />
                                Mercadería Nueva (Stock Inicial)
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSwitchEntryMode('sucursal')}
                                className={`py-4 px-5 rounded-2xl font-black text-xs uppercase tracking-wider border-2 flex items-center justify-center gap-2.5 transition-all ${
                                    entryMode === 'sucursal'
                                        ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-md shadow-amber-100'
                                        : 'border-gray-100 bg-white text-gray-400 hover:border-amber-200'
                                }`}
                            >
                                <Store size={18} />
                                Traído de Sucursal (Conservar Código)
                            </button>
                        </div>

                        {entryMode === 'sucursal' && (
                            <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-4 fade-in">
                                <div className="flex items-start gap-2.5 text-xs text-amber-900">
                                    <Store size={18} className="text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-black uppercase tracking-wide">
                                            Alta contable y auditable desde sucursal
                                        </p>
                                        <p className="text-amber-700 font-medium mt-0.5">
                                            La prenda conservará el código corto de 5 dígitos de su etiqueta física de sucursal y quedará alineada automáticamente con la Tienda Virtual.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <BranchSelect
                                        label="Sucursal de Origen"
                                        value={originBranch}
                                        onChange={setOriginBranch}
                                        placeholder="Seleccionar sucursal de origen..."
                                        required
                                    />
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-black text-amber-900 uppercase tracking-widest block">
                                            Motivo / Nota de Traslado (Opcional)
                                        </label>
                                        <input
                                            type="text"
                                            value={transferNotes}
                                            onChange={(e) => setTransferNotes(e.target.value.toUpperCase())}
                                            placeholder="EJ: EXHIBICIÓN CENTRAL, PEDIDO WEB..."
                                            className="fashion-input border-amber-200 focus:border-amber-500 font-bold text-amber-900"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="fashion-card p-8 space-y-6">
                    <TypeaheadInput
                        label="Nombre" value={form.name}
                        onChange={v => change('name', v.toUpperCase())}
                        options={nameOptions} required
                    />

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
                        <label className="block text-sm font-bold text-pink-800">
                            {entryMode === 'sucursal' ? 'Cantidad Recibida' : 'Stock Inicial'}
                        </label>
                        <input
                            type="number"
                            min={entryMode === 'sucursal' ? '1' : '0'}
                            max={entryMode === 'sucursal' ? '50' : undefined}
                            value={form.stock}
                            onChange={e => {
                                const val = e.target.value;
                                change('stock', val);
                                if (!editing) {
                                    if (entryMode === 'sucursal') {
                                        syncBranchCodesLength(val);
                                    } else {
                                        buildCodes(parseInt(val, 10) || 0);
                                    }
                                }
                            }}
                            className="fashion-input"
                            disabled={!!editing}
                        />
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

                {/* ── Códigos de etiqueta cuando viene de Sucursal ── */}
                {!editing && entryMode === 'sucursal' && branchUnitCodes.length > 0 && (
                    <div className="fashion-card p-8 border-2 border-amber-200 bg-amber-50/30 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <h3 className="text-xs font-black text-amber-900 uppercase tracking-widest flex items-center gap-2">
                                <Store size={15} className="text-amber-600" />
                                Código(s) Corto(s) de la Sucursal — {branchUnitCodes.length} unidad(es)
                            </h3>
                            <span className="text-xs font-bold text-amber-700">
                                Escribe el código de la etiqueta física que trae la prenda
                            </span>
                        </div>

                        <div className="space-y-3">
                            {branchUnitCodes.map((codeVal, idx) => {
                                const itemEval = evaluacionSucursal?.items?.[idx];
                                const isOk = itemEval?.valido;
                                const isCollision =
                                    itemEval?.status === 'colision' ||
                                    itemEval?.status === 'duplicado_en_lote' ||
                                    itemEval?.status === 'retorno_otro_producto';

                                return (
                                    <div
                                        key={idx}
                                        className={`p-4 rounded-2xl border-2 transition-all ${
                                            isOk
                                                ? 'bg-emerald-50/70 border-emerald-200'
                                                : codeVal.trim()
                                                    ? 'bg-rose-50/70 border-rose-300'
                                                    : 'bg-white border-amber-200'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-black text-amber-900 w-24 shrink-0">
                                                Unidad #{idx + 1}
                                            </span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={5}
                                                value={codeVal}
                                                onChange={(e) => handleBranchUnitCodeChange(idx, e.target.value)}
                                                onBlur={() => handleBranchUnitCodeBlur(idx)}
                                                placeholder="00000"
                                                className="flex-1 fashion-input text-center font-black tracking-[0.25em] text-lg py-2.5 border-amber-200 focus:border-amber-500"
                                            />
                                            {isCollision && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleAssignFreeBranchCode(idx)}
                                                    className="px-3 py-2 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-black flex items-center gap-1.5 shrink-0"
                                                >
                                                    <Sparkles size={14} /> Asignar código libre
                                                </button>
                                            )}
                                        </div>

                                        {itemEval && itemEval.status !== 'vacio' && (
                                            <p
                                                className={`mt-2 text-xs font-bold flex items-center gap-1.5 ${
                                                    isOk ? 'text-emerald-700' : 'text-rose-700'
                                                }`}
                                            >
                                                {isOk ? (
                                                    <CheckCircle2 size={14} className="shrink-0" />
                                                ) : (
                                                    <AlertTriangle size={14} className="shrink-0" />
                                                )}
                                                {itemEval.mensaje}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Preview de códigos individuales por unidad (Modo Mercadería Nueva) ── */}
                {!editing && entryMode === 'nuevo' && unitCodes.length > 0 && (
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
                        {editing ? (
                            <button type="button" onClick={(e) => handleSave(e, false)} disabled={saving}
                                className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black rounded-3xl shadow-xl disabled:opacity-50 disabled:cursor-not-allowed">
                                {saving ? 'GUARDANDO…' : 'ACTUALIZAR'}
                            </button>
                        ) : (
                            <>
                                <button type="button" onClick={(e) => handleSave(e, true)} disabled={saving}
                                    className="flex-1 border-2 border-pink-300 bg-pink-50 text-pink-600 font-black rounded-3xl disabled:opacity-50 disabled:cursor-not-allowed">
                                    {saving ? 'GUARDANDO…' : 'GUARDAR Y NUEVO'}
                                </button>
                                <button type="button" onClick={(e) => handleSave(e, false)} disabled={saving}
                                    className={`flex-1 text-white font-black rounded-3xl shadow-xl disabled:opacity-50 disabled:cursor-not-allowed ${
                                        entryMode === 'sucursal'
                                            ? 'bg-gradient-to-r from-amber-500 to-orange-600'
                                            : 'bg-gradient-to-r from-pink-600 to-rose-600'
                                    }`}>
                                    {saving ? 'GUARDANDO…' : entryMode === 'sucursal' ? 'REGISTRAR DE SUCURSAL' : 'GUARDAR'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}

export { EMPTY };
