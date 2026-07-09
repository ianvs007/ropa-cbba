import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, syncClosureIfDateExists, getLocalISOString } from '../db';
import { ClipboardList, X, Printer, Filter, RotateCcw, XCircle, Package, CheckCircle, Tag, Receipt } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { printTicketGlobal } from '../utils';
import useSecureDate from '../hooks/useSecureDate';
import { useUser } from '../contexts/UserContext';
/**
 * SalesHistory — Historial de ventas y gastos por turno
 */
export default function SalesHistory() {
    const { user } = useUser();
    const { today: frozenToday, isManipulated, logEvent } = useSecureDate();
    
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const storeName = settings?.find(s => s.key === 'storeName')?.value || 'Tienda de Ropa';

    const [dateFrom, setDateFrom] = React.useState('');
    const [dateTo, setDateTo] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [tab, setTab] = React.useState('sales'); // 'sales' | 'payments' | 'expenses'
    const [showAnnulled, setShowAnnulled] = React.useState(false); // ── BUG FIX: Filtro para anuladas ──
    const [annulBusy, setAnnulBusy] = React.useState(false);
    const [msg, setMsg] = React.useState(null);

    const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000); };

    const sales = useLiveQuery(async () => {
        return await db.sales.orderBy('date').reverse().toArray();
    }, []);

    const allPayments = useLiveQuery(async () => {
        return await db.reservationPayments.orderBy('date').reverse().toArray();
    }, []);

    const allExpenses = useLiveQuery(async () => {
        return await db.expenses.orderBy('date').reverse().toArray();
    }, []);

    const expenseCategories = useLiveQuery(() => db.expenseCategories.toArray(), []);

    const reservations = useLiveQuery(() => db.reservations.toArray(), []);
    const allProducts = useLiveQuery(() => db.products.toArray(), []);
    const allKardex = useLiveQuery(() => db.kardex.toArray(), []) || [];

    /**
     * Enriquece los items de una venta con unitCodes del Kárdex
     * cuando los items no los tienen persistidos (ventas anteriores al fix).
     */
    const enrichItems = React.useCallback((items, saleDate) => {
        if (!items || items.length === 0) return items;
        const saleMs = new Date(saleDate).getTime();
        const WINDOW_MS = 30000; // ±30 segundos
        return items.map(it => {
            if (it.unitCodes && it.unitCodes.length > 0) return it;
            const kardexEntry = allKardex.find(k =>
                k.productId === it.productId &&
                k.type === 'salida' &&
                k.unitCodes && k.unitCodes.length > 0 &&
                Math.abs(new Date(k.date).getTime() - saleMs) <= WINDOW_MS
            );
            if (kardexEntry) return { ...it, unitCodes: kardexEntry.unitCodes };
            return it;
        });
    }, [allKardex]);

    const filtered = (sales || []).filter(s => {
        if (user?.role !== 'admin' && s.sellerName !== (user?.name || user?.username)) return false;
        const date = s.date?.slice(0, 10);
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
        if (search) {
            const q = search.toLowerCase();
            const matchesSale = s.sellerName?.toLowerCase().includes(q) || String(s.id).includes(q);
            const matchesItems = (s.items || []).some(it => {
                if (it.name?.toLowerCase().includes(q)) return true;
                const codes = it.unitCodes || [];
                return codes.some(u =>
                    (u.shortCode && u.shortCode.toLowerCase().includes(q)) ||
                    (u.barcode && u.barcode.toLowerCase().includes(q))
                );
            });
            // Fallback: también buscar en items enriquecidos con Kárdex
            const matchesEnriched = !matchesItems && enrichItems(s.items, s.date)?.some(it => {
                const codes = it.unitCodes || [];
                return codes.some(u =>
                    (u.shortCode && u.shortCode.toLowerCase().includes(q)) ||
                    (u.barcode && u.barcode.toLowerCase().includes(q))
                );
            });
            if (!matchesSale && !matchesItems && !matchesEnriched) return false;
        }
        // ── BUG FIX: Filtrar anuladas si el toggle está desactivado ──
        if (!showAnnulled && s.status === 'annulled') return false;
        return true;
    });

    const totalRevenue = filtered.filter(s => s.status !== 'annulled').reduce((s, sale) => s + (sale.total || 0), 0);

    const categoriesMap = React.useMemo(() => {
        const map = {};
        (expenseCategories || []).forEach(c => { map[c.id] = c.name; });
        return map;
    }, [expenseCategories]);

    const filteredExpenses = (allExpenses || []).filter(e => {
        if (e.status === 'annulled') return false;
        if (user?.role !== 'admin') {
            const uid = user?.id?.toString();
            const isOwnerById = e.userId !== undefined && e.userId !== null && e.userId.toString() === uid;
            const isOwnerByName = (e.registeredBy || '').toLowerCase() === ((user?.name || user?.username || '').toLowerCase());
            if (!isOwnerById && !isOwnerByName) return false;
        }
        const d = e.date?.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        if (search) {
            const q = search.toLowerCase();
            const catName = (categoriesMap[e.categoryId] || 'sin categoria').toLowerCase();
            if (!(e.description || '').toLowerCase().includes(q) &&
                !(e.registeredBy || '').toLowerCase().includes(q) &&
                !catName.includes(q) &&
                !String(e.id || '').includes(q)) return false;
        }
        return true;
    });

    const totalExpensesAmount = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // ── Filtro para pestaña Abonos de Reservas (con soporte de búsqueda) ──
    const filteredPayments = React.useMemo(() => {
        return (allPayments || []).filter(p => {
            if (p.status === 'annulled') return false;
            if (user?.role !== 'admin' && p.registeredBy !== (user?.name || user?.username)) return false;
            const d = p.date?.slice(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (search) {
                const q = search.toLowerCase();
                const res = reservations?.find(r => r.id === p.reservationId);
                const matchesPay = (p.registeredBy || '').toLowerCase().includes(q) ||
                    String(p.id || '').includes(q) ||
                    (p.notes || '').toLowerCase().includes(q);
                const matchesRes = res && (
                    (res.clientName || '').toLowerCase().includes(q) ||
                    (res.productName || '').toLowerCase().includes(q) ||
                    (res.productShortCode || '').toLowerCase().includes(q) ||
                    (res.productBarcode || '').toLowerCase().includes(q)
                );
                if (!matchesPay && !matchesRes) return false;
            }
            return true;
        });
    }, [allPayments, reservations, search, dateFrom, dateTo, user]);

    const handleAnnul = async (sale) => {
        if (sale.status === 'annulled') return;
        if (annulBusy) return;

        // ⚠️ ALERTA: Si hay manipulación de fecha de SO detectada
        if (isManipulated) {
            alert(`⚠️ ALERTA DE SEGURIDAD\n\nSe detectó manipulación de fecha del Sistema Operativo.\n\nNo se permiten anulaciones hasta que se corrija.`);
            await logEvent('ANNULATION_BLOCKED_DUE_MANIPULATION', {
                saleId: sale.id,
                reason: 'OS date manipulation detected',
            });
            return;
        }

        const saleDate = sale.date?.slice(0, 10);

        // ── SEGURIDAD 1: Solo permite anular ventas del DÍA ACTUAL (congelado) ──
        if (saleDate !== frozenToday) {
            alert(`❌ NO SE PUEDE ANULAR\n\n` +
                `La venta #${sale.id} es de ${saleDate}.\n\n` +
                `Las anulaciones SOLO se permiten el MISMO DÍA DE LA VENTA.\n\n` +
                `Contacta al administrador si necesitas una excepción.`);
            await logEvent('ANNULATION_BLOCKED_WRONG_DATE', {
                saleId: sale.id,
                saleDate,
                frozenToday,
                attemptedBy: user?.username,
            });
            return;
        }

        // ── SEGURIDAD 2: Bloquear si ya se cerró la caja del VENDEDOR de esa venta ──
        // Permite anular si el cierre está ABIERTO (reabierto)
        const sellerClosure = await db.table('cashClosures')
            .where('date').equals(saleDate)
            .filter(c => c.userId && c.userId.toString() === (sale.sellerId || '').toString())
            .first();
        if (sellerClosure && sellerClosure.closedAt) {
            // ← Cierre CERRADO: bloquear
            alert(`❌ NO SE PUEDE ANULAR\n\n` +
                `Esta venta pertenece al ${saleDate} que ya fue CERRADO definitivamente.\n\n` +
                `Opciones:\n` +
                `1. Contacta al admin para REABRIRSE el cierre\n` +
                `2. Si es error crítico, el admin puede hacer excepción`);
            await logEvent('ANNULATION_BLOCKED_CLOSED_CLOSURE', {
                saleId: sale.id,
                closureDate: saleDate,
                closedAt: sellerClosure.closedAt,
                attemptedBy: user?.username,
            });
            return;
        }

        const confirmMsg = `¿Estás seguro de ANULAR la venta #${sale.id}?
Esta acción:
1. Devolverá los productos al stock.
2. Registrará la devolución en el Kardex.
3. El monto se restará de tus reportes de ingresos.${sale.reservationId ? '\n4. Los abonos de esta reserva también se anularán.' : ''}`;

        if (!confirm(confirmMsg)) return;

        setAnnulBusy(true);
        try {
            // Recopilar fechas de abonos ANTES de la transacción (para sincronizar cierres después)
            let abonosDates = [];
            if (sale.reservationId) {
                const abonos = await db.reservationPayments
                    .where('reservationId').equals(sale.reservationId).toArray();
                abonosDates = [...new Set(abonos.map(p => p.date?.slice(0, 10)).filter(Boolean))];
            }

            await db.transaction('rw', db.products, db.kardex, db.sales, db.barcodes, db.reservationPayments, db.reservations, db.cashClosures, async () => {
                // Enriquecer items con unitCodes del Kárdex para ventas antiguas
                const enrichedItems = enrichItems(sale.items, sale.date) || [];

                // 1. Devolver productos al stock, registrar Kardex y revertir barcodes exactos
                for (const item of enrichedItems) {
                    const product = await db.products.get(item.productId);
                    if (product) {
                        const newStock = (product.stock || 0) + item.qty;
                        await db.products.update(item.productId, { stock: newStock });

                        // Revertir barcodes: usar unitCodes exactos si están disponibles
                        const itemCodes = item.unitCodes || [];
                        const barcodesToRevert = [];
                        for (const uc of itemCodes) {
                            if (uc.barcode) {
                                const b = await db.barcodes.where('barcode').equals(uc.barcode).first();
                                if (b && b.used) barcodesToRevert.push(b);
                            }
                        }
                        // Fallback: si no hay unitCodes guardados, buscar por productId
                        if (barcodesToRevert.length === 0 && itemCodes.length === 0) {
                            const fallback = await db.barcodes
                                .where('productId').equals(item.productId)
                                .and(b => b.used === true)
                                .limit(item.qty)
                                .toArray();
                            barcodesToRevert.push(...fallback);
                        }
                        for (const b of barcodesToRevert) {
                            await db.barcodes.update(b.id, { used: false });
                        }

                        await db.kardex.add({
                            productId: item.productId,
                            date: getLocalISOString(),
                            type: 'entrada',
                            qty: item.qty,
                            notes: `ANULACIÓN VENTA #${sale.id}`,
                            balanceAfter: newStock,
                            unitCodes: barcodesToRevert.map(b => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' })),
                        });
                    }
                }

                // 2. Marcar venta como anulada
                await db.sales.update(sale.id, { status: 'annulled' });

                // 3. ── CASCADE: Si era una reserva, anular abonos y la reserva en sí ──
                if (sale.reservationId) {
                    await db.reservationPayments
                        .where('reservationId')
                        .equals(sale.reservationId)
                        .modify({ status: 'annulled' });

                    await db.reservations.update(sale.reservationId, { 
                        status: 'annulled', // Nuevo estado para indicar que la entrega fue anulada
                        cancelledAt: getLocalISOString()
                    });
                }
            });
            
            // 4. Sincronizar cierre de caja del VENDEDOR que hizo la venta (no del admin que anula)
            const sellerIdForSync = sale.sellerId || user?.id;
            await syncClosureIfDateExists(sale.date, sellerIdForSync, sale.shiftId);

            // 4b. Si era reserva, sincronizar cierres de las fechas de abonos anteriores
            for (const abonoDate of abonosDates) {
                if (abonoDate !== sale.date?.slice(0, 10)) {
                    await syncClosureIfDateExists(abonoDate, sellerIdForSync);
                }
            }
            
            // 5. Registrar en seguridad
            await logEvent('SALE_ANNULLED_SUCCESS', {
                saleId: sale.id,
                amount: sale.total,
                annulledBy: user?.username,
            });

            showMsg('success', 'Venta anulada con éxito y stock restaurado.');
        } catch (err) {
            console.error("Error al anular venta:", err);
            showMsg('error', 'Error al procesar la anulación: ' + err.message);
        } finally {
            setAnnulBusy(false);
        }
    };

    // --- Función para imprimir movida a utilitarios globales ---



    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-5 flex items-center gap-2">
                <ClipboardList size={24} strokeWidth={1.8} className="text-pink-600" />
                Historial de ventas y gastos
            </h1>

            {/* Notificación */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {msg.text}
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
                {[
                    { id: 'sales', label: 'Ventas Directas', icon: ClipboardList },
                    { id: 'payments', label: 'Abonos de Reservas', icon: Filter },
                    { id: 'expenses', label: 'Gastos', icon: Receipt }
                ].map(t => (
                    <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
                        className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border
                            ${tab === t.id 
                                ? 'bg-pink-600 border-pink-600 text-white shadow-lg' 
                                : 'bg-white border-pink-100 text-pink-400 hover:border-pink-300'}`}>
                        <t.icon size={16} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Filtros */}
            <div className="fashion-card p-4 mb-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="fashion-input" placeholder="Desde" />
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="fashion-input" placeholder="Hasta" />
                    <div className="relative col-span-2">
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder={tab === 'expenses' ? 'Buscar por # gasto, categoría o cajera...' : 'Buscar por # venta, vendedor, producto o código corto...'}
                            className="fashion-input" />
                    </div>
                </div>
                {/* ── BUG FIX: Toggle para mostrar/ocultar anuladas ── */}
                {tab === 'sales' && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-pink-100">
                        <input 
                            type="checkbox" 
                            id="show-annulled"
                            checked={showAnnulled}
                            onChange={e => setShowAnnulled(e.target.checked)}
                            className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                        />
                        <label htmlFor="show-annulled" className="text-sm text-pink-700 font-medium">
                            Mostrar ventas anuladas ({(sales || []).filter(s => s.status === 'annulled').length})
                        </label>
                    </div>
                )}
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="fashion-card p-4">
                    <p className="text-pink-500 text-xs font-medium mb-1">
                        {tab === 'sales' ? 'VENTAS MOSTRADAS' : tab === 'payments' ? 'ABONOS MOSTRADOS' : 'GASTOS MOSTRADOS'}
                    </p>
                    <p className="text-3xl font-black text-pink-900">
                        {tab === 'sales' ? filtered.length : tab === 'payments'
                            ? filteredPayments.length
                            : filteredExpenses.length}
                    </p>
                </div>
                <div className="fashion-card p-4">
                    <p className="text-3xl font-black text-pink-600">
                        {currency}{tab === 'sales'
                            ? totalRevenue.toFixed(2)
                            : tab === 'payments'
                                ? filteredPayments.reduce((s, x) => s + (x.amount || 0), 0).toFixed(2)
                                : totalExpensesAmount.toFixed(2)}
                    </p>
                </div>
            </div>

            {/* Tabla */}
            <div className="fashion-card overflow-hidden">
                <div className="overflow-x-auto">
                    {tab === 'sales' ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-pink-50 text-pink-700 text-left">
                                    <th className="px-4 py-3 font-semibold">#</th>
                                    <th className="px-4 py-3 font-semibold">Fecha</th>
                                    <th className="px-4 py-3 font-semibold">Producto</th>
                                    <th className="px-4 py-3 font-semibold">Total</th>
                                    <th className="px-4 py-3 font-semibold">Pago</th>
                                    <th className="px-4 py-3 font-semibold">Vendedor</th>
                                    <th className="px-4 py-3 font-semibold">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-pink-50">
                                {filtered.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-pink-300">
                                        No hay ventas en el período seleccionado
                                    </td></tr>
                                ) : filtered.map(s => (
                                    <tr key={s.id} className="hover:bg-pink-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-pink-400">#{s.id}</td>
                                        <td className="px-4 py-3 text-xs text-pink-600">
                                            {new Date(s.date).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            {enrichItems(s.items, s.date).map((it, idx) => {
                                                const codes = it.unitCodes || [];
                                                const shortCodes = codes.map(u => u.shortCode).filter(Boolean);
                                                const eans = codes.map(u => u.barcode).filter(Boolean);
                                                return (
                                                    <div key={idx} className={idx > 0 ? 'mt-2 pt-2 border-t border-pink-50' : ''}>
                                                        <p className="font-bold text-pink-900 text-xs uppercase leading-tight">{it.name} {it.qty > 1 ? `(x${it.qty})` : ''}</p>
                                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                                            {it.size && <span className="text-[10px] text-pink-500">Talla: <b>{it.size}</b></span>}
                                                            {it.color && <span className="text-[10px] text-pink-500">Color: <b>{it.color}</b></span>}
                                                        </div>
                                                        {(shortCodes.length > 0 || eans.length > 0) && (
                                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                                {shortCodes.map((sc, i) => <span key={i} className="text-[9px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">C.Corto: {sc}</span>)}
                                                                {eans.map((ean, i) => <span key={i} className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">Cód. Barras: {ean}</span>)}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {s.clientName && (
                                                <p className="mt-1.5 pt-1.5 border-t border-pink-50 text-[10px] text-pink-500">
                                                    Cliente: <b>{s.clientName}</b>{s.clientPhone ? ` — ${s.clientPhone}` : ''}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-pink-800">
                                            {currency}{s.total?.toFixed(2)}
                                            {s.discount > 0 && (
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <Tag size={10} className="text-amber-500" />
                                                    <span className="text-[10px] font-bold text-amber-600">-{currency}{s.discount?.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-1">
                                                <span className="badge-blue capitalize w-fit">{s.paymentMethod}</span>
                                                {s.status === 'annulled' && (
                                                    <span className="text-[9px] font-bold text-red-600 flex items-center gap-0.5 uppercase">
                                                        <XCircle size={10} /> Anulada
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-pink-700">{s.sellerName || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => {
                                                    const enriched = enrichItems(s.items, s.date);
                                                    printTicketGlobal(
                                                        s.id, enriched, s.total, s.paymentMethod || 'historial',
                                                        s.received || s.total, s.change || 0,
                                                        { name: s.sellerName },
                                                        s.discount || 0,
                                                        s.clientName ? { name: s.clientName, phone: s.clientPhone } : null
                                                    );
                                                }}
                                                    className="text-blue-500 hover:text-blue-700 transition-colors"
                                                    title="Reimprimir Nota de Venta">
                                                    <Printer size={15} />
                                                </button>
                                                {user?.role === 'admin' && (
                                                    <button 
                                                        onClick={() => handleAnnul(s)}
                                                        disabled={s.status === 'annulled'}
                                                        className={`transition-colors ${s.status === 'annulled' ? 'text-gray-200 cursor-not-allowed' : 'text-orange-400 hover:text-orange-600'}`}
                                                        title="Anular venta">
                                                        <RotateCcw size={15} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : tab === 'payments' ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-purple-50 text-purple-700 text-left">
                                    <th className="px-4 py-3 font-semibold">Fecha</th>
                                    <th className="px-4 py-3 font-semibold">Cliente</th>
                                    <th className="px-4 py-3 font-semibold">Producto</th>
                                    <th className="px-4 py-3 font-semibold">Monto</th>
                                    <th className="px-4 py-3 font-semibold">Método</th>
                                    <th className="px-4 py-3 font-semibold">Nota</th>
                                    <th className="px-4 py-3 font-semibold">Cajera</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-purple-50">
                                {(() => {
                                    return filteredPayments.length === 0 ? (
                                        <tr><td colSpan={7} className="py-12 text-center text-purple-300">
                                            No hay abonos registrados en este período
                                        </td></tr>
                                    ) : filteredPayments.map(p => {
                                        const res = reservations?.find(r => r.id === p.reservationId);
                                        return (
                                            <tr key={p.id} className="hover:bg-purple-50/50 transition-colors">
                                                <td className="px-4 py-3 text-xs text-purple-600">
                                                    {new Date(p.date).toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 font-bold text-purple-900">
                                                    {res?.clientName || 'Desconocido'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {res ? (
                                                        <div>
                                                            <p className="font-bold text-purple-900 text-xs uppercase leading-tight">{res.productName}</p>
                                                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                                                {res.productSize && <span className="text-[10px] text-purple-500">Talla: <b>{res.productSize}</b></span>}
                                                                {res.productColor && <span className="text-[10px] text-purple-500">Color: <b>{res.productColor}</b></span>}
                                                            </div>
                                                            {res.productShortCode && (
                                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                                    <span className="text-[9px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">Cód.Ref: {res.productShortCode}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : <span className="text-xs text-purple-300 italic">—</span>}
                                                </td>
                                                <td className="px-4 py-3 font-black text-green-600">
                                                    {currency}{p.amount?.toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                                                        ${p.paymentMethod === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                        {p.paymentMethod || 'Historial'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-purple-400 italic">
                                                    {p.notes || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-purple-700 text-xs">
                                                    {p.registeredBy || '-'}
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-rose-50 text-rose-700 text-left">
                                    <th className="px-4 py-3 font-semibold">#</th>
                                    <th className="px-4 py-3 font-semibold">Fecha</th>
                                    <th className="px-4 py-3 font-semibold">Categoría</th>
                                    <th className="px-4 py-3 font-semibold">Descripción</th>
                                    <th className="px-4 py-3 font-semibold">Método</th>
                                    <th className="px-4 py-3 font-semibold">Monto</th>
                                    <th className="px-4 py-3 font-semibold">Cajera</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-rose-50">
                                {filteredExpenses.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-rose-300">
                                        No hay gastos registrados en el período seleccionado
                                    </td></tr>
                                ) : filteredExpenses.map(e => (
                                    <tr key={e.id} className="hover:bg-rose-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-rose-400">#{e.id}</td>
                                        <td className="px-4 py-3 text-xs text-rose-600">
                                            {new Date(e.date).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="badge-rose">{categoriesMap[e.categoryId] || 'Sin categoría'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-rose-900 font-semibold">
                                            {e.description || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                                                ${e.paymentMethod === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                {e.paymentMethod || 'efectivo'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-black text-red-600">
                                            {currency}{(e.amount || 0).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-rose-700 text-xs">
                                            {e.registeredBy || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

