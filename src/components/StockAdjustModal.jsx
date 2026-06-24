import React from 'react';
import { X } from 'lucide-react';
import { db, generateBarcodesForProduct, getLocalISOString } from '../db';

/**
 * 📦 StockAdjustModal — Pantalla completa de suministro / ajuste de stock
 *
 * @prop {Object}   product     - Producto a ajustar
 * @prop {Object}   reservedMap - { [productId]: cantidad } de reservas pendientes
 * @prop {Function} onClose     - Callback para cerrar la pantalla
 * @prop {Function} showToast   - Callback para notificaciones
 */
export default function StockAdjustModal({ product, reservedMap, onClose, showToast }) {
    const [adjQty, setAdjQty] = React.useState('');
    const [adjNote, setAdjNote] = React.useState('');
    const [adjType, setAdjType] = React.useState('entrada');

    const reservedCount = reservedMap[product.id] || 0;

    const handleAdjust = async () => {
        const qty = parseInt(adjQty);
        if (!qty || qty <= 0) return;

        try {
            await db.transaction('rw', db.products, db.kardex, db.barcodes, db.reservations, async () => {
                const freshProduct = await db.products.get(product.id);
                if (!freshProduct) throw new Error('Producto no encontrado');

                const newStock = adjType === 'entrada'
                    ? freshProduct.stock + qty
                    : freshProduct.stock - qty;

                if (newStock < 0) throw new Error('El stock no puede quedar negativo');
                if (adjType === 'salida') {
                    // Leer reservas pendientes DENTRO de la transacción para dato preciso
                    const pendingCount = await db.reservations
                        .where('productId').equals(product.id)
                        .and(r => r.status === 'pending')
                        .count();
                    if (newStock < pendingCount) {
                        throw new Error(`No se puede ajustar: existen ${pendingCount} reserva(s) pendientes`);
                    }
                }

                await db.products.update(product.id, { stock: newStock });

                // Calcular unitCodes ANTES de escribir el kardex para registrar los códigos exactos
                let unitCodes = [];
                if (adjType === 'entrada') {
                    // generateBarcodesForProduct devuelve [{barcode, shortCode}]
                    unitCodes = await generateBarcodesForProduct(product.id, qty);
                } else {
                    const toDelete = await db.barcodes
                        .where('productId').equals(product.id)
                        .and(b => !b.used)
                        .reverse()
                        .limit(qty)
                        .toArray();
                    unitCodes = toDelete.map(b => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' }));
                    for (const b of toDelete) await db.barcodes.delete(b.id);
                }

                await db.kardex.add({
                    productId: product.id,
                    date: getLocalISOString(),
                    type: adjType,
                    qty,
                    notes: (adjNote.trim() || 'SUMINISTRO/AJUSTE MANUAL').toUpperCase(),
                    balanceAfter: newStock,
                    unitCodes,
                });
            });

            showToast('Stock actualizado con éxito ✓');
            onClose();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    return (
        <div className="max-w-5xl mx-auto fade-in pb-72">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white border flex items-center justify-center text-pink-500 shadow-sm">
                        <X size={18} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-pink-950 uppercase tracking-tight">Suministro / Ajuste</h1>
                        <p className="text-pink-500 font-bold text-sm tracking-wide">{product.name}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {/* Stock actual */}
                <div className="fashion-card p-10 bg-pink-50/40 border-2 border-pink-100/50 flex flex-col justify-center items-center text-center">
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
                </div>

                {/* Formulario de ajuste */}
                <div className="fashion-card p-10 space-y-8 border-2 border-pink-50">
                    <div className="flex flex-col gap-4">
                        <p className="text-xs font-black text-pink-800 uppercase tracking-widest text-center">Tipo de Movimiento</p>
                        <div className="grid grid-cols-2 gap-4">
                            {[['entrada', '📥 Entrada', 'green'], ['salida', '📤 Salida', 'rose']].map(([type, label, color]) => (
                                <button key={type} onClick={() => setAdjType(type)}
                                    className={`py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest border-2 transition-all active:scale-95
                                        ${adjType === type
                                            ? `border-${color}-500 bg-${color}-50 text-${color}-700 shadow-lg shadow-${color}-100`
                                            : 'border-pink-50 bg-white text-gray-300 opacity-60'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2 text-center">
                        <label className="text-xs font-black text-pink-900 uppercase tracking-widest">
                            Cantidad a {adjType === 'entrada' ? 'Sumar' : 'Restar'}
                        </label>
                        <input
                            type="number" value={adjQty} onChange={e => setAdjQty(e.target.value)}
                            className="w-full fashion-input text-5xl font-black text-center py-8 border-pink-100 focus:border-pink-500 no-spinner"
                            placeholder="0" autoFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-pink-900 uppercase tracking-widest text-center block">Motivo / Nota</label>
                        <input
                            value={adjNote} onChange={e => setAdjNote(e.target.value.toUpperCase())}
                            className="fashion-input text-center font-bold text-pink-700 placeholder:text-pink-100"
                            placeholder="EJ: NUEVA MERCADERÍA, CORRECCIÓN..."
                        />
                    </div>
                </div>
            </div>

            {/* Footer flotante */}
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 z-50">
                <div className="bg-white/80 backdrop-blur-2xl border-2 border-pink-100 p-4 rounded-[3rem] shadow-2xl flex gap-4">
                    <button onClick={onClose}
                        className="px-10 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-[2rem] text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors">
                        CANCELAR
                    </button>
                    <button onClick={handleAdjust}
                        className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black py-5 rounded-[2rem] text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all">
                        CONFIRMAR CAMBIO
                    </button>
                </div>
            </div>
        </div>
    );
}
