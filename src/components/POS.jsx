import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { db, syncClosureIfDateExists, getLocalISOString } from '../db';
import { printTicketGlobal, formatCurrency } from '../utils';
import { useAvailableStock } from '../hooks/useAvailableStock';
import { useLiveQuery } from 'dexie-react-hooks';
import useCashRegister from '../hooks/useCashRegister';
import { useUser } from '../contexts/UserContext';

import ProductSearch from './pos/ProductSearch';
import CartPanel from './pos/CartPanel';
import PaymentPanel from './pos/PaymentPanel';

/**
 * 🛒 POS — Punto de Venta
 * Orquesta el buscador, el carrito y el panel de cobro.
 * Aplica rebaja máxima configurable (maxDiscount) por ítem.
 */
export default function POS() {
    const { user } = useUser();
    const [cart, setCart] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [success, setSuccess] = React.useState(false);
    const [error, setError] = React.useState('');
    const [scanFlash, setScanFlash] = React.useState(false);

    const { shiftId } = useCashRegister();
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const reservedMap = useAvailableStock();

    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    // Rebaja máxima por ítem (en Bs.); valor 0 = solo limita a costo
    const maxDiscount = parseFloat(settings?.find(s => s.key === 'maxDiscount')?.value || '10');

    // ── Agregar al carrito con validación de stock disponible ──
    const addToCart = React.useCallback((product, searchedCode) => {
        const available = product.stock - (reservedMap[product.id] || 0);
        if (available <= 0) {
            setError(`Sin stock disponible para "${product.name}"`);
            return;
        }
        setCart(prev => {
            const idx = prev.findIndex(i => i.productId === product.id);
            if (idx >= 0) {
                const updated = [...prev];
                if (updated[idx].qty >= available) {
                    setError('No hay más unidades disponibles');
                    return prev;
                }
                // Acumular código preferido si no está ya en la lista
                const prevCodes = [...(updated[idx].preferredUnitCodes || [])];
                if (searchedCode && !prevCodes.includes(searchedCode)) {
                    prevCodes.push(searchedCode);
                }
                updated[idx] = { ...updated[idx], qty: updated[idx].qty + 1, preferredUnitCodes: prevCodes };
                return updated;
            }
            return [...prev, {
                productId: product.id,
                name: product.name,
                size: product.size,
                color: product.color,
                price: product.price,
                originalPrice: product.price,
                cost: product.cost || 0,
                qty: 1,
                stock: product.stock,
                photo: product.photo,
                preferredUnitCodes: searchedCode ? [searchedCode] : [],
            }];
        });
        setError('');
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
    }, [reservedMap]);

    const updateQty = (productId, delta) => {
        setCart(prev => prev.map(i => {
            if (i.productId !== productId) return i;
            const newQty = i.qty + delta;
            if (newQty < 1) return null;
            const available = i.stock - (reservedMap[i.productId] || 0);
            if (newQty > available) { setError('Stock insuficiente (considerando reservas)'); return i; }
            return { ...i, qty: newQty };
        }).filter(Boolean));
    };

    const removeItem = (productId) => setCart(prev => prev.filter(i => i.productId !== productId));

    /**
     * Actualiza el precio con validaciones:
     * 1. No puede ser negativo ni cero.
     * 2. No puede ser menor o igual al costo del producto.
     * 3. No puede superar la rebaja máxima configurada (maxDiscount).
     */
    const updatePrice = (productId, newPriceStr) => {
        const val = Math.round(parseFloat(newPriceStr) * 100) / 100;
        if (isNaN(val) || val <= 0) {
            setError('El precio debe ser mayor a 0');
            return;
        }
        setCart(prev => prev.map(i => {
            if (i.productId !== productId) return i;

            // Validación 1: precio no puede ser menor o igual al costo
            if (val <= i.cost) {
                setError(`El precio no puede ser igual o menor al costo (${formatCurrency(i.cost, currency)})`);
                return i;
            }

            // Validación 2: rebaja máxima permitida
            const discount = i.originalPrice - val;
            if (maxDiscount > 0 && discount > maxDiscount) {
                setError(`Rebaja máxima permitida: ${formatCurrency(maxDiscount, currency)} por ítem`);
                return i;
            }

            setError('');
            return { ...i, price: val };
        }));
    };

    const handleSale = async ({ payment, received }) => {
        if (cart.length === 0) return;
        setLoading(true); setError('');
        try {
            // ── Validación previa de stock (lectura rápida antes de la transacción) ──
            const currentReservations = await db.reservations.where('status').equals('pending').toArray();
            const liveReservedMap = {};
            currentReservations.forEach(r => { liveReservedMap[r.productId] = (liveReservedMap[r.productId] || 0) + 1; });

            for (const item of cart) {
                const product = await db.products.get(item.productId);
                if (!product) throw new Error(`Producto "${item.name}" ya no existe`);
                const available = product.stock - (liveReservedMap[item.productId] || 0);
                if (available < item.qty) throw new Error(`Stock insuficiente para "${item.name}": solo hay ${available} disponible(s)`);

                if (item.price <= item.cost) {
                    throw new Error(`El precio de "${item.name}" no puede ser igual o menor al costo`);
                }
            }

            const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
            const originalTotal = cart.reduce((s, i) => s + i.originalPrice * i.qty, 0);
            const totalDiscount = Math.round((originalTotal - total) * 100) / 100;

            const nowAdjusted = getLocalISOString();

            // ── TRANSACCIÓN ATÓMICA: Descontar stock + registrar venta en una sola operación ──
            const { saleId, cartWithCodes } = await db.transaction('rw',
                db.sales, db.products, db.kardex, db.barcodes, async () => {
                    const unitCodesMap = {};

                    for (const item of cart) {
                        const product = await db.products.get(item.productId);
                        if (!product) throw new Error(`Producto "${item.name}" ya no existe`);
                        if (product.stock < item.qty) throw new Error(`Stock insuficiente para "${product.name}"`);

                        await db.products.update(item.productId, { stock: product.stock - item.qty });

                        // Priorizar barcodes que el vendedor buscó específicamente
                        const preferred = item.preferredUnitCodes || [];
                        let barcodesToUse = [];

                        if (preferred.length > 0) {
                            // Buscar los barcodes preferidos (por shortCode o barcode, match exacto o parcial)
                            for (const code of preferred) {
                                // Intentar match exacto primero
                                let match = await db.barcodes
                                    .where('productId').equals(item.productId)
                                    .and(b => !b.used && (b.shortCode === code || b.barcode === code))
                                    .first();
                                // Si no hay exacto, buscar parcial (vendedor escribió sin ceros)
                                if (!match) {
                                    match = await db.barcodes
                                        .where('productId').equals(item.productId)
                                        .and(b => !b.used &&
                                            ((b.shortCode && b.shortCode.includes(code)) ||
                                             (b.barcode && b.barcode.includes(code))))
                                        .first();
                                }
                                if (match && !barcodesToUse.find(x => x.id === match.id)) {
                                    barcodesToUse.push(match);
                                }
                            }
                            // Completar con barcodes no preferidos si faltan unidades
                            if (barcodesToUse.length < item.qty) {
                                const usedIds = new Set(barcodesToUse.map(b => b.id));
                                const extras = await db.barcodes
                                    .where('productId').equals(item.productId)
                                    .and(b => !b.used && !usedIds.has(b.id))
                                    .limit(item.qty - barcodesToUse.length)
                                    .toArray();
                                barcodesToUse.push(...extras);
                            }
                        } else {
                            barcodesToUse = await db.barcodes
                                .where('productId').equals(item.productId)
                                .and(b => !b.used)
                                .limit(item.qty)
                                .toArray();
                        }

                        for (const b of barcodesToUse) {
                            await db.barcodes.update(b.id, { used: true });
                        }

                        const codes = barcodesToUse.map(b => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' }));
                        unitCodesMap[item.productId] = codes;

                        await db.kardex.add({
                            productId: item.productId,
                            date: nowAdjusted,
                            type: 'salida',
                            qty: item.qty,
                            notes: 'Venta',
                            balanceAfter: product.stock - item.qty,
                            unitCodes: codes,
                        });
                    }

                    const itemsWithCodes = cart.map(item => ({
                        ...item,
                        unitCodes: unitCodesMap[item.productId] || [],
                    }));

                    const id = await db.sales.add({
                        date: nowAdjusted,
                        items: itemsWithCodes,
                        total,
                        originalTotal: originalTotal !== total ? originalTotal : undefined,
                        discount: totalDiscount > 0 ? totalDiscount : undefined,
                        paymentMethod: payment,
                        received: payment === 'efectivo' ? received : total,
                        change: payment === 'efectivo' ? Math.max(0, received - total) : 0,
                        sellerId: user?.id,
                        sellerName: user?.name || user?.username,
                        shiftId: shiftId || undefined,
                    });

                    return { saleId: id, cartWithCodes: itemsWithCodes };
                });

            await syncClosureIfDateExists(nowAdjusted, user?.id, shiftId);
            printTicketGlobal(saleId, cartWithCodes, total, payment, received, received - total, user, totalDiscount);

            setCart([]);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            setError(err.message || 'Error al registrar la venta');
        } finally {
            setLoading(false);
        }
    };

    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const originalTotal = cart.reduce((s, i) => s + i.originalPrice * i.qty, 0);
    const totalDiscount = Math.round((originalTotal - total) * 100) / 100;

    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-4 flex items-center gap-2">
                <ShoppingCart size={24} strokeWidth={1.8} className="text-pink-600" />
                Punto de Venta
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Buscador + Carrito */}
                <div className="lg:col-span-7 xl:col-span-8 space-y-3">
                    <ProductSearch
                        currency={currency}
                        onAdd={addToCart}
                        scanFlash={scanFlash}
                        onError={setError}
                    />
                    <CartPanel
                        cart={cart}
                        currency={currency}
                        maxDiscount={maxDiscount}
                        onQtyChange={updateQty}
                        onRemove={removeItem}
                        onPriceEdit={updatePrice}
                        onError={setError}
                    />
                </div>

                {/* Panel de cobro */}
                <div className="lg:col-span-5 xl:col-span-4">
                    <PaymentPanel
                        total={total}
                        totalDiscount={totalDiscount}
                        currency={currency}
                        cart={cart}
                        loading={loading}
                        success={success}
                        error={error}
                        onSell={handleSale}
                        onClear={() => setCart([])}
                    />
                </div>
            </div>
        </div>
    );
}
