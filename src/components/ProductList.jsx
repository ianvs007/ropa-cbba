import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateUniqueBarcode, generateShortCode } from '../db';
import { Plus, Edit2, Package, XCircle } from 'lucide-react';

import { useAvailableStock } from '../hooks/useAvailableStock';
import ProductForm, { EMPTY } from './ProductForm';
import StockAdjustModal from './StockAdjustModal';

/**
 * 🛍️ ProductList — Catálogo de productos
 * Orquesta el listado, el formulario de alta/edición y el modal de ajuste de stock.
 */
export default function ProductList() {
    const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const categoriesDB = useLiveQuery(() => db.categories.toArray(), []) || [];
    const productNamesDB = useLiveQuery(() => db.productNames.toArray(), []) || [];
    const productFieldsDB = useLiveQuery(() => db.productFields.toArray(), []) || [];
    const brandsDB = useLiveQuery(() => db.brands.toArray(), []) || [];
    const colorsDB = useLiveQuery(() => db.colors.toArray(), []) || [];
    const allBarcodes = useLiveQuery(() => db.barcodes.toArray(), []) || [];
    const pendingReservations = useLiveQuery(() => db.reservations.where('status').equals('pending').toArray(), []) || [];

    // Set de shortCodes reservados por reservas pendientes
    const reservedUnitCodes = React.useMemo(() => {
        return new Set(pendingReservations.filter(r => r.productShortCode).map(r => r.productShortCode));
    }, [pendingReservations]);

    // Mapa productId → shortCodes de unidades DISPONIBLES (no vendidas, no reservadas)
    const availableUnitCodesMap = React.useMemo(() => {
        const m = {};
        allBarcodes.filter(b => !b.used && b.shortCode && !reservedUnitCodes.has(b.shortCode)).forEach(b => {
            if (!m[b.productId]) m[b.productId] = [];
            m[b.productId].push(b.shortCode);
        });
        return m;
    }, [allBarcodes, reservedUnitCodes]);

    // Mapa productId → EAN/barcode de unidades DISPONIBLES (no vendidas, no reservadas)
    const availableUnitEANsMap = React.useMemo(() => {
        const m = {};
        allBarcodes.filter(b => !b.used && b.barcode && !reservedUnitCodes.has(b.shortCode)).forEach(b => {
            if (!m[b.productId]) m[b.productId] = [];
            m[b.productId].push(b.barcode);
        });
        return m;
    }, [allBarcodes, reservedUnitCodes]);

    const reservedMap = useAvailableStock();

    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';

    const categoryOptions = categoriesDB.map(c => c.name);
    const nameOptions = productNamesDB.map(n => n.name);
    const brandOptions = brandsDB.map(b => b.name);
    const colorOptions = colorsDB.map(c => c.name);
    const extraDataOptions = React.useMemo(() => {
        const uniqueVals = new Set();
        productFieldsDB.forEach(f => uniqueVals.add(f.name));
        (products || []).forEach(p => { if (p.extraData) uniqueVals.add(p.extraData.trim()); });
        return Array.from(uniqueVals);
    }, [products, productFieldsDB]);

    // ── Estado de la UI ──
    const [search, setSearch] = React.useState('');
    const [showForm, setShowForm] = React.useState(false);
    const [formData, setFormData] = React.useState({ ...EMPTY });
    const [editing, setEditing] = React.useState(null);
    const [adjProduct, setAdjProduct] = React.useState(null);
    const [showArchived, setShowArchived] = React.useState(false);
    const [archiveTarget, setArchiveTarget] = React.useState(null);
    const [toasts, setToasts] = React.useState([]);

    // ── Toast system ──
    const showToast = React.useCallback((text, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, text, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    const openNew = async () => {
        const barcode = await generateUniqueBarcode();
        const shortCode = await generateShortCode();
        setFormData({ ...EMPTY, barcode, shortCode });
        setEditing(null);
        setShowForm(true);
    };

    const openEdit = (p) => {
        setFormData({ ...p, cost: p.cost || '', price: p.price || '', stock: p.stock || '' });
        setEditing(p.id);
        setShowForm(true);
    };

    const toggleActive = async (p) => {
        const newStatus = p.active === false;
        await db.products.update(p.id, { active: newStatus });
        setArchiveTarget(null);
        showToast(newStatus ? 'Producto activado ✓' : 'Producto archivado');
    };

    const filtered = (products || []).filter(p => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const isCode = /^\d+$/.test(q);
        if (isCode) {
            // Match exacto: solo unidades disponibles (no vendidas, no reservadas)
            return p.barcode === q || p.shortCode === q ||
                (availableUnitCodesMap[p.id] || []).some(sc => sc === q);
        }
        // Texto: match parcial solo en nombre
        return p.name?.toLowerCase().includes(q);
    });
    const displayList = filtered.filter(p => showArchived ? p.active === false : p.active !== false);

    // ── Vista: Formulario ──
    if (showForm) {
        return (
            <ProductForm
                form={formData}
                editing={editing}
                onClose={() => setShowForm(false)}
                showToast={showToast}
                categoryOptions={categoryOptions}
                nameOptions={nameOptions}
                brandOptions={brandOptions}
                colorOptions={colorOptions}
                extraDataOptions={extraDataOptions}
            />
        );
    }

    // ── Vista: Ajuste de Stock ──
    if (adjProduct) {
        return (
            <StockAdjustModal
                product={adjProduct}
                reservedMap={reservedMap}
                onClose={() => setAdjProduct(null)}
                showToast={showToast}
            />
        );
    }

    return (
        <div className="max-w-7xl mx-auto fade-in relative">
            {/* Modal confirmación archivar */}
            {archiveTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
                        <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <XCircle size={28} className="text-orange-500" />
                        </div>
                        <h2 className="text-lg font-black text-pink-900 mb-2">¿Archivar producto?</h2>
                        <p className="text-sm text-pink-500 mb-6">
                            <span className="font-bold text-pink-700">{archiveTarget.name}</span> será ocultado del catálogo y del POS, pero sus datos quedarán guardados.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setArchiveTarget(null)}
                                className="flex-1 py-3 border-2 border-pink-100 rounded-2xl font-bold text-pink-400 hover:bg-pink-50 transition">
                                Cancelar
                            </button>
                            <button onClick={() => toggleActive(archiveTarget)}
                                className="flex-1 py-3 bg-orange-500 text-white font-black rounded-2xl hover:bg-orange-600 transition">
                                Archivar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast notifications */}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id}
                        role="alert"
                        className={`px-5 py-3 rounded-2xl shadow-xl text-sm font-bold text-white
                            ${t.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'}`}>
                        {t.text}
                    </div>
                ))}
            </div>

            {/* Cabecera */}
            <div className="flex justify-between items-center mb-5">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <Package size={24} /> Catálogo
                </h1>
                <div className="flex gap-2">
                    <button onClick={() => setShowArchived(!showArchived)}
                        className="px-4 py-2 border rounded-xl font-bold text-pink-400">
                        {showArchived ? 'Ver Activos' : 'Ver Archivados'}
                    </button>
                    <button onClick={openNew} className="btn-primary flex items-center gap-2">
                        <Plus size={18} /> Nuevo
                    </button>
                </div>
            </div>

            {/* Buscador */}
            <div className="fashion-card p-4 mb-4">
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar por nombre, código corto o EAN..." className="fashion-input" />
            </div>

            {/* Tabla */}
            <div className="fashion-card overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-pink-50 text-pink-700 text-left">
                            <th className="px-4 py-3">Producto</th>
                            <th className="px-4 py-3 text-center">Cód. Corto</th>
                            <th className="px-4 py-3 text-center">Cód. Barras</th>
                            <th className="px-4 py-3 text-center">Stock</th>
                            <th className="px-4 py-3 text-center">Precio</th>
                            <th className="px-4 py-3 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-pink-50">
                        {displayList.map(p => (
                            <tr key={p.id} className="hover:bg-pink-50/50">
                                <td className="px-4 py-3">
                                    <p className="font-bold text-pink-900">{p.name}</p>
                                    <div className="flex gap-1 flex-wrap mt-0.5 mb-1">
                                        {p.brand && <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 rounded">{p.brand}</span>}
                                        {p.color && <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-1.5 rounded border border-blue-100">{p.color}</span>}
                                        {p.size && <span className="text-[10px] font-semibold bg-purple-50 text-purple-600 px-1.5 rounded border border-purple-100">{p.size}</span>}
                                        {p.extraData && <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 px-1.5 rounded border border-amber-100">{p.extraData}</span>}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {(availableUnitCodesMap[p.id] || []).length > 0 ? (
                                        <div className="flex flex-wrap justify-center gap-1">
                                            {(availableUnitCodesMap[p.id] || []).map(sc => (
                                                <span key={sc} className="font-bold text-green-600 text-xs bg-green-50 px-1.5 rounded border border-green-100">
                                                    {sc}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-gray-300 text-xs">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {(availableUnitEANsMap[p.id] || []).length > 0 ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                            {(availableUnitEANsMap[p.id] || []).map((ean, idx) => (
                                                <span key={idx} className="font-mono text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                                    {ean}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-gray-300 text-xs">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <span className="font-bold text-pink-900">{p.stock}</span>
                                    {(reservedMap[p.id] || 0) > 0 && (
                                        <div className="text-[10px] font-bold text-rose-500 mt-0.5">
                                            Disp: {p.stock - (reservedMap[p.id] || 0)}
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center font-bold text-pink-800">{currency}{p.price?.toFixed(2)}</td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-2">
                                        <button onClick={() => setAdjProduct(p)} className="text-green-500" title="Ajuste de Stock" aria-label="Ajuste de stock">
                                            <Plus size={16} />
                                        </button>
                                        <button onClick={() => openEdit(p)} className="text-pink-500" title="Editar" aria-label="Editar producto">
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => showArchived ? toggleActive(p) : setArchiveTarget(p)}
                                            className="text-orange-400"
                                            title={showArchived ? 'Activar' : 'Archivar'}
                                            aria-label={showArchived ? 'Activar producto' : 'Archivar producto'}>
                                            <XCircle size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {displayList.length === 0 && (
                    <div className="py-12 text-center text-pink-300">
                        <Package size={40} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No hay productos para mostrar</p>
                    </div>
                )}
            </div>
        </div>
    );
}
