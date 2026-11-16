import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Store, CheckCircle2, AlertTriangle, RefreshCw, Sparkles, ArrowRight } from 'lucide-react';
import {
    db,
    generateBarcodesForProduct,
    generateUniqueBarcode,
    shortCodeExists,
    registerBranchTransferInProduct,
    getLocalISOString,
} from '../db';
import { useUser } from '../contexts/UserContext';
import BranchSelect from './ui/BranchSelect';
import {
    normalizarCodigoSucursal,
    evaluarLoteCodigosSucursal,
    sugerirCodigoLibre,
} from '../utils/branchTransferIn';

/**
 * 📦 StockAdjustModal — Pantalla completa de suministro, ingreso desde sucursal o ajuste de stock
 *
 * @prop {Object}   product          - Producto a ajustar
 * @prop {Object}   reservedMap      - { [productId]: cantidad } de reservas pendientes
 * @prop {Function} onClose          - Callback para cerrar la pantalla
 * @prop {Function} showToast        - Callback para notificaciones
 * @prop {string}   [initialMode]    - 'entrada' | 'sucursal' | 'salida'
 * @prop {string}   [initialCode]    - Código corto inicial pre-cargado (ej. desde Recibir de Sucursal)
 * @prop {string}   [initialBranch]  - Sucursal origen pre-cargada
 * @prop {Function} [onSwitchProduct] - Callback opcional para cambiar al producto dueño de un retorno
 */
export default function StockAdjustModal({
    product,
    reservedMap = {},
    onClose,
    showToast,
    initialMode = 'entrada',
    initialCode = '',
    initialBranch = '',
    onSwitchProduct,
}) {
    const { user } = useUser() || {};
    const allProducts = useLiveQuery(() => db.products.toArray(), []) || [];
    const allBarcodes = useLiveQuery(() => db.barcodes.toArray(), []) || [];

    const [adjType, setAdjType] = React.useState(initialMode);
    const [adjQty, setAdjQty] = React.useState(initialMode === 'sucursal' ? '1' : '');
    const [adjNote, setAdjNote] = React.useState('');
    const [manualCode, setManualCode] = React.useState('');

    // ── Estado exclusivo para modo "Ingreso desde Sucursal" ──
    const [originBranch, setOriginBranch] = React.useState(initialBranch || '');
    const [branchCodes, setBranchCodes] = React.useState(() =>
        initialCode ? [initialCode] : ['']
    );
    const [saving, setSaving] = React.useState(false);

    const reservedCount = reservedMap[product.id] || 0;

    // Sincronizar la cantidad de casillas de códigos cortos con adjQty en modo sucursal
    const handleQtyChange = (rawVal) => {
        setAdjQty(rawVal);
        if (adjType === 'sucursal') {
            const n = Math.max(0, Math.min(50, parseInt(rawVal, 10) || 0));
            setBranchCodes((prev) => {
                if (n === 0) return [];
                if (prev.length === n) return prev;
                if (prev.length > n) return prev.slice(0, n);
                return [...prev, ...Array(n - prev.length).fill('')];
            });
        }
    };

    const handleSwitchMode = (newMode) => {
        setAdjType(newMode);
        if (newMode === 'sucursal') {
            const currentQty = parseInt(adjQty, 10);
            const targetQty = !currentQty || currentQty <= 0 ? 1 : Math.min(50, currentQty);
            setAdjQty(String(targetQty));
            setBranchCodes((prev) => {
                const seed = prev.length > 0 ? prev : manualCode ? [manualCode] : [''];
                if (seed.length === targetQty) return seed;
                if (seed.length > targetQty) return seed.slice(0, targetQty);
                return [...seed, ...Array(targetQty - seed.length).fill('')];
            });
        }
    };

    const handleBranchCodeChange = (index, val) => {
        setBranchCodes((prev) => {
            const next = [...prev];
            next[index] = val;
            return next;
        });
    };

    const handleBranchCodeBlur = (index) => {
        setBranchCodes((prev) => {
            const raw = prev[index];
            const norm = normalizarCodigoSucursal(raw);
            if (!norm || norm === raw) return prev;
            const next = [...prev];
            next[index] = norm;
            return next;
        });
    };

    // Evaluación en vivo del lote de códigos de sucursal
    const evaluacionSucursal = React.useMemo(() => {
        if (adjType !== 'sucursal') return null;
        return evaluarLoteCodigosSucursal({
            rawCodes: branchCodes,
            products: allProducts,
            barcodes: allBarcodes,
            targetProductId: product.id,
        });
    }, [adjType, branchCodes, allProducts, allBarcodes, product.id]);

    // Si algún código detecta un retorno con sucursal sugerida y originBranch está vacío, sugerirlo automáticamente
    React.useEffect(() => {
        if (adjType !== 'sucursal' || originBranch) return;
        const conSucursal = evaluacionSucursal?.items?.find((it) => it.originBranchSuggested);
        if (conSucursal?.originBranchSuggested) {
            setOriginBranch(conSucursal.originBranchSuggested);
        }
    }, [adjType, originBranch, evaluacionSucursal]);

    // Asignar un código libre en 1 clic cuando hay colisión y se decide re-etiquetar
    const handleAssignFreeCode = (index) => {
        try {
            const libre = sugerirCodigoLibre(allProducts, allBarcodes, branchCodes);
            handleBranchCodeChange(index, libre);
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    // El re-registro rápido en Entrada normal sigue disponible para 1 unidad
    const allowManualCode = adjType === 'entrada' && parseInt(adjQty, 10) === 1;

    const handleAdjust = async () => {
        if (saving) return;
        const qty = parseInt(adjQty, 10);
        if (!qty || qty <= 0) {
            showToast('Ingresa una cantidad válida mayor a 0', 'error');
            return;
        }

        // ── MODO 1: Ingreso auditado desde Sucursal (1 o varias unidades) ──
        if (adjType === 'sucursal') {
            if (!originBranch.trim()) {
                showToast('Selecciona la sucursal de origen', 'error');
                return;
            }
            if (!evaluacionSucursal?.valido) {
                const firstErr = evaluacionSucursal?.items?.find((it) => !it.valido);
                showToast(firstErr?.mensaje || 'Revisa los códigos cortos de las unidades', 'error');
                return;
            }

            setSaving(true);
            try {
                const plan = await registerBranchTransferInProduct({
                    productId: product.id,
                    originBranch,
                    notes: adjNote,
                    rawCodes: branchCodes,
                    user,
                });
                const detalle = plan.resumen.retornosCount > 0
                    ? ` (${plan.resumen.retornosCount} retorno(s) reactivado(s))`
                    : '';
                showToast(`Ingreso desde ${plan.originBranch} registrado (+${plan.qty})${detalle} ✓`);
                onClose();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                setSaving(false);
            }
            return;
        }

        // ── MODO 2: Entrada / Salida estándar ──
        const trimmedManual = manualCode.trim();
        const useManualCode = adjType === 'entrada' && qty === 1 && trimmedManual !== '';
        let manualEntry = null; // { shortCode, barcode }
        if (useManualCode) {
            const normManual = normalizarCodigoSucursal(trimmedManual);
            if (!normManual) {
                showToast('El código corto manual debe tener de 1 a 5 dígitos numéricos', 'error');
                return;
            }
            try {
                if (await shortCodeExists(normManual)) {
                    showToast('Ese código corto ya está en uso en esta tienda. Usa "Desde Sucursal" para ver el detalle o reactivar retornos.', 'error');
                    return;
                }
                const eanGenerado = await generateUniqueBarcode();
                manualEntry = { shortCode: normManual, barcode: eanGenerado };
            } catch (err) {
                showToast(err.message, 'error');
                return;
            }
        }

        setSaving(true);
        try {
            await db.transaction('rw', db.products, db.kardex, db.barcodes, db.reservations, async () => {
                const freshProduct = await db.products.get(product.id);
                if (!freshProduct) throw new Error('Producto no encontrado');

                const newStock = adjType === 'entrada'
                    ? freshProduct.stock + qty
                    : freshProduct.stock - qty;

                if (newStock < 0) throw new Error('El stock no puede quedar negativo');
                if (adjType === 'salida') {
                    const pendingCount = await db.reservations
                        .where('productId').equals(product.id)
                        .and((r) => r.status === 'pending')
                        .count();
                    if (newStock < pendingCount) {
                        throw new Error(`No se puede ajustar: existen ${pendingCount} reserva(s) pendientes`);
                    }
                }

                await db.products.update(product.id, {
                    stock: newStock,
                    updatedAt: new Date().toISOString(),
                });

                let unitCodes = [];
                if (adjType === 'entrada') {
                    if (manualEntry) {
                        await db.barcodes.add({
                            productId: product.id,
                            barcode: manualEntry.barcode,
                            shortCode: manualEntry.shortCode,
                            used: false,
                            createdAt: getLocalISOString(),
                        });
                        unitCodes = [{ shortCode: manualEntry.shortCode, barcode: manualEntry.barcode }];
                    } else {
                        unitCodes = await generateBarcodesForProduct(product.id, qty);
                    }
                } else {
                    const toDelete = await db.barcodes
                        .where('productId').equals(product.id)
                        .and((b) => !b.used)
                        .reverse()
                        .limit(qty)
                        .toArray();
                    unitCodes = toDelete.map((b) => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' }));
                    for (const b of toDelete) await db.barcodes.delete(b.id);
                }

                await db.kardex.add({
                    productId: product.id,
                    date: getLocalISOString(),
                    type: adjType,
                    qty,
                    notes: manualEntry
                        ? `ENTRADA POR TRASLADO (CÓD. ${manualEntry.shortCode})`
                        : (adjNote.trim() || 'SUMINISTRO/AJUSTE MANUAL').toUpperCase(),
                    balanceAfter: newStock,
                    unitCodes,
                    userId: user?.id ?? null,
                    registeredBy: user?.name || user?.username || 'Sistema',
                });
            });

            showToast('Stock actualizado con éxito ✓');
            onClose();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto fade-in pb-72">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white border flex items-center justify-center text-pink-500 shadow-sm"
                    >
                        <X size={18} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-pink-950 uppercase tracking-tight">
                            Suministro / Ajuste de Stock
                        </h1>
                        <p className="text-pink-500 font-bold text-sm tracking-wide">
                            {product.name}
                            {[product.brand, product.size, product.color].filter(Boolean).length > 0 &&
                                ` · ${[product.brand, product.size, product.color].filter(Boolean).join(' / ')}`}
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-12">
                {/* Stock actual */}
                <div className="md:col-span-4 fashion-card p-8 bg-pink-50/40 border-2 border-pink-100/50 flex flex-col justify-center items-center text-center">
                    <p className="text-xs font-black text-pink-400 uppercase tracking-[0.2em] mb-4">Stock en Sistema</p>
                    <div className="relative">
                        <span className="text-7xl font-black text-pink-950">{product.stock}</span>
                        <div className="absolute -top-2 -right-6 w-4 h-4 bg-green-400 rounded-full animate-pulse border-2 border-white" />
                    </div>
                    {reservedCount > 0 && (
                        <p className="text-xs font-bold text-rose-500 mt-3">
                            {reservedCount} reservada(s) · Disp: {product.stock - reservedCount}
                        </p>
                    )}
                    <p className="text-[10px] font-bold text-pink-300 uppercase mt-4">Unidades disponibles</p>
                    {product.shortCode && (
                        <p className="text-[11px] font-bold text-pink-500 mt-3 bg-white px-3 py-1 rounded-full border border-pink-100">
                            Cód. Modelo Web: {product.shortCode}
                        </p>
                    )}
                </div>

                {/* Formulario de ajuste */}
                <div className="md:col-span-8 fashion-card p-8 space-y-6 border-2 border-pink-50">
                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-black text-pink-800 uppercase tracking-widest text-center">
                            Tipo de Movimiento
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            <button
                                type="button"
                                onClick={() => handleSwitchMode('entrada')}
                                className={`py-4 px-3 rounded-2xl font-black text-xs uppercase tracking-wider border-2 transition-all active:scale-95
                                    ${adjType === 'entrada'
                                        ? 'border-green-500 bg-green-50 text-green-700 shadow-lg shadow-green-100'
                                        : 'border-pink-50 bg-white text-gray-400 hover:border-pink-200'}`}
                            >
                                📥 Entrada Nueva
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSwitchMode('sucursal')}
                                className={`py-4 px-3 rounded-2xl font-black text-xs uppercase tracking-wider border-2 transition-all active:scale-95
                                    ${adjType === 'sucursal'
                                        ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-lg shadow-amber-100'
                                        : 'border-pink-50 bg-white text-gray-400 hover:border-amber-200'}`}
                            >
                                🏬 Desde Sucursal
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSwitchMode('salida')}
                                className={`py-4 px-3 rounded-2xl font-black text-xs uppercase tracking-wider border-2 transition-all active:scale-95
                                    ${adjType === 'salida'
                                        ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-lg shadow-rose-100'
                                        : 'border-pink-50 bg-white text-gray-400 hover:border-pink-200'}`}
                            >
                                📤 Salida / Baja
                            </button>
                        </div>
                    </div>

                    {adjType === 'sucursal' && (
                        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-4 fade-in">
                            <div className="flex items-start gap-2.5 text-xs text-amber-900">
                                <Store size={18} className="text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-black uppercase tracking-wide">
                                        Recepción auditada desde sucursal (conservando código corto)
                                    </p>
                                    <p className="text-amber-700 font-medium mt-0.5">
                                        Registra prendas traídas de otra sucursal manteniendo el código corto de su etiqueta física para evitar confusiones en tienda y en la tienda virtual.
                                    </p>
                                </div>
                            </div>

                            <BranchSelect
                                label="Sucursal de Origen"
                                value={originBranch}
                                onChange={setOriginBranch}
                                placeholder="Seleccionar de qué sucursal llega..."
                                required
                            />
                        </div>
                    )}

                    <div className="space-y-2 text-center">
                        <label className="text-xs font-black text-pink-900 uppercase tracking-widest">
                            Cantidad de Unidades a {adjType === 'salida' ? 'Restar' : 'Ingresar'}
                        </label>
                        <input
                            type="number"
                            min="1"
                            max={adjType === 'sucursal' ? '50' : undefined}
                            value={adjQty}
                            onChange={(e) => handleQtyChange(e.target.value)}
                            className="w-full fashion-input text-4xl font-black text-center py-5 border-pink-100 focus:border-pink-500 no-spinner"
                            placeholder="0"
                            autoFocus={adjType !== 'sucursal'}
                        />
                    </div>

                    {/* Casillas de códigos cortos de sucursal por cada unidad */}
                    {adjType === 'sucursal' && branchCodes.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-amber-100 fade-in">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-amber-900 uppercase tracking-widest">
                                    Código(s) corto(s) en la etiqueta de la sucursal ({branchCodes.length})
                                </label>
                                <span className="text-[11px] font-bold text-amber-600">
                                    Ej: 01450 (se rellena a 5 dígitos)
                                </span>
                            </div>

                            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                                {branchCodes.map((codeVal, idx) => {
                                    const itemEval = evaluacionSucursal?.items?.[idx];
                                    const isOk = itemEval?.valido;
                                    const isReturn = itemEval?.status === 'retorno_mismo_producto';
                                    const isOtherReturn = itemEval?.status === 'retorno_otro_producto';
                                    const isCollision = itemEval?.status === 'colision' || itemEval?.status === 'duplicado_en_lote';

                                    return (
                                        <div
                                            key={idx}
                                            className={`p-3 rounded-2xl border-2 transition-all ${
                                                isReturn
                                                    ? 'bg-amber-50/80 border-amber-300'
                                                    : isOk
                                                        ? 'bg-emerald-50/60 border-emerald-200'
                                                        : codeVal.trim()
                                                            ? 'bg-rose-50/70 border-rose-300'
                                                            : 'bg-white border-amber-100'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-black text-amber-800 w-20 shrink-0">
                                                    Unidad #{idx + 1}
                                                </span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={5}
                                                    value={codeVal}
                                                    onChange={(e) => handleBranchCodeChange(idx, e.target.value)}
                                                    onBlur={() => handleBranchCodeBlur(idx)}
                                                    placeholder="00000"
                                                    className="flex-1 fashion-input text-center font-black tracking-[0.25em] text-lg py-2.5 border-amber-200 focus:border-amber-500"
                                                />
                                                {(isCollision || isOtherReturn) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAssignFreeCode(idx)}
                                                        className="px-3 py-2 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-[11px] font-black flex items-center gap-1 shrink-0 transition-colors"
                                                        title="Asignar un código corto libre nuevo (requiere re-etiquetar la prenda)"
                                                    >
                                                        <Sparkles size={13} /> Asignar libre
                                                    </button>
                                                )}
                                            </div>

                                            {itemEval && itemEval.status !== 'vacio' && (
                                                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                                    <span
                                                        className={`font-bold flex items-center gap-1.5 ${
                                                            isReturn
                                                                ? 'text-amber-800'
                                                                : isOk
                                                                    ? 'text-emerald-700'
                                                                    : 'text-rose-700'
                                                        }`}
                                                    >
                                                        {isReturn ? (
                                                            <RefreshCw size={13} className="shrink-0" />
                                                        ) : isOk ? (
                                                            <CheckCircle2 size={13} className="shrink-0" />
                                                        ) : (
                                                            <AlertTriangle size={13} className="shrink-0" />
                                                        )}
                                                        {itemEval.mensaje}
                                                    </span>

                                                    {isOtherReturn && itemEval.conflictProduct && onSwitchProduct && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onSwitchProduct(itemEval.conflictProduct, itemEval.shortCode, itemEval.originBranchSuggested)}
                                                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] flex items-center gap-1 shrink-0"
                                                        >
                                                            Ir a {itemEval.conflictProduct.name} <ArrowRight size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-black text-pink-900 uppercase tracking-widest text-center block">
                            {adjType === 'sucursal' ? 'Motivo / Observación del Traslado (Opcional)' : 'Motivo / Nota'}
                        </label>
                        <input
                            value={adjNote}
                            onChange={(e) => setAdjNote(e.target.value.toUpperCase())}
                            className="fashion-input text-center font-bold text-pink-700 placeholder:text-pink-200"
                            placeholder={
                                adjType === 'sucursal'
                                    ? 'EJ: REPOSICIÓN TIENDA PRINCIPAL, PEDIDO WEB...'
                                    : 'EJ: NUEVA MERCADERÍA, CORRECCIÓN...'
                            }
                        />
                    </div>

                    {/* Atajo en Entrada normal de 1 unidad hacia el modo Desde Sucursal */}
                    {allowManualCode && (
                        <div className="space-y-2 pt-2 border-t border-amber-100 fade-in">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-black text-amber-700 uppercase tracking-widest">
                                    Código corto manual · opcional
                                </label>
                                <button
                                    type="button"
                                    onClick={() => handleSwitchMode('sucursal')}
                                    className="text-[11px] font-black text-amber-700 underline hover:text-amber-900"
                                >
                                    ¿Viene de sucursal? Usar modo Desde Sucursal →
                                </button>
                            </div>
                            <input
                                value={manualCode}
                                onChange={(e) => setManualCode(e.target.value.trim())}
                                className="fashion-input text-center font-black tracking-[0.2em] text-amber-700 placeholder:text-amber-200 border-amber-100 focus:border-amber-400"
                                placeholder="00000"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Footer flotante */}
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 z-50">
                <div className="bg-white/80 backdrop-blur-2xl border-2 border-pink-100 p-4 rounded-[3rem] shadow-2xl flex gap-4">
                    <button
                        onClick={onClose}
                        className="px-10 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-[2rem] text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors"
                    >
                        CANCELAR
                    </button>
                    <button
                        onClick={handleAdjust}
                        disabled={saving}
                        className={`flex-1 text-white font-black py-5 rounded-[2rem] text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 ${
                            adjType === 'sucursal'
                                ? 'bg-gradient-to-r from-amber-500 to-orange-600'
                                : 'bg-gradient-to-r from-pink-600 to-rose-600'
                        }`}
                    >
                        {saving
                            ? 'GUARDANDO...'
                            : adjType === 'sucursal'
                                ? 'CONFIRMAR INGRESO DE SUCURSAL'
                                : 'CONFIRMAR CAMBIO'}
                    </button>
                </div>
            </div>
        </div>
    );
}
