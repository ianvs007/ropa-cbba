import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, generateBarcodesForProduct, getLocalISOString } from '../db';
import { jsPDF } from 'jspdf';
import { Boxes, AlertTriangle, TrendingDown, Package, Plus, X, CheckCircle, Printer, Filter, Camera, Loader2, ImageOff } from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { formatCurrency, drawPDFHeader } from '../utils';
import { useAvailableStock } from '../hooks/useAvailableStock';
import { getEmbedding, cosineSimilarity } from '../utils/garmentClassifier';
import CameraCapture from './camera/CameraCapture';

/**
 * Inventory — Control de stock actual y alertas de bajo stock
 * Permite ajustes manuales de inventario registrados en kardex
 */
export default function Inventory() {
    const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const categoriesDB = useLiveQuery(() => db.categories.toArray(), []) || [];
    const allBarcodes = useLiveQuery(() => db.barcodes.toArray(), []) || [];

    // Mapa productId → unidades disponibles (no usadas): [{shortCode, barcode}]
    const unusedUnitsMap = React.useMemo(() => {
        const m = {};
        allBarcodes.filter(b => !b.used).forEach(b => {
            if (!m[b.productId]) m[b.productId] = [];
            m[b.productId].push({ shortCode: b.shortCode || '', barcode: b.barcode || '' });
        });
        return m;
    }, [allBarcodes]);
    
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const storeName = settings?.find(s => s.key === 'storeName')?.value || 'Tienda de Ropa';
    const lowStock = parseInt(settings?.find(s => s.key === 'lowStockAlert')?.value || '5');

    const [filter, setFilter] = React.useState('all');
    const [filterCat, setFilterCat] = React.useState('');
    const { msg, showMsg } = useNotification();

    // ── Búsqueda por foto (filtro visual sobre la misma tabla) ──
    const [cameraActive, setCameraActive] = React.useState(false);
    const [photoMatches, setPhotoMatches] = React.useState(null); // null = sin búsqueda activa
    const [searching, setSearching] = React.useState(false);
    const [noIndex, setNoIndex] = React.useState(false);

    const activeProducts = (products || []).filter(p => p.active !== false);

    const filtered = activeProducts.filter(p => {
        if (filter === 'low' && !(p.stock > 0 && p.stock <= lowStock)) return false;
        if (filter === 'out' && !(p.stock <= 0)) return false;
        if (filter === 'ok' && !(p.stock > lowStock)) return false;
        if (filterCat && p.category !== filterCat) return false;
        return true;
    });

    // Cuando hay búsqueda por foto, la tabla muestra solo esas coincidencias
    // (en orden de similitud); si no, el `filtered` normal de siempre.
    const photoActive = photoMatches !== null;
    const rows = photoActive ? photoMatches.map(m => m.product) : filtered;
    const scoreById = photoActive
        ? Object.fromEntries(photoMatches.map(m => [m.product.id, m.score]))
        : {};
    // Nº de columnas de la tabla (se suma 1 por la columna "Similitud" en modo foto).
    const colCount = photoActive ? 10 : 9;

    // Replica la lógica de ImageSearch.handleCapture, pero vuelca el resultado
    // como filtro de la tabla de inventario.
    const handlePhotoCapture = async ({ canvas }) => {
        setCameraActive(false);
        setNoIndex(false);
        setSearching(true);
        try {
            const query = await getEmbedding(canvas);
            const indexed = await db.products.where('hasEmbedding').equals(1).toArray();
            if (indexed.length === 0) {
                setNoIndex(true);
                setPhotoMatches(null);
                return;
            }
            const scored = indexed
                .filter(p => Array.isArray(p.embedding) && p.embedding.length === query.length)
                .map(p => ({ product: p, score: cosineSimilarity(query, p.embedding) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
            setPhotoMatches(scored);
        } catch (err) {
            console.error('Error en búsqueda por foto:', err);
            showMsg('error', 'No se pudo procesar la imagen. Inténtalo de nuevo.');
        } finally {
            setSearching(false);
        }
    };

    const clearPhotoSearch = () => {
        setPhotoMatches(null);
        setNoIndex(false);
        setCameraActive(false);
    };

    const totalProducts = activeProducts.length;
    const outOfStock = activeProducts.filter(p => p.stock <= 0).length;
    const lowStockCount = activeProducts.filter(p => p.stock > 0 && p.stock <= lowStock).length;
    const totalItems = activeProducts.reduce((s, p) => s + (p.stock || 0), 0);

    const reservedMap = useAvailableStock();


    const printInventoryPDF = () => {
        if (filtered.length === 0) {
            showMsg('error', 'No hay productos para imprimir con el filtro actual');
            return;
        }

        const doc = new jsPDF({ unit: 'mm', format: 'letter' }); // Carta vertical estándar para reportes
        const pageWidth = 215.9;
        const pageHeight = 279.4;
        const center = pageWidth / 2;
        let y = 15;
        let pageNum = 1;
        const settingsMap = {};
        (settings || []).forEach(s => settingsMap[s.key] = s.value);

        const drawHeader = () => {
            y = drawPDFHeader(doc, settingsMap, 'REPORTE DE INVENTARIO', y);
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            let subtitle = `Filtro Stock: ${filter === 'all' ? 'Todos' : filter === 'ok' ? 'Normal' : filter === 'low' ? 'Bajo' : 'Agotados'}`;
            if (filterCat) subtitle += ` | Categoría: ${filterCat}`;
            doc.text(subtitle, center, y, { align: 'center' }); y += 10;

            // Tabla cabecera
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setDrawColor(0, 0, 0);
            doc.line(10, y, pageWidth - 10, y);
            doc.text('Código', 12, y + 5);
            doc.text('Producto', 54, y + 5);
            doc.text('Categoría', 92, y + 5);
            doc.text('Variante', 124, y + 5);
            doc.text('Stock', 170, y + 5);
            doc.text('Precio', 188, y + 5);
            y += 7;
            doc.line(10, y, pageWidth - 10, y);
            y += 4;
        };

        const drawFooter = () => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.text(`Página ${pageNum}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
        };

        drawHeader();
        drawFooter(); // Página inicial

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        filtered.forEach((p, idx) => {
            const units = unusedUnitsMap[p.id] || [];
            const unitShortCodes = units.map(u => u.shortCode).filter(Boolean);
            const unitEANs = units.map(u => u.barcode).filter(Boolean);
            // Estimar altura: nombre + códigos de unidades en columna Código
            const nameLines = doc.splitTextToSize(p.name, 36);
            const scLine = unitShortCodes.length > 0 ? `Cód: ${unitShortCodes.join(', ')}` : '';
            const eanLine = unitEANs.length > 0 ? `EAN: ${unitEANs.join(', ')}` : '';
            const codeColWidth = 40; // ancho columna Código (12 a 52)
            const scWrapped = scLine ? doc.splitTextToSize(scLine, codeColWidth) : [];
            const eanWrapped = eanLine ? doc.splitTextToSize(eanLine, codeColWidth) : [];
            const codeExtraHeight = (scWrapped.length + eanWrapped.length) * 3.5;
            const rowHeight = Math.max((nameLines.length * 4), codeExtraHeight) + 4;

            if (y + rowHeight > 255) {
                doc.addPage();
                pageNum++;
                y = 15;
                drawHeader();
                drawFooter();
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
            }
            const rowStartY = y;
            doc.setFont('helvetica', 'normal');

            // Columna Código: códigos de unidades disponibles
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            let codeY = rowStartY;
            if (scWrapped.length > 0) {
                doc.text(scWrapped, 12, codeY);
                codeY += scWrapped.length * 3.5;
            }
            if (eanWrapped.length > 0) {
                doc.text(eanWrapped, 12, codeY);
                codeY += eanWrapped.length * 3.5;
            }
            if (scWrapped.length === 0 && eanWrapped.length === 0) {
                doc.text('-', 12, codeY);
            }
            doc.setTextColor(0, 0, 0);

            // Columna Producto
            doc.setFontSize(9);
            doc.text(nameLines, 54, rowStartY);
            doc.text(p.category || '-', 92, rowStartY);
            const variant = [p.brand, p.size, p.color].filter(Boolean).join(' | ') || '-';
            const variantLines = doc.splitTextToSize(variant, 44);
            doc.text(variantLines, 124, rowStartY);
            doc.setFont('helvetica', 'bold');
            doc.text(p.stock.toString(), 170, rowStartY);
            doc.setFont('helvetica', 'normal');
            doc.text(`${formatCurrency(p.price, currency)}`, 188, rowStartY);

            // Avanzar Y al mayor de las dos columnas
            const nameHeight = (nameLines.length * 4) + 1;
            y = Math.max(rowStartY + nameHeight, codeY) + 3;
            doc.setDrawColor(180, 180, 180);
            doc.line(10, y, pageWidth - 10, y);
            y += 4;
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        y += 5;
        doc.text(`Total Items: ${filtered.length}`, 12, y);

        doc.autoPrint();
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
    };

    return (
        <div className="max-w-7xl mx-auto fade-in h-full flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 shrink-0">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <Boxes size={24} strokeWidth={1.8} className="text-pink-600" />
                    Control de Inventario
                </h1>
                <button onClick={printInventoryPDF} disabled={filtered.length === 0}
                    className="btn-primary flex items-center gap-2 px-6 py-2 shrink-0">
                    <Printer size={18} />
                    Imprimir Reporte
                </button>
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

                {/* Tarjetas KPI */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                    {[
                        { label: 'Total Productos', value: totalProducts, icon: Package, color: 'pink' },
                        { label: 'Unidades en Stock', value: totalItems, icon: Boxes, color: 'purple' },
                        { label: 'Stock Bajo', value: lowStockCount, icon: TrendingDown, color: 'orange' },
                        { label: 'Sin Stock', value: outOfStock, icon: AlertTriangle, color: 'red' },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="fashion-card p-3 xl:p-4">
                            <div className={`w-8 h-8 xl:w-10 xl:h-10 rounded-xl flex items-center justify-center mb-2
                                ${color === 'pink' ? 'bg-pink-100' : ''}
                                ${color === 'purple' ? 'bg-purple-100' : ''}
                                ${color === 'orange' ? 'bg-orange-100' : ''}
                                ${color === 'red' ? 'bg-red-100' : ''}`}>
                                <Icon size={18} className={
                                    color === 'pink' ? 'text-pink-600' :
                                        color === 'purple' ? 'text-purple-600' :
                                            color === 'orange' ? 'text-orange-600' : 'text-red-600'} />
                            </div>
                            <p className="text-xl xl:text-2xl font-black text-pink-900">{value}</p>
                            <p className="text-[10px] xl:text-xs text-pink-500 font-medium">{label}</p>
                        </div>
                    ))}
                </div>

            {/* Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex gap-2 flex-wrap">
                    {[['all', 'Todos'], ['ok', 'Normal'], ['low', 'Stock Bajo'], ['out', 'Agotados']].map(([val, lbl]) => (
                        <button key={val} onClick={() => setFilter(val)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all
                                    ${filter === val
                                    ? 'border-pink-500 bg-pink-50 text-pink-700'
                                    : 'border-gray-200 text-gray-500 hover:border-pink-300'}`}>
                            {lbl}
                        </button>
                    ))}
                    {/* Búsqueda por foto: abre la cámara o, si ya hay resultados, permite volver a todo */}
                    {photoActive ? (
                        <button onClick={clearPhotoSearch}
                            className="px-4 py-2 rounded-xl text-sm font-semibold border border-pink-500 bg-pink-500 text-white flex items-center gap-1.5 transition-all hover:bg-pink-600">
                            <X size={15} /> Quitar filtro de foto
                        </button>
                    ) : (
                        <button onClick={() => { setNoIndex(false); setCameraActive(v => !v); }} disabled={searching}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold border flex items-center gap-1.5 transition-all disabled:opacity-50
                                ${cameraActive ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:border-pink-300'}`}>
                            {searching ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                            {searching ? 'Analizando…' : cameraActive ? 'Cerrar cámara' : 'Buscar por foto'}
                        </button>
                    )}
                </div>
                <div className="flex gap-2 items-center">
                    <Filter size={16} className="text-pink-400 shrink-0" />
                    <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="fashion-input text-sm">
                        <option value="">Todas las Categorías</option>
                        {categoriesDB.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Cámara para búsqueda por foto */}
            {cameraActive && (
                <div className="fashion-card p-6 mb-4">
                    <CameraCapture onCapture={handlePhotoCapture} />
                    <div className="flex justify-center mt-4">
                        <button onClick={() => setCameraActive(false)}
                            className="text-sm text-pink-500 hover:text-pink-700 font-semibold">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Aviso: no hay productos indexados para comparar */}
            {noIndex && (
                <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                        Ningún producto tiene aún huella visual para comparar. Registra productos con foto o usa{' '}
                        <span className="font-semibold">Configuración → "Reindexar fotos para búsqueda"</span>.
                    </p>
                </div>
            )}

            {/* Banner de búsqueda por foto activa */}
            {photoActive && (
                <div className="mb-4 flex items-center justify-between gap-3 bg-pink-50 border border-pink-200 rounded-xl px-4 py-2.5">
                    <p className="text-sm text-pink-700 flex items-center gap-2">
                        <Camera size={15} /> Mostrando los {rows.length} productos más parecidos a la foto.
                    </p>
                    <button onClick={clearPhotoSearch}
                        className="text-sm font-semibold text-pink-600 hover:text-pink-800 underline shrink-0">
                        Ver todo
                    </button>
                </div>
            )}

            {/* Tabla de inventario */}
            <div className="fashion-card flex-1 flex flex-col min-h-0 relative">
                <div className="overflow-x-auto flex-1 h-full scrollbar-thin">
                    <table className="w-full text-sm">
                        <thead className="bg-pink-50/80 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                            <tr className="text-pink-700 text-left">
                                <th className="px-4 py-3 font-semibold">Producto</th>
                                <th className="px-4 py-3 font-semibold">Categoría</th>
                                <th className="px-4 py-3 font-semibold">Talla</th>
                                <th className="px-4 py-3 font-semibold">Color</th>
                                <th className="px-4 py-3 font-semibold">Precio Venta</th>
                                <th className="px-4 py-3 font-semibold">Cód. Corto</th>
                                <th className="px-4 py-3 font-semibold">Cód. Barras</th>
                                <th className="px-4 py-3 font-semibold">Stock</th>
                                <th className="px-4 py-3 font-semibold">Estado</th>
                                {photoActive && <th className="px-4 py-3 font-semibold text-center">Similitud</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-pink-50">
                            {rows.length === 0 ? (
                                <tr><td colSpan={colCount} className="py-12 text-center text-pink-300">
                                    <Package size={36} className="mx-auto mb-2 opacity-40" />
                                    <p>{photoActive ? 'No se encontraron productos parecidos' : 'No hay productos en esta categoría'}</p>
                                </td></tr>
                            ) : rows.map(p => (
                                <tr key={p.id} className="hover:bg-pink-50/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {/* Miniatura de la foto del producto (56x56) */}
                                            {p.photo ? (
                                                <div className="w-14 h-14 rounded-lg border border-pink-100 overflow-hidden flex-shrink-0">
                                                    <img src={p.photo} alt={p.name} className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className="w-14 h-14 rounded-lg border border-gray-200 bg-gray-100 flex flex-col items-center justify-center flex-shrink-0 text-gray-300">
                                                    <ImageOff size={18} />
                                                    <span className="text-[8px] leading-none mt-0.5">sin foto</span>
                                                </div>
                                            )}
                                            <div>
                                                <p className="font-semibold text-pink-900">{p.name}</p>
                                                <div className="flex gap-1 flex-wrap mt-0.5 mb-1">
                                                    {p.brand && <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 rounded">{p.brand}</span>}
                                                    {p.extraData && <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 px-1.5 rounded border border-amber-100" title="Datos Extras">{p.extraData}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {p.category && <span className="badge-rose">{p.category}</span>}
                                    </td>
                                    <td className="px-4 py-3 text-pink-700">{p.size || '-'}</td>
                                    <td className="px-4 py-3 text-pink-700">{p.color || '-'}</td>
                                    <td className="px-4 py-3 font-semibold text-pink-800">{currency}{p.price?.toFixed(2)}</td>
                                    {/* Cód. Corto — unidades disponibles */}
                                    <td className="px-4 py-3">
                                        {(unusedUnitsMap[p.id] || []).length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {(unusedUnitsMap[p.id] || []).map(u => (
                                                    <span key={u.shortCode} className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-100">
                                                        {u.shortCode || '-'}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-gray-300 text-xs">-</span>
                                        )}
                                    </td>
                                    {/* Cód. QR — EAN unidades disponibles */}
                                    <td className="px-4 py-3">
                                        {(unusedUnitsMap[p.id] || []).length > 0 ? (
                                            <div className="flex flex-col gap-0.5">
                                                {(unusedUnitsMap[p.id] || []).map((u, idx) => (
                                                    <span key={idx} className="font-mono text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                                        {u.barcode}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-gray-300 text-xs">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-2xl font-black
                                            ${p.stock <= 0 ? 'text-red-600'
                                                : p.stock <= lowStock ? 'text-orange-500'
                                                    : 'text-green-600'}`}>{p.stock}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {p.stock <= 0
                                            ? <span className="badge-red">Agotado</span>
                                            : p.stock <= lowStock
                                                ? <span className="badge-red">Bajo</span>
                                                : <span className="badge-green">Disponible</span>}
                                    </td>
                                    {photoActive && (
                                        <td className="px-4 py-3 text-center">
                                            <span className="inline-block px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-black">
                                                {Math.round((scoreById[p.id] || 0) * 100)}%
                                            </span>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}
