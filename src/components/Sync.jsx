import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalISOString } from '../db';
import {
    RefreshCw, Download, Upload, FileSpreadsheet, AlertTriangle,
    CheckCircle, X, Loader2
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { filasStockParaExportar, parsearVentasEnLinea, cruzarVentas } from '../utils/syncExcel';

/**
 * 🔄 Sync — Sincronización con la tienda virtual (ritual diario al cierre).
 *
 *  ① Exportar stock: genera un Excel (codigo | nombre | talla | color |
 *    stock | precio) que se sube de inmediato en el admin web → Sincronizar.
 *  ② Importar ventas en línea: lee el Excel que devuelve la nube y descuenta
 *    el stock local en UNA transacción (products + barcodes + kardex).
 *    NO crea registros en `sales`: el dinero de la web no entra a la caja
 *    física, solo baja stock (decisión del dueño).
 */
export default function Sync() {
    const { msg, showMsg } = useNotification();

    // ── Estado: exportación ──
    const products = useLiveQuery(() => db.products.toArray(), []);
    const [exportando, setExportando] = React.useState(false);

    // ── Estado: importación ──
    const fileInputRef = React.useRef(null);
    const [archivo, setArchivo] = React.useState(null);      // nombre del archivo elegido
    const [preview, setPreview] = React.useState(null);      // filas cruzadas (vista previa)
    const [erroresParseo, setErroresParseo] = React.useState([]);
    const [aplicando, setAplicando] = React.useState(false);
    const [reporte, setReporte] = React.useState(null);      // resumen tras confirmar

    // Conteo de productos activos sin código corto (advertencia en tarjeta ①)
    const { totalExportables, sinCodigoCount } = React.useMemo(() => {
        const { filas, sinCodigo } = filasStockParaExportar(products || []);
        return { totalExportables: filas.length, sinCodigoCount: sinCodigo.length };
    }, [products]);

    // ══════════════════ ① EXPORTAR STOCK ══════════════════
    const handleExportar = async () => {
        setExportando(true);
        try {
            const todos = await db.products.toArray();
            const { filas, sinCodigo } = filasStockParaExportar(todos);
            if (filas.length === 0) {
                showMsg('error', 'No hay productos activos con código corto para exportar');
                return;
            }

            const XLSX = await import('xlsx');
            const hoja = XLSX.utils.json_to_sheet(filas, {
                header: ['codigo', 'nombre', 'talla', 'color', 'stock', 'precio'],
            });
            const libro = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(libro, hoja, 'stock');
            const fecha = getLocalISOString().slice(0, 10);
            XLSX.writeFile(libro, `stock-para-tienda-virtual-${fecha}.xlsx`);

            showMsg('success',
                `Excel generado con ${filas.length} producto(s)` +
                (sinCodigo.length > 0 ? ` · ${sinCodigo.length} sin código omitido(s)` : ''));
        } catch (err) {
            showMsg('error', `No se pudo generar el Excel: ${err.message}`);
        } finally {
            setExportando(false);
        }
    };

    // ══════════════════ ② IMPORTAR VENTAS EN LÍNEA ══════════════════
    const limpiarImportacion = () => {
        setArchivo(null);
        setPreview(null);
        setErroresParseo([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleArchivo = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite volver a elegir el mismo archivo
        if (!file) return;

        setReporte(null);
        try {
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const libro = XLSX.read(buffer, { type: 'array' });
            const hoja = libro.Sheets[libro.SheetNames[0]];
            const filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

            const { ventas, errores } = parsearVentasEnLinea(filasCrudas);
            setErroresParseo(errores);

            if (ventas.length === 0) {
                setPreview(null);
                setArchivo(file.name);
                showMsg('error', 'El archivo no contiene ventas válidas');
                return;
            }

            const [todos, ultima] = await Promise.all([
                db.products.toArray(),
                db.settings.get('ultimaImportacionVentas'),
            ]);
            setPreview(cruzarVentas(ventas, todos, ultima?.value || null));
            setArchivo(file.name);
        } catch (err) {
            limpiarImportacion();
            showMsg('error', `No se pudo leer el archivo: ${err.message}`);
        }
    };

    const handleConfirmar = async () => {
        const aplicables = (preview || []).filter(f => f.aDescontar > 0);
        if (aplicables.length === 0) {
            showMsg('error', 'No hay filas por aplicar');
            return;
        }

        setAplicando(true);
        try {
            // UNA transacción: si algo falla a la mitad, Dexie hace rollback
            // completo y el stock nunca queda descontado parcialmente.
            const unidadesDescontadas = await db.transaction(
                'rw', [db.products, db.barcodes, db.kardex, db.settings],
                async () => {
                    let unidades = 0;
                    let fechaMax = null;

                    for (const fila of preview) {
                        if (fila.aDescontar <= 0 || !fila.productId) continue;

                        const product = await db.products.get(fila.productId);
                        if (!product) continue;

                        // Defensivo: el stock pudo cambiar desde la vista previa
                        const qty = Math.min(fila.aDescontar, product.stock);
                        if (qty <= 0) continue;

                        const nuevoStock = product.stock - qty;
                        await db.products.update(product.id, { stock: nuevoStock });

                        // Marcar como usadas las primeras `qty` unidades disponibles (FIFO por id)
                        const unidadesLibres = await db.barcodes
                            .where('productId').equals(product.id)
                            .and(b => !b.used)
                            .limit(qty)
                            .toArray();
                        for (const b of unidadesLibres) {
                            await db.barcodes.update(b.id, { used: true });
                        }

                        await db.kardex.add({
                            productId: product.id,
                            date: getLocalISOString(),
                            type: 'salida',
                            qty,
                            notes: `VENTA EN LÍNEA #${fila.pedido || 'SIN-REF'} (${fila.estado || 'pagado'})`.toUpperCase(),
                            balanceAfter: nuevoStock,
                            unitCodes: unidadesLibres.map(b => ({
                                shortCode: b.shortCode || '',
                                barcode: b.barcode || '',
                            })),
                        });

                        unidades += qty;
                        if (fila.fecha && (!fechaMax || fila.fecha > fechaMax)) fechaMax = fila.fecha;
                    }

                    // Bloquea el doble descuento si importan el mismo archivo otra vez
                    if (fechaMax) {
                        await db.settings.put({ key: 'ultimaImportacionVentas', value: fechaMax });
                    }
                    return unidades;
                }
            );

            setReporte({
                aplicadas: aplicables.length,
                conAviso: preview.filter(f => f.aviso).length,
                unidades: unidadesDescontadas,
            });
            limpiarImportacion();
            showMsg('success', `Sincronización aplicada: ${unidadesDescontadas} unidad(es) descontadas ✓`);
        } catch (err) {
            showMsg('error', `Error al aplicar la sincronización: ${err.message}`);
        } finally {
            setAplicando(false);
        }
    };

    const totalADescontar = (preview || []).reduce((s, f) => s + (f.aDescontar || 0), 0);

    return (
        <div className="max-w-7xl mx-auto fade-in h-full flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-5 shrink-0">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <RefreshCw size={24} strokeWidth={1.8} className="text-pink-600" />
                    Sincronización con tienda virtual
                </h1>
            </div>

            {/* Notificación */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
                    {msg.text}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* ══════════ TARJETA ① EXPORTAR STOCK ══════════ */}
                <div className="fashion-card p-6 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
                            <Download size={18} strokeWidth={1.8} className="text-pink-600" />
                        </div>
                        <div>
                            <h2 className="font-black text-pink-950 uppercase tracking-tight">Exportar stock para la tienda virtual</h2>
                            <p className="text-xs text-pink-500 font-medium">Paso 1 del ritual de cierre diario</p>
                        </div>
                    </div>

                    <p className="text-sm text-gray-600 mb-4">
                        Genera un Excel con el stock actual (una fila por variante con código corto)
                        listo para subir al admin web.
                    </p>

                    <div className="flex items-center gap-2 mb-4">
                        <span className="badge-rose">{totalExportables} producto(s) exportables</span>
                        {sinCodigoCount > 0 && (
                            <span className="badge-gold">{sinCodigoCount} sin código</span>
                        )}
                    </div>

                    {sinCodigoCount > 0 && (
                        <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800">
                                Hay <span className="font-bold">{sinCodigoCount} producto(s) activo(s) sin código corto</span>:
                                no se incluirán en el Excel y su stock web quedará desactualizado.
                            </p>
                        </div>
                    )}

                    <div className="mt-auto space-y-3">
                        <button onClick={handleExportar} disabled={exportando}
                            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                            {exportando ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
                            {exportando ? 'Generando…' : 'Generar Excel de stock'}
                        </button>
                        <p className="text-[11px] text-pink-400 font-semibold text-center">
                            Súbelo de inmediato en el admin web → Sincronizar; un Excel viejo descuadra el stock.
                        </p>
                    </div>
                </div>

                {/* ══════════ TARJETA ② IMPORTAR VENTAS EN LÍNEA ══════════ */}
                <div className="fashion-card p-6 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                            <Upload size={18} strokeWidth={1.8} className="text-purple-600" />
                        </div>
                        <div>
                            <h2 className="font-black text-pink-950 uppercase tracking-tight">Importar ventas en línea</h2>
                            <p className="text-xs text-pink-500 font-medium">Paso 2: baja del stock lo vendido en la web</p>
                        </div>
                    </div>

                    <p className="text-sm text-gray-600 mb-4">
                        Selecciona el Excel <span className="font-mono text-xs">ventas-en-linea-YYYY-MM-DD.xlsx</span>{' '}
                        descargado del admin web. Solo se descuenta stock; el dinero de la web no entra a esta caja.
                    </p>

                    <div className="mt-auto space-y-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx"
                            onChange={handleArchivo}
                            className="hidden"
                        />
                        <button onClick={() => fileInputRef.current?.click()} disabled={aplicando}
                            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60">
                            <Upload size={18} />
                            Elegir archivo .xlsx
                        </button>
                        {archivo && (
                            <p className="text-xs text-pink-600 font-semibold text-center truncate">
                                📄 {archivo}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Errores de parseo (filas inválidas no bloquean el resto) */}
            {erroresParseo.length > 0 && (
                <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                        <p className="font-bold mb-1">{erroresParseo.length} fila(s) ignorada(s) por datos inválidos:</p>
                        <ul className="text-xs space-y-0.5 list-disc list-inside">
                            {erroresParseo.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                            {erroresParseo.length > 5 && <li>…y {erroresParseo.length - 5} más</li>}
                        </ul>
                    </div>
                </div>
            )}

            {/* ══════════ VISTA PREVIA DE LA IMPORTACIÓN ══════════ */}
            {preview && (
                <div className="fashion-card flex-1 flex flex-col min-h-0 relative mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-pink-50">
                        <p className="text-sm font-bold text-pink-900">
                            Vista previa: {preview.length} fila(s) · {totalADescontar} unidad(es) a descontar
                        </p>
                        <div className="flex gap-2">
                            <button onClick={limpiarImportacion} disabled={aplicando}
                                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-500 hover:border-pink-300 transition-all">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmar} disabled={aplicando || totalADescontar === 0}
                                className="btn-primary flex items-center gap-2 px-6 py-2 disabled:opacity-60">
                                {aplicando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                {aplicando ? 'Aplicando…' : 'Confirmar descuento'}
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto flex-1 h-full scrollbar-thin">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-pink-50/80 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                                <tr className="text-pink-700 text-left">
                                    <th className="px-4 py-3 font-semibold">Código</th>
                                    <th className="px-4 py-3 font-semibold">Nombre</th>
                                    <th className="px-4 py-3 font-semibold">Talla</th>
                                    <th className="px-4 py-3 font-semibold">Color</th>
                                    <th className="px-4 py-3 font-semibold text-center">Cant.</th>
                                    <th className="px-4 py-3 font-semibold text-center">A descontar</th>
                                    <th className="px-4 py-3 font-semibold">Pedido</th>
                                    <th className="px-4 py-3 font-semibold">Aviso</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-pink-50">
                                {preview.map((f, i) => (
                                    <tr key={`${f.codigo}-${f.pedido}-${i}`} className="hover:bg-pink-50/50 transition-colors">
                                        <td className="px-4 py-3 font-mono font-bold text-pink-800">{f.codigo}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-semibold text-pink-900">{f.nombre || '-'}</p>
                                            {f.nombreLocal && f.nombreLocal !== f.nombre && (
                                                <p className="text-[10px] text-gray-400">Local: {f.nombreLocal}</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-pink-700">{f.talla || '-'}</td>
                                        <td className="px-4 py-3 text-pink-700">{f.color || '-'}</td>
                                        <td className="px-4 py-3 text-center font-semibold text-pink-800">{f.cantidad}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`text-lg font-black ${f.aDescontar > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                                                {f.aDescontar}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-pink-600">{f.pedido || '-'}</td>
                                        <td className="px-4 py-3">
                                            {f.aviso
                                                ? <span className={f.aDescontar > 0 ? 'badge-gold' : 'badge-red'}>{f.aviso}</span>
                                                : <span className="badge-green">OK</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ══════════ REPORTE FINAL ══════════ */}
            {reporte && (
                <div className="fashion-card p-6 fade-in">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                            <CheckCircle size={18} strokeWidth={1.8} className="text-green-600" />
                        </div>
                        <h2 className="font-black text-pink-950 uppercase tracking-tight">Sincronización aplicada</h2>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'Filas aplicadas', value: reporte.aplicadas },
                            { label: 'Filas con aviso', value: reporte.conAviso },
                            { label: 'Unidades descontadas', value: reporte.unidades },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-pink-50/60 border border-pink-100 rounded-xl p-3 text-center">
                                <p className="text-2xl font-black text-pink-900">{value}</p>
                                <p className="text-[10px] text-pink-500 font-bold uppercase tracking-wide">{label}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-3 text-center">
                        Los movimientos quedaron registrados en el kárdex como "VENTA EN LÍNEA".
                    </p>
                </div>
            )}
        </div>
    );
}
