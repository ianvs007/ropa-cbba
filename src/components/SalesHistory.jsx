import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, syncClosureIfDateExists, getLocalISOString } from '../db';
import { ClipboardList, X, Printer, Filter, RotateCcw, XCircle, Package, CheckCircle, Tag, Receipt, DollarSign, TrendingUp, Wallet, CreditCard, User } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { printTicketGlobal, printCashClosuresReport } from '../utils';
import useSecureDate from '../hooks/useSecureDate';
import { useUser } from '../contexts/UserContext';
/**
 * SalesHistory — Historial de Caja (ventas, gastos y cierres)
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
    const [selectedSeller, setSelectedSeller] = React.useState('');
    const [tab, setTab] = React.useState('sales');
    const [showAnnulled, setShowAnnulled] = React.useState(false);
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

    const cashClosures = useLiveQuery(async () => {
        return await db.table('cashClosures').orderBy('closedAt').reverse().toArray();
    }, []);

    const enrichItems = React.useCallback((items, saleDate) => {
        if (!items || items.length === 0) return items;
        const saleMs = new Date(saleDate).getTime();
        const WINDOW_MS = 30000;
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
            const matchesEnriched = !matchesItems && enrichItems(s.items, s.date)?.some(it => {
                const codes = it.unitCodes || [];
                return codes.some(u =>
                    (u.shortCode && u.shortCode.toLowerCase().includes(q)) ||
                    (u.barcode && u.barcode.toLowerCase().includes(q))
                );
            });
            if (!matchesSale && !matchesItems && !matchesEnriched) return false;
        }
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

    // Lista única de vendedores que tienen cierres
    const closureSellers = React.useMemo(() => {
        const sellers = new Set();
        (cashClosures || []).forEach(c => {
            const name = c.closedBy || c.username;
            if (name) sellers.add(name);
        });
        return Array.from(sellers).sort();
    }, [cashClosures]);

    const filteredClosures = React.useMemo(() => {
        return (cashClosures || []).filter(c => {
            const d = c.date?.slice(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (selectedSeller) {
                const sellerName = (c.closedBy || c.username || '').toLowerCase();
                if (sellerName !== selectedSeller.toLowerCase()) return false;
            }
            if (search) {
                const q = search.toLowerCase();
                const sellerLabel = (c.closedBy || c.username || '').toLowerCase();
                if (!sellerLabel.includes(q) &&
                    !(c.notes || '').toLowerCase().includes(q) &&
                    !String(c.id || '').includes(q)) return false;
            }
            return true;
        });
    }, [cashClosures, search, dateFrom, dateTo, selectedSeller]);

    const handleAnnul = async (sale) => {
        if (sale.status === 'annulled') return;
        if (annulBusy) return;
        if (isManipulated) {
            alert(`⚠️ ALERTA DE SEGURIDAD\n\nSe detectó manipulación de fecha del Sistema Operativo.\n\nNo se permiten anulaciones hasta que se corrija.`);
            await logEvent('ANNULATION_BLOCKED_DUE_MANIPULATION', { saleId: sale.id, reason: 'OS date manipulation detected' });
            return;
        }
        const saleDate = sale.date?.slice(0, 10);
        if (saleDate !== frozenToday) {
            alert(`❌ NO SE PUEDE ANULAR\n\nLa venta #${sale.id} es de ${saleDate}.\n\nLas anulaciones SOLO se permiten el MISMO DÍA DE LA VENTA.`);
            await logEvent('ANNULATION_BLOCKED_WRONG_DATE', { saleId: sale.id, saleDate, frozenToday, attemptedBy: user?.username });
            return;
        }
        const sellerClosure = await db.table('cashClosures').where('date').equals(saleDate).filter(c => c.userId && c.userId.toString() === (sale.sellerId || '').toString()).first();
        if (sellerClosure && sellerClosure.closedAt) {
            alert(`❌ NO SE PUEDE ANULAR\n\nEsta venta pertenece al ${saleDate} que ya fue CERRADO definitivamente.`);
            await logEvent('ANNULATION_BLOCKED_CLOSED_CLOSURE', { saleId: sale.id, closureDate: saleDate, closedAt: sellerClosure.closedAt, attemptedBy: user?.username });
            return;
        }
        const confirmMsg = `¿Estás seguro de ANULAR la venta #${sale.id}?`;
        if (!confirm(confirmMsg)) return;
        setAnnulBusy(true);
        try {
            let abonosDates = [];
            if (sale.reservationId) {
                const abonos = await db.reservationPayments.where('reservationId').equals(sale.reservationId).toArray();
                abonosDates = [...new Set(abonos.map(p => p.date?.slice(0, 10)).filter(Boolean))];
            }
            await db.transaction('rw', db.products, db.kardex, db.sales, db.barcodes, db.reservationPayments, db.reservations, db.cashClosures, async () => {
                const enrichedItems = enrichItems(sale.items, sale.date) || [];
                for (const item of enrichedItems) {
                    const product = await db.products.get(item.productId);
                    if (product) {
                        const newStock = (product.stock || 0) + item.qty;
                        await db.products.update(item.productId, { stock: newStock });
                        const itemCodes = item.unitCodes || [];
                        const barcodesToRevert = [];
                        for (const uc of itemCodes) {
                            if (uc.barcode) {
                                const b = await db.barcodes.where('barcode').equals(uc.barcode).first();
                                if (b && b.used) barcodesToRevert.push(b);
                            }
                        }
                        if (barcodesToRevert.length === 0 && itemCodes.length === 0) {
                            const fallback = await db.barcodes.where('productId').equals(item.productId).and(b => b.used === true).limit(item.qty).toArray();
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
                await db.sales.update(sale.id, { status: 'annulled' });
                if (sale.reservationId) {
                    await db.reservationPayments.where('reservationId').equals(sale.reservationId).modify({ status: 'annulled' });
                    await db.reservations.update(sale.reservationId, { status: 'annulled', cancelledAt: getLocalISOString() });
                }
            });
            const sellerIdForSync = sale.sellerId || user?.id;
            await syncClosureIfDateExists(sale.date, sellerIdForSync, sale.shiftId);
            for (const abonoDate of abonosDates) {
                if (abonoDate !== sale.date?.slice(0, 10)) {
                    await syncClosureIfDateExists(abonoDate, sellerIdForSync);
                }
            }
            await logEvent('SALE_ANNULLED_SUCCESS', { saleId: sale.id, amount: sale.total, annulledBy: user?.username });
            showMsg('success', 'Venta anulada con éxito y stock restaurado.');
        } catch (err) {
            console.error("Error al anular venta:", err);
            showMsg('error', 'Error al procesar la anulación: ' + err.message);
        } finally {
            setAnnulBusy(false);
        }
    };

    const tabItems = [
        { id: 'sales', label: 'Ventas Directas', icon: ClipboardList },
        { id: 'payments', label: 'Abonos de Reservas', icon: Filter },
        { id: 'expenses', label: 'Gastos', icon: Receipt },
        ...(user?.role === 'admin' ? [{ id: 'closures', label: 'Cierres de Caja', icon: DollarSign }] : [])
    ];

    const placeholderText = tab === 'expenses'
        ? 'Buscar por # gasto, categoría o cajera...'
        : tab === 'closures'
            ? 'Buscar por # cierre, vendedor o comentario...'
            : 'Buscar por # venta, vendedor, producto o código corto...';

    const summaryLabel = tab === 'sales'
        ? 'VENTAS MOSTRADAS'
        : tab === 'payments'
            ? 'ABONOS MOSTRADOS'
            : tab === 'expenses'
                ? 'GASTOS MOSTRADOS'
                : 'CIERRES MOSTRADOS';

    const summaryCount = tab === 'sales'
        ? filtered.length
        : tab === 'payments'
            ? filteredPayments.length
            : tab === 'expenses'
                ? filteredExpenses.length
                : filteredClosures.length;

    const summaryAmount = tab === 'sales'
        ? totalRevenue.toFixed(2)
        : tab === 'payments'
            ? filteredPayments.reduce((s, x) => s + (x.amount || 0), 0).toFixed(2)
            : tab === 'expenses'
                ? totalExpensesAmount.toFixed(2)
                : filteredClosures.reduce((s, c) => s + (c.totalSales || 0), 0).toFixed(2);

    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-5 flex items-center gap-2">
                <ClipboardList size={24} strokeWidth={1.8} className="text-pink-600" />
                Historial de Caja
            </h1>

            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />} {msg.text}
                </div>
            )}

            <div className="flex gap-2 mb-4 flex-wrap">
                {tabItems.map(t => (
                    <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); setSelectedSeller(''); }}
                        className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border
                            ${tab === t.id 
                                ? 'bg-pink-600 border-pink-600 text-white shadow-lg' 
                                : 'bg-white border-pink-100 text-pink-400 hover:border-pink-300'}`}>
                        <t.icon size={16} />
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="fashion-card p-4 mb-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="fashion-input" placeholder="Desde" />
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="fashion-input" placeholder="Hasta" />
                    {tab === 'closures' && closureSellers.length > 0 && (
                        <div className="relative">
                            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 pointer-events-none" />
                            <select
                                value={selectedSeller}
                                onChange={e => setSelectedSeller(e.target.value)}
                                className="w-full fashion-input h-10 pl-9 text-sm"
                            >
                                <option value="">Todos los vendedores</option>
                                {closureSellers.map(seller => (
                                    <option key={seller} value={seller}>{seller}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className={`relative ${tab === 'closures' && closureSellers.length > 0 ? 'col-span-1' : 'col-span-2'}`}>
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder={placeholderText}
                            className="fashion-input" />
                    </div>
                </div>
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

            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="fashion-card p-4">
                    <p className="text-pink-500 text-xs font-medium mb-1">{summaryLabel}</p>
                    <p className="text-3xl font-black text-pink-900">{summaryCount}</p>
                </div>
                <div className="fashion-card p-4">
                    <p className="text-3xl font-black text-pink-600">{currency}{summaryAmount}</p>
                </div>
            </div>

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
                                    <tr><td colSpan={7} className="py-12 text-center text-pink-300">No hay ventas en el período seleccionado</td></tr>
                                ) : filtered.map(s => (
                                    <tr key={s.id} className="hover:bg-pink-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-pink-400">#{s.id}</td>
                                        <td className="px-4 py-3 text-xs text-pink-600">{new Date(s.date).toLocaleString()}</td>
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
                                                <p className="mt-1.5 pt-1.5 border-t border-pink-50 text-[10px] text-pink-500">Cliente: <b>{s.clientName}</b>{s.clientPhone ? ` — ${s.clientPhone}` : ''}</p>
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
                                                {s.paymentMethod === 'en_linea' || s.channel === 'venta_en_linea' ? (
                                                    <span className="w-fit rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-800">
                                                        Venta en línea
                                                    </span>
                                                ) : (
                                                    <span className="badge-blue capitalize w-fit">{s.paymentMethod}</span>
                                                )}
                                                {s.pedidoRefWeb && (
                                                    <span className="font-mono text-[10px] text-gray-500">#{s.pedidoRefWeb}</span>
                                                )}
                                                {s.deliveryStatus === 'pendiente_entrega' && s.status !== 'annulled' && (
                                                    <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                                                        Pendiente de entrega
                                                    </span>
                                                )}
                                                {s.deliveryStatus === 'entregado' && s.status !== 'annulled' && (
                                                    <span className="w-fit rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-bold uppercase text-green-800 flex items-center gap-0.5">
                                                        <CheckCircle size={10} /> Entregado
                                                    </span>
                                                )}
                                                {s.status === 'annulled' && (
                                                    <span className="text-[9px] font-bold text-red-600 flex items-center gap-0.5 uppercase"><XCircle size={10} /> Anulada</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-pink-700">{s.sellerName || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => {
                                                    const enriched = enrichItems(s.items, s.date);
                                                    printTicketGlobal(s.id, enriched, s.total, s.paymentMethod || 'historial', s.received || s.total, s.change || 0, { name: s.sellerName }, s.discount || 0, s.clientName ? { name: s.clientName, phone: s.clientPhone } : null);
                                                }} className="text-blue-500 hover:text-blue-700 transition-colors" title="Reimprimir Nota de Venta"><Printer size={15} /></button>
                                                {user?.role === 'admin' && (
                                                    <button
                                                        onClick={() => handleAnnul(s)}
                                                        disabled={s.status === 'annulled' || s.paymentMethod === 'en_linea' || s.channel === 'venta_en_linea'}
                                                        className={`transition-colors ${
                                                            s.status === 'annulled' || s.paymentMethod === 'en_linea' || s.channel === 'venta_en_linea'
                                                                ? 'text-gray-200 cursor-not-allowed'
                                                                : 'text-orange-400 hover:text-orange-600'
                                                        }`}
                                                        title={
                                                            s.paymentMethod === 'en_linea' || s.channel === 'venta_en_linea'
                                                                ? 'Las ventas en línea se cancelan desde la tienda web'
                                                                : 'Anular venta'
                                                        }
                                                    >
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
                                {filteredPayments.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-purple-300">No hay abonos registrados en este período</td></tr>
                                ) : filteredPayments.map(p => {
                                    const res = reservations?.find(r => r.id === p.reservationId);
                                    return (
                                        <tr key={p.id} className="hover:bg-purple-50/50 transition-colors">
                                            <td className="px-4 py-3 text-xs text-purple-600">{new Date(p.date).toLocaleString()}</td>
                                            <td className="px-4 py-3 font-bold text-purple-900">{res?.clientName || 'Desconocido'}</td>
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
                                            <td className="px-4 py-3 font-black text-green-600">{currency}{p.amount?.toFixed(2)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${p.paymentMethod === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                    {p.paymentMethod || 'Historial'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-purple-400 italic">{p.notes || '-'}</td>
                                            <td className="px-4 py-3 text-purple-700 text-xs">{p.registeredBy || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : tab === 'expenses' ? (
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
                                    <tr><td colSpan={7} className="py-12 text-center text-rose-300">No hay gastos registrados en el período seleccionado</td></tr>
                                ) : filteredExpenses.map(e => (
                                    <tr key={e.id} className="hover:bg-rose-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-rose-400">#{e.id}</td>
                                        <td className="px-4 py-3 text-xs text-rose-600">{new Date(e.date).toLocaleString()}</td>
                                        <td className="px-4 py-3"><span className="badge-rose">{categoriesMap[e.categoryId] || 'Sin categoría'}</span></td>
                                        <td className="px-4 py-3 text-rose-900 font-semibold">{e.description || '-'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${e.paymentMethod === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                {e.paymentMethod || 'efectivo'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-black text-red-600">{currency}{(e.amount || 0).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-rose-700 text-xs">{e.registeredBy || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-amber-50 text-amber-700 text-left">
                                    <th className="px-4 py-3 font-semibold">#</th>
                                    <th className="px-4 py-3 font-semibold">Fecha Cierre</th>
                                    <th className="px-4 py-3 font-semibold">Vendedor</th>
                                    <th className="px-4 py-3 font-semibold">Inicio / Cierre</th>
                                    <th className="px-4 py-3 font-semibold">Pagos</th>
                                    <th className="px-4 py-3 font-semibold">Diferencia</th>
                                    <th className="px-4 py-3 font-semibold">Comentarios</th>
                                    <th className="px-4 py-3 font-semibold">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-50">
                                {filteredClosures.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-amber-300">No hay cierres de caja en el período seleccionado</td></tr>
                                ) : filteredClosures.map(c => (
                                    <tr key={c.id} className="hover:bg-amber-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-amber-400">#{c.id}</td>
                                        <td className="px-4 py-3 text-xs text-amber-600">
                                            <div className="font-bold">{new Date(c.date + 'T12:00:00').toLocaleDateString('es')}</div>
                                            <div className="text-[10px] text-amber-400">{c.closedAt ? new Date(c.closedAt).toLocaleTimeString('es') : '-'}</div>
                                            {c.retroactive && <span className="text-[9px] bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded mt-1 inline-block">RETROACTIVO</span>}
                                        </td>
                                        <td className="px-4 py-3 text-amber-900 font-semibold text-xs">{c.closedBy || c.username || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="space-y-1 text-xs">
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-amber-500">Inicio:</span>
                                                    <span className="font-bold text-amber-800">{currency}{(c.cashStart || 0).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-amber-500">Cierre:</span>
                                                    <span className="font-bold text-amber-800">{currency}{(c.cashOnHand || 0).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4 border-t border-amber-100 pt-1 mt-1">
                                                    <span className="text-amber-500">Ventas:</span>
                                                    <span className="font-bold text-green-600">{currency}{(c.totalSales || 0).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-amber-500">Gastos:</span>
                                                    <span className="font-bold text-red-600">{currency}{(c.totalExpenses || 0).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="space-y-1 text-xs">
                                                <div className="flex items-center gap-1">
                                                    <Wallet size={10} className="text-green-600" />
                                                    <span className="text-amber-500">Efectivo:</span>
                                                    <span className="font-bold text-amber-800">{currency}{(c.totalCashIn || 0).toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <CreditCard size={10} className="text-blue-600" />
                                                    <span className="text-amber-500">QR/Banco:</span>
                                                    <span className="font-bold text-amber-800">{currency}{(c.totalQrIn || 0).toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <TrendingUp size={10} className="text-pink-600" />
                                                    <span className="text-amber-500">Trans:</span>
                                                    <span className="font-bold text-amber-800">{c.transactionCount || 0}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className={`text-sm font-black ${(c.cashDifference || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {(c.cashDifference || 0) >= 0 ? '+' : ''}{currency}{(c.cashDifference || 0).toFixed(2)}
                                            </div>
                                            <div className="text-[10px] text-amber-400">
                                                {(c.cashDifference || 0) > 0 ? 'Excedente' : (c.cashDifference || 0) < 0 ? 'Faltante' : 'Cuadrado'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-amber-700 max-w-xs">
                                            <p className="italic truncate" title={c.notes}>{c.notes || '-'}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => printCashClosuresReport([c], currency)}
                                                className="text-blue-500 hover:text-blue-700 transition-colors"
                                                title="Imprimir informe de cierre">
                                                <Printer size={15} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                {tab === 'closures' && filteredClosures.length > 0 && (
                    <div className="p-4 border-t border-amber-100 bg-amber-50/30">
                        <button
                            onClick={() => printCashClosuresReport(filteredClosures, currency)}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-bold rounded-xl hover:bg-amber-700 transition shadow-sm">
                            <Printer size={16} />
                            Imprimir Informe Completo de Cierres
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
