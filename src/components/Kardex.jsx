import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { History, ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, Filter, Store } from 'lucide-react';

/**
 * Kardex — Historial de movimientos de inventario (incluyendo recepción y envío entre sucursales)
 */
export default function Kardex() {
    const [productFilter, setProductFilter] = React.useState('');
    const [typeFilter, setTypeFilter] = React.useState('all');
    const [branchFilter, setBranchFilter] = React.useState('');
    const [dateFrom, setDateFrom] = React.useState('');
    const [dateTo, setDateTo] = React.useState('');

    const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
    const allBarcodes = useLiveQuery(() => db.barcodes.toArray(), []) || [];
    const branchesDB = useLiveQuery(() => (db.branches ? db.branches.orderBy('name').toArray() : []), []) || [];
    const movements = useLiveQuery(async () => {
        let query = db.kardex.orderBy('date').reverse();
        const all = await query.toArray();
        return all;
    }, []);

    const productMap = React.useMemo(() => {
        const m = {};
        (products || []).forEach(p => { m[p.id] = p.name; });
        return m;
    }, [products]);

    const branchOptions = React.useMemo(() => {
        const set = new Set((branchesDB || []).map(b => b.name));
        (movements || []).forEach(m => {
            if (m.originBranch) set.add(m.originBranch);
            if (m.transferTo) set.add(m.transferTo);
        });
        return Array.from(set).filter(Boolean).sort();
    }, [branchesDB, movements]);

    /**
     * Para movimientos sin unitCodes (datos históricos), buscamos barcodes
     * cuyo productId coincida y cuyo createdAt esté dentro de ±30s del date del kardex.
     */
    const enrichedMovements = React.useMemo(() => {
        if (!movements) return [];
        return movements.map(m => {
            if (m.unitCodes && m.unitCodes.length > 0) return m;

            const kardexMs = new Date(m.date).getTime();
            const WINDOW_MS = 30000;

            const matching = allBarcodes.filter(b => {
                if (b.productId !== m.productId) return false;
                if (!b.createdAt) return false;
                const bMs = new Date(b.createdAt).getTime();
                return Math.abs(bMs - kardexMs) <= WINDOW_MS;
            });

            if (matching.length === 0) return m;

            return {
                ...m,
                unitCodes: matching.map(b => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' })),
                _enriched: true,
            };
        });
    }, [movements, allBarcodes]);

    const isEntradaDeSucursal = (m) =>
        m.subType === 'traslado_entrada' ||
        !!m.originBranch ||
        String(m.notes || '').toUpperCase().startsWith('ENTRADA POR TRASLADO') ||
        String(m.notes || '').toUpperCase().startsWith('INGRESO DESDE ');

    const filtered = (enrichedMovements || []).filter(m => {
        if (productFilter && m.productId !== parseInt(productFilter, 10)) return false;
        const typeNorm = (m.type || '').toLowerCase();
        if (typeFilter === 'traslado_entrada') {
            if (!isEntradaDeSucursal(m)) return false;
        } else if (typeFilter === 'entrada_normal') {
            if (typeNorm !== 'entrada' || isEntradaDeSucursal(m)) return false;
        } else if (typeFilter !== 'all' && typeNorm !== typeFilter) {
            return false;
        }
        if (branchFilter) {
            const branchMov = (m.originBranch || m.transferTo || '').toUpperCase();
            if (branchMov !== branchFilter.toUpperCase()) return false;
        }
        if (dateFrom && m.date < dateFrom) return false;
        if (dateTo && m.date.slice(0, 10) > dateTo) return false;
        return true;
    });

    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-5 flex items-center gap-2">
                <History size={24} strokeWidth={1.8} className="text-pink-600" />
                Movimientos de Inventario
            </h1>

            {/* Filtros */}
            <div className="fashion-card p-4 mb-4">
                <div className="flex items-center gap-2 mb-3 text-pink-700 font-semibold text-sm">
                    <Filter size={15} /> Filtros
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
                        className="fashion-input">
                        <option value="">Todos los productos</option>
                        {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                        className="fashion-input">
                        <option value="all">Todos los tipos</option>
                        <option value="entrada">Todas las Entradas</option>
                        <option value="traslado_entrada">🏬 Entradas desde Sucursal</option>
                        <option value="entrada_normal">📥 Entradas (Compra/Inicial)</option>
                        <option value="salida">📤 Salidas (Venta/Baja)</option>
                        <option value="traslado">🔄 Traslados a Sucursal</option>
                    </select>
                    <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
                        className="fashion-input">
                        <option value="">Todas las sucursales</option>
                        {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="fashion-input" placeholder="Desde" />
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="fashion-input" placeholder="Hasta" />
                </div>
            </div>

            {/* Tabla */}
            <div className="fashion-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-pink-50 text-pink-700 text-left">
                                <th className="px-4 py-3 font-semibold">Fecha</th>
                                <th className="px-4 py-3 font-semibold">Producto</th>
                                <th className="px-4 py-3 font-semibold">Tipo / Origen</th>
                                <th className="px-4 py-3 font-semibold">Cantidad</th>
                                <th className="px-4 py-3 font-semibold">Cód. Corto</th>
                                <th className="px-4 py-3 font-semibold">Cód. Barras</th>
                                <th className="px-4 py-3 font-semibold">Stock Resultante</th>
                                <th className="px-4 py-3 font-semibold">Nota / Auditoría</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-pink-50">
                            {filtered.length === 0 ? (
                                <tr><td colSpan={8} className="py-12 text-center text-pink-300">
                                    No hay movimientos registrados
                                </td></tr>
                            ) : filtered.map(m => (
                                <tr key={m.id} className="hover:bg-pink-50/50 transition-colors">
                                    <td className="px-4 py-3 text-pink-600 text-xs">
                                        {new Date(m.date).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-pink-900">
                                        {productMap[m.productId] || `Producto #${m.productId}`}
                                    </td>
                                    <td className="px-4 py-3">
                                        {(() => {
                                            const type = (m.type || 'entrada').toLowerCase();
                                            const deSucursal = isEntradaDeSucursal(m);
                                            const isEntrada = type === 'entrada';
                                            const isTraslado = type === 'traslado';

                                            if (deSucursal) {
                                                return (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="flex items-center gap-1 font-bold text-xs text-emerald-700">
                                                            <Store size={14} className="text-amber-600" />
                                                            Ingreso Sucursal
                                                        </span>
                                                        {m.originBranch && (
                                                            <span className="inline-block w-fit text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded border border-amber-200">
                                                                🏬 {m.originBranch}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            const color = isEntrada ? 'text-green-600' : isTraslado ? 'text-amber-600' : 'text-red-600';
                                            const Icon = isEntrada ? ArrowDownCircle : isTraslado ? ArrowRightLeft : ArrowUpCircle;
                                            return (
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={`flex items-center gap-1 font-semibold text-xs ${color}`}>
                                                        <Icon size={14} />
                                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                                    </span>
                                                    {isTraslado && m.transferTo && (
                                                        <span className="inline-block w-fit text-[10px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded border border-amber-200">
                                                            → {m.transferTo}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-4 py-3">
                                        {(() => {
                                            const type = (m.type || 'entrada').toLowerCase();
                                            const isEntrada = type === 'entrada';
                                            const isTraslado = type === 'traslado';
                                            const color = isEntrada ? 'text-green-600' : isTraslado ? 'text-amber-600' : 'text-red-600';
                                            return (
                                                <span className={`font-bold ${color}`}>
                                                    {isEntrada ? '+' : '-'}{Math.abs(m.qty)}
                                                </span>
                                            );
                                        })()}
                                    </td>
                                    {/* Cód. Corto de unidades afectadas */}
                                    <td className="px-4 py-3">
                                        {(m.unitCodes || []).length > 0 ? (
                                            <div className="flex flex-col gap-0.5">
                                                {(m.unitCodes || []).map((u, i) => (
                                                    <span
                                                        key={i}
                                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border w-fit ${
                                                            u.originBranch || isEntradaDeSucursal(m)
                                                                ? 'text-amber-800 bg-amber-50 border-amber-200'
                                                                : 'text-green-700 bg-green-50 border-green-100'
                                                        }`}
                                                    >
                                                        {(u.originBranch || isEntradaDeSucursal(m)) ? `🏬 ${u.shortCode || '-'}` : (u.shortCode || '-')}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : <span className="text-gray-300 text-xs">-</span>}
                                    </td>
                                    {/* Cód. QR / EAN de unidades afectadas */}
                                    <td className="px-4 py-3">
                                        {(m.unitCodes || []).length > 0 ? (
                                            <div className="flex flex-col gap-0.5">
                                                {(m.unitCodes || []).map((u, i) => (
                                                    <span key={i} className="font-mono text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 w-fit">
                                                        {u.barcode || '-'}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : <span className="text-gray-300 text-xs">-</span>}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-pink-800">
                                        {m.balanceAfter !== undefined && m.balanceAfter !== null 
                                            ? m.balanceAfter 
                                            : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-pink-600 text-xs">
                                        <div>{m.notes || '-'}</div>
                                        {m.registeredBy && (
                                            <div className="text-[10px] text-pink-400 font-semibold mt-0.5">
                                                Reg. por: {m.registeredBy}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && (
                    <div className="px-4 py-3 bg-pink-50 border-t border-pink-100 text-xs text-pink-500">
                        Mostrando {filtered.length} movimiento{filtered.length !== 1 ? 's' : ''}
                    </div>
                )}
            </div>
        </div>
    );
}
