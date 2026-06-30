import React from 'react';
import { X, Search, ArrowRightLeft, Package, AlertTriangle } from 'lucide-react';
import { db, getLocalISOString } from '../db';

/**
 * 🔄 TransferModal — Traslado de una unidad física a otra sucursal
 *
 * Movimiento contablemente NEUTRO (no es venta ni merma) pero totalmente auditado.
 * La unidad NO se borra de "barcodes": se marca (used + transferStatus) para
 * conservar su shortCode consultable y distinguirla de una venta.
 *
 * @prop {Function} onClose   - Cierra la pantalla
 * @prop {Function} showToast - Notificación de éxito tras cerrar (text, type?)
 * @prop {Object}   user      - Usuario de sesión (mismo patrón que useUser → { id, ... })
 */
export default function TransferModal({ onClose, showToast, user }) {
    const [code, setCode] = React.useState('');
    const [unit, setUnit] = React.useState(null);       // barcode encontrado
    const [product, setProduct] = React.useState(null); // producto de esa unidad
    const [sucursalDestino, setSucursalDestino] = React.useState('');
    const [motivo, setMotivo] = React.useState('');
    const [error, setError] = React.useState('');
    const [searching, setSearching] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    // Al cambiar el código, invalidar la unidad previamente encontrada
    const handleCodeChange = (val) => {
        setCode(val);
        if (unit) { setUnit(null); setProduct(null); }
        if (error) setError('');
    };

    const handleSearch = async () => {
        const c = code.trim();
        setError('');
        setUnit(null);
        setProduct(null);
        if (!c) return;

        setSearching(true);
        try {
            const found = await db.barcodes.where('shortCode').equals(c).first();
            if (!found) {
                setError('No se encontró ninguna unidad con ese código corto');
                return;
            }
            if (found.used === true) {
                setError('Esta unidad ya fue vendida o trasladada');
                return;
            }
            const prod = await db.products.get(found.productId);
            if (!prod) {
                setError('La unidad existe pero su producto no fue encontrado');
                return;
            }
            setUnit(found);
            setProduct(prod);
        } catch (err) {
            setError(err.message);
        } finally {
            setSearching(false);
        }
    };

    const canConfirm = !!unit && !!product && sucursalDestino.trim() && motivo.trim() && !saving;

    const handleConfirm = async () => {
        if (!unit || !product) return;
        const destino = sucursalDestino.trim();
        const mot = motivo.trim();
        if (!destino || !mot) {
            setError('Sucursal destino y motivo son obligatorios');
            return;
        }

        setSaving(true);
        setError('');
        try {
            await db.transaction('rw', db.products, db.kardex, db.barcodes, db.reservations, async () => {
                // Re-leer unidad y producto DENTRO de la transacción (dato fresco)
                const freshUnit = await db.barcodes.get(unit.id);
                if (!freshUnit) throw new Error('La unidad ya no existe');
                if (freshUnit.used === true) throw new Error('Esta unidad ya fue vendida o trasladada');

                const freshProduct = await db.products.get(unit.productId);
                if (!freshProduct) throw new Error('Producto no encontrado');
                if (freshProduct.stock < 1) throw new Error('El producto no tiene stock disponible para trasladar');

                // Reservas pendientes (mismo criterio que StockAdjustModal en una salida)
                const newStock = freshProduct.stock - 1;
                const pendingCount = await db.reservations
                    .where('productId').equals(freshProduct.id)
                    .and(r => r.status === 'pending')
                    .count();
                if (newStock < pendingCount) {
                    throw new Error(`No se puede trasladar: existen ${pendingCount} reserva(s) pendientes`);
                }

                // Marcar la unidad como trasladada (no se borra físicamente)
                await db.barcodes.update(freshUnit.id, {
                    used: true,
                    transferStatus: 'traslado',
                    transferDate: getLocalISOString(),
                    transferTo: destino,
                });

                // Baja de stock en 1
                await db.products.update(freshProduct.id, { stock: newStock });

                // Movimiento de kardex contablemente neutro, auditado
                await db.kardex.add({
                    productId: freshProduct.id,
                    date: getLocalISOString(),
                    type: 'traslado',
                    qty: 1,
                    notes: ('TRASLADO A ' + destino + ' — ' + mot).toUpperCase(),
                    balanceAfter: newStock,
                    unitCodes: [{ shortCode: freshUnit.shortCode || '', barcode: freshUnit.barcode || '' }],
                    transferTo: destino,
                    userId: user?.id,
                });
            });

            showToast('Prenda trasladada con éxito ✓');
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto fade-in pb-40">
            {/* Cabecera */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white border flex items-center justify-center text-pink-500 shadow-sm">
                        <X size={18} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-pink-950 uppercase tracking-tight flex items-center gap-2">
                            <ArrowRightLeft size={22} className="text-amber-500" />
                            Trasladar a Sucursal
                        </h1>
                        <p className="text-pink-500 font-bold text-sm tracking-wide">
                            Salida neutra y auditada · la unidad se conserva marcada
                        </p>
                    </div>
                </div>
            </div>

            <div className="fashion-card p-8 space-y-8 border-2 border-pink-50">
                {/* Paso 1 — Buscar por código corto */}
                <div className="space-y-2">
                    <label className="text-xs font-black text-pink-900 uppercase tracking-widest">
                        Código corto de la unidad
                    </label>
                    <div className="flex gap-3">
                        <input
                            value={code}
                            onChange={e => handleCodeChange(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                            className="flex-1 fashion-input text-2xl font-black text-center tracking-[0.3em] py-5 border-pink-100 focus:border-amber-400 no-spinner"
                            placeholder="00000"
                            autoFocus
                        />
                        <button onClick={handleSearch} disabled={searching || !code.trim()}
                            className="px-6 bg-amber-500 text-white font-black rounded-2xl text-xs uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 hover:bg-amber-600 transition-colors">
                            <Search size={18} />
                            {searching ? 'Buscando...' : 'Buscar'}
                        </button>
                    </div>
                </div>

                {/* Error inline */}
                {error && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-red-50 border border-red-200 text-red-700">
                        <AlertTriangle size={16} className="shrink-0" />
                        {error}
                    </div>
                )}

                {/* Paso 2 — Confirmación visual del producto + datos del traslado */}
                {unit && product && (
                    <div className="space-y-6 fade-in">
                        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-amber-50 border-2 border-amber-100">
                            <Package size={22} className="text-amber-600 shrink-0" />
                            <div>
                                <p className="font-black text-amber-900">{product.name}</p>
                                <p className="text-xs font-bold text-amber-600">
                                    Cód: {unit.shortCode || '-'} · Stock actual: {product.stock}
                                    {[product.brand, product.size, product.color].filter(Boolean).length > 0 &&
                                        ` · ${[product.brand, product.size, product.color].filter(Boolean).join(' / ')}`}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-black text-pink-900 uppercase tracking-widest">
                                Sucursal destino
                            </label>
                            <input
                                value={sucursalDestino}
                                onChange={e => setSucursalDestino(e.target.value.toUpperCase())}
                                className="fashion-input font-bold text-pink-700 placeholder:text-pink-200"
                                placeholder="EJ: SUCURSAL CENTRO"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-black text-pink-900 uppercase tracking-widest">
                                Motivo
                            </label>
                            <input
                                value={motivo}
                                onChange={e => setMotivo(e.target.value.toUpperCase())}
                                className="fashion-input font-bold text-pink-700 placeholder:text-pink-200"
                                placeholder="EJ: REPOSICIÓN DE STOCK, PEDIDO DE CLIENTE..."
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer flotante */}
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-6 z-50">
                <div className="bg-white/80 backdrop-blur-2xl border-2 border-pink-100 p-4 rounded-[3rem] shadow-2xl flex gap-4">
                    <button onClick={onClose}
                        className="px-10 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-[2rem] text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors">
                        CANCELAR
                    </button>
                    <button onClick={handleConfirm} disabled={!canConfirm}
                        className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black py-5 rounded-[2rem] text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-40 disabled:hover:scale-100">
                        {saving ? 'TRASLADANDO...' : 'CONFIRMAR TRASLADO'}
                    </button>
                </div>
            </div>
        </div>
    );
}
