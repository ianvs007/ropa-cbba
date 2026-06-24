import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { Printer, Filter, Tag, CheckSquare, Square, AlertCircle, Calendar, Wrench } from 'lucide-react';

export default function MassLabeling() {
    const productsDB = useLiveQuery(() => db.products.orderBy('name').toArray(), []) || [];
    const categoriesDB = useLiveQuery(() => db.categories.toArray(), []) || [];
    const settings = useLiveQuery(() => db.settings.toArray(), []) || [];
    const allBarcodes = useLiveQuery(() => db.barcodes.toArray(), []) || [];

    const currency = settings.find(s => s.key === 'currency')?.value || 'Bs.';

    // Mapa con TODOS los barcodes (usado para búsqueda, incluye vendidos)
    const allBarcodesMap = useMemo(() => {
        const m = {};
        allBarcodes.forEach(b => {
            if (!m[b.productId]) m[b.productId] = [];
            m[b.productId].push(b);
        });
        return m;
    }, [allBarcodes]);

    // Mapa con solo barcodes NO USADOS (para display, conteo y generación de etiquetas)
    const barcodesMap = useMemo(() => {
        const m = {};
        allBarcodes.filter(b => !b.used).forEach(b => {
            if (!m[b.productId]) m[b.productId] = [];
            m[b.productId].push(b);
        });
        return m;
    }, [allBarcodes]);

    // Verificar códigos cortos faltantes al cargar
    const missingShortCodesCount = useMemo(() => {
        return allBarcodes.filter(b => !b.shortCode || isNaN(parseInt(b.shortCode, 10))).length;
    }, [allBarcodes]);

    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('');
    const [filterStock, setFilterStock] = useState('all'); // all, instock, lowstock

    // Filtros de fecha de registro
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');

    // Estado local para selecciones: { [productId]: cantidadEtiquetas }
    const [selections, setSelections] = useState({});

    // Función para sanear códigos cortos faltantes
    const handleFixShortCodes = async () => {
        try {
            const { fixMissingShortCodes } = await import('../db.js');
            const updated = await fixMissingShortCodes();
            alert(`✅ Se asignaron ${updated} códigos cortos únicos a las unidades.`);
        } catch (err) {
            alert('❌ Error al asignar códigos cortos: ' + err.message);
        }
    };

    // Filtering logic
    const filteredProducts = useMemo(() => {
        return productsDB.filter(p => {
            if (search) {
                const q = search.toLowerCase();
                const matchesProduct =
                    p.name.toLowerCase().includes(q) ||
                    p.barcode.includes(search) ||
                    p.shortCode?.includes(search) ||
                    (allBarcodesMap[p.id] || []).some(b => b.shortCode?.includes(search));
                if (!matchesProduct) return false;
            }
            if (filterCat && p.category !== filterCat) return false;
            if (filterStock === 'instock' && p.stock <= 0) return false;
            
            // Filtros por fecha de creación
            if (p.createdAt) {
                if (dateStart && new Date(p.createdAt) < new Date(dateStart + 'T00:00:00')) return false;
                if (dateEnd && new Date(p.createdAt) > new Date(dateEnd + 'T23:59:59')) return false;
            } else if (dateStart || dateEnd) {
                // Si el producto no tiene fecha y se aplicó un filtro, se excluye
                return false;
            }

            return true;
        });
    }, [productsDB, search, filterCat, filterStock, dateStart, dateEnd, allBarcodesMap, barcodesMap]);

    const handleSelectAll = () => {
        if (Object.keys(selections).length === filteredProducts.length) {
            setSelections({});
        } else {
            const newSel = {};
            filteredProducts.forEach(p => { 
                const available = (barcodesMap[p.id] || []).length || p.stock;
                newSel[p.id] = available > 0 ? available : 1;
            });
            setSelections(newSel);
        }
    };

    const toggleSelection = (id) => {
        const newSel = { ...selections };
        if (newSel[id]) delete newSel[id];
        else {
            const p = productsDB.find(prod => prod.id === id);
            const available = (barcodesMap[id] || []).length || p?.stock || 1;
            newSel[id] = available > 0 ? available : 1;
        }
        setSelections(newSel);
    };

    const changeLabelCount = (id, count) => {
        if (count < 1) return;
        setSelections(prev => ({ ...prev, [id]: count }));
    };

    const selectedCount = Object.keys(selections).length;
    const totalLabelsToPrint = Object.values(selections).reduce((a, b) => a + b, 0);

    const generatePDF = () => {
        if (totalLabelsToPrint === 0) return;

        // Tamaño Oficio/Folio (8.5 x 13 pulgadas) -> 215.9 x 330.2 mm
        const doc = new jsPDF({ unit: 'mm', format: [215.9, 330.2] });
        
        // Medidas de etiqueta: 50x30mm
        const L_W = 50;
        const L_H = 30;
        const COLS = 4;
        const ROWS = 10;
        const MARGIN_X = (215.9 - (COLS * L_W)) / 2; // ~7.95mm
        const MARGIN_Y = (330.2 - (ROWS * L_H)) / 2; // ~15.1mm

        // Obtener datos listos para dibujar + conteo de warnings
        const labelsQueue = [];
        let fallbackCount = 0;
        let missingShortCodeCount = 0;
        
        Object.entries(selections).forEach(([idStr, qty]) => {
            const pid = parseInt(idStr);
            const p = productsDB.find(prod => prod.id === pid);
            const pBarcodes = barcodesMap[pid] || [];

            if (p) {
                for (let i = 0; i < qty; i++) {
                    const unitObj = pBarcodes[i];
                    if (!unitObj) {
                        // Sin barcode individual — usar código base del producto como fallback
                        fallbackCount++;
                        labelsQueue.push({
                            ...p,
                            currentBarcode: p.barcode || p.id.toString(),
                            currentShortCode: p.shortCode || p.id.toString().padStart(5, '0'),
                            isFallback: true
                        });
                    } else {
                        // Verificar si la unidad tiene código corto único
                        if (!unitObj.shortCode) {
                            missingShortCodeCount++;
                        }
                        labelsQueue.push({
                            ...p,
                            currentBarcode: unitObj.barcode,
                            currentShortCode: unitObj.shortCode || p.shortCode || p.id.toString().padStart(5, '0'),
                            isFallback: !unitObj.shortCode,
                            hasUniqueShortCode: !!unitObj.shortCode
                        });
                    }
                }
            }
        });
        
        // Advertencia si hay unidades sin código corto único o sin barcode
        if (missingShortCodeCount > 0 || fallbackCount > 0) {
            let message = '⚠️ Problemas detectados en las etiquetas:\n\n';
            if (missingShortCodeCount > 0) {
                message += `- ${missingShortCodeCount} unidad(es) sin código corto único\n`;
            }
            if (fallbackCount > 0) {
                message += `- ${fallbackCount} etiqueta(s) sin código de barras individual\n`;
            }
            message += '\n¿Desea continuar de todas formas?';
            
            const proceed = window.confirm(message);
            if (!proceed) return;
        }

        labelsQueue.forEach((p, index) => {
            const pageIndex = Math.floor(index / (COLS * ROWS));
            const onPageIdx = index % (COLS * ROWS);
            
            if (onPageIdx === 0 && pageIndex > 0) {
                doc.addPage();
            }

            const col = onPageIdx % COLS;
            const row = Math.floor(onPageIdx / COLS);

            const x = MARGIN_X + (col * L_W);
            const y = MARGIN_Y + (row * L_H);

            // Dibujar contorno sutil (opcional para guía de corte)
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.1);
            doc.rect(x, y, L_W, L_H);

            // Contenido interior
            let currentY = y + 5;
            
            // Título
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            const nameLines = doc.splitTextToSize(p.name, L_W - 4);
            doc.text(nameLines[0], x + (L_W / 2), currentY, { align: 'center' }); 
            currentY += 4;

            // Fila de Info: Variantes + Código Corto (Respaldo)
            doc.setFontSize(6); // Reducido de 7 a 6 para evitar solapamiento
            doc.setFont('helvetica', 'normal');
            const variants = [p.size && `T: ${p.size}`, p.color && `C: ${p.color}`].filter(Boolean).join(' | ');
            
            if (variants) {
                // Escribir variantes a la izquierda (con límite de espacio)
                const shortCodeText = `C. CORTO: ${p.currentShortCode}`;
                doc.text(variants, x + 3, currentY); 
                
                doc.setFont('helvetica', 'bold');
                doc.text(shortCodeText, x + L_W - 3, currentY, { align: 'right' });
            } else {
                doc.setFont('helvetica', 'bold');
                doc.text(`CÓDIGO CORTO: ${p.currentShortCode}`, x + (L_W / 2), currentY, { align: 'center' });
            }
            
            doc.setFont('helvetica', 'normal');
            currentY += 2;

            // Barcode
            try {
                const canvas = document.createElement('canvas');
                // IMPORTANTE: p.currentBarcode contiene el código único de la unidad
                JsBarcode(canvas, p.currentBarcode, {
                    format: 'EAN13', // O CODE128 según se use
                    displayValue: true,
                    fontSize: 16, 
                    margin: 2,
                    height: 50
                });
                const imgData = canvas.toDataURL('image/png');
                // Colocar barcode
                doc.addImage(imgData, 'PNG', x + 5, currentY, 40, 11);
                currentY += 14;
            } catch (err) {
                doc.setFontSize(6);
                doc.text(p.barcode, x + (L_W / 2), currentY + 5, { align: 'center' });
                currentY += 14;
                console.error(err);
            }

            // Precio
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text(`${currency} ${parseFloat(p.price || 0).toFixed(2)}`, x + (L_W / 2), currentY, { align: 'center' });
        });

        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
    };

    return (
        <div className="max-w-7xl mx-auto fade-in h-full flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 shrink-0">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <Tag size={24} strokeWidth={1.8} className="text-pink-600" />
                    Etiquetado Masivo
                </h1>

                <div className="flex gap-2">
                    {missingShortCodesCount > 0 && (
                        <button
                            onClick={handleFixShortCodes}
                            className="btn-secondary flex items-center gap-2 px-4 py-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        >
                            <Wrench size={18} />
                            Reparar {missingShortCodesCount} códigos
                        </button>
                    )}
                    <button onClick={generatePDF} disabled={totalLabelsToPrint === 0}
                        className="btn-primary flex items-center gap-2 px-6 py-2">
                        <Printer size={18} />
                        Imprimir Etiquetas ({totalLabelsToPrint})
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-6 shrink-0">
                <div className="relative md:col-span-2">
                    <input 
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar producto por nombre o código..." 
                        className="fashion-input text-sm" 
                    />
                </div>
                <div>
                    <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="fashion-input text-sm">
                        <option value="">Todas las Categorías</option>
                        {categoriesDB.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <select value={filterStock} onChange={e => setFilterStock(e.target.value)} className="fashion-input text-sm">
                        <option value="all">Todo el inventario</option>
                        <option value="instock">Solo con Stock (&gt;0)</option>
                    </select>
                </div>
                {/* Nuevos Filtros por Fecha */}
                <div className="flex bg-white border border-pink-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-pink-300 transition-all">
                    <div className="px-2 flex items-center bg-pink-50 text-pink-500 border-r border-pink-100">
                        <Calendar size={14} />
                    </div>
                    <input 
                        type="date"
                        value={dateStart}
                        onChange={e => setDateStart(e.target.value)}
                        className="w-full px-2 py-2 text-sm text-gray-700 outline-none"
                        title="Fecha Inicio"
                    />
                </div>
                <div className="flex bg-white border border-pink-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-pink-300 transition-all">
                    <div className="px-2 flex items-center bg-pink-50 text-pink-500 border-r border-pink-100 text-xs font-bold">
                        A
                    </div>
                    <input 
                        type="date"
                        value={dateEnd}
                        onChange={e => setDateEnd(e.target.value)}
                        className="w-full px-2 py-2 text-sm text-gray-700 outline-none"
                        title="Fecha Fin"
                    />
                </div>
            </div>

            {/* Alertas */}
            {missingShortCodesCount > 0 && (
                <div className="mb-4 bg-red-50 border-2 border-red-300 text-red-800 px-4 py-3 rounded-xl text-sm flex items-start gap-2 font-medium shrink-0">
                    <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-600" />
                    <div>
                        <p className="font-bold">⚠️ Se detectaron {missingShortCodesCount} unidades sin código corto único asignado.</p>
                        <p className="mt-1">Esto puede causar duplicación de códigos en las etiquetas. Haga clic en "Reparar códigos" para asignar códigos únicos automáticamente.</p>
                    </div>
                </div>
            )}
            {totalLabelsToPrint > 0 && (() => {
                // Calcular cuántos productos tienen barcodes insuficientes
                const warnProds = Object.entries(selections).filter(([idStr, qty]) => {
                    const pid = parseInt(idStr);
                    return (barcodesMap[pid] || []).length < qty;
                });
                return (
                    <>
                        <div className="mb-2 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl text-sm flex items-center gap-2 font-medium shrink-0">
                            <AlertCircle size={16} />
                            Se imprimirán {totalLabelsToPrint} etiquetas en papel Oficio/Folio (8.5" x 13"). Asegúrese de colocar correctamente el papel en la impresora.
                        </div>
                        {warnProds.length > 0 && (
                            <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded-xl text-sm flex items-start gap-2 font-medium shrink-0">
                                <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                                <span>
                                    <strong>{warnProds.length} producto(s)</strong> tienen menos códigos de barras individuales que etiquetas solicitadas.
                                    Las etiquetas extras usarán el código base del producto (no único por unidad).
                                    Se le pedirá confirmación al generar.
                                </span>
                            </div>
                        )}
                    </>
                );
            })()}

            {/* Tabla */}
            <div className="fashion-card flex-1 flex flex-col min-h-0 relative">
                <div className="overflow-x-auto flex-1 h-full scrollbar-thin">
                    <table className="w-full text-left border-collapse relative">
                        <thead className="bg-pink-50/80 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                            <tr>
                                <th className="px-4 py-3 border-b border-pink-100 w-12 text-center">
                                    <button onClick={handleSelectAll} className="text-pink-600 hover:text-pink-800 transition-colors">
                                        {selectedCount === filteredProducts.length && filteredProducts.length > 0
                                            ? <CheckSquare size={18} /> 
                                            : <Square size={18} />
                                        }
                                    </button>
                                </th>
                                <th className="px-4 py-3 border-b border-pink-100 text-xs font-bold text-pink-800 uppercase tracking-wider">Producto</th>
                                <th className="px-4 py-3 border-b border-pink-100 text-xs font-bold text-pink-800 uppercase tracking-wider">Variante</th>
                                <th className="px-4 py-3 border-b border-pink-100 text-xs font-bold text-pink-800 uppercase tracking-wider text-center">Stock Disp.</th>
                                <th className="px-4 py-3 border-b border-pink-100 text-xs font-bold text-pink-800 uppercase tracking-wider text-center w-32">Cant. Etiquetas</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredProducts.map(p => {
                                const isSelected = !!selections[p.id];
                                return (
                                    <tr key={p.id} className={`transition-colors border-b border-pink-50 last:border-0 hover:bg-pink-50/50 ${isSelected ? 'bg-pink-50/80' : ''}`}>
                                        <td className="px-4 py-3 text-center">
                                            <button onClick={() => toggleSelection(p.id)} className={`transition-colors ${isSelected ? 'text-pink-600' : 'text-gray-300 hover:text-pink-400'}`}>
                                                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 cursor-pointer" onClick={() => toggleSelection(p.id)}>
                                            <p className="font-semibold text-pink-900 text-sm">{p.name}</p>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-pink-800">
                                            {p.size || p.color ? (
                                                <div className="flex gap-1">
                                                    {p.size && <span className="bg-white px-2 py-0.5 rounded border border-pink-200 text-xs">{p.size}</span>}
                                                    {p.color && <span className="bg-white px-2 py-0.5 rounded border border-pink-200 text-xs">{p.color}</span>}
                                                </div>
                                            ) : <span className="text-gray-400 text-xs">-</span>}
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm font-semibold text-pink-900">
                                            {p.stock}
                                            <p className="text-[10px] text-pink-400 font-normal">({(barcodesMap[p.id] || []).length} etiquetas)</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {(barcodesMap[p.id] || []).map((b, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`flex flex-col text-[10px] px-1.5 py-0.5 rounded border ${
                                                            b.shortCode
                                                                ? 'bg-pink-50 border-pink-100'
                                                                : 'bg-red-50 border-red-200 font-bold'
                                                        }`}
                                                        title={`Corto: ${b.shortCode || 'Sin código'} | EAN: ${b.barcode}`}
                                                    >
                                                        <span className="font-bold text-pink-600">
                                                            {b.shortCode || '⚠️ Sin código'}
                                                        </span>
                                                        <span className="font-mono text-blue-500">
                                                            {b.barcode}
                                                        </span>
                                                    </div>
                                                ))}
                                                {(!(barcodesMap[p.id] || []).length) && (
                                                    <span className="text-[10px] text-gray-400 italic">Sin unidades individuales</span>
                                                )}
                                            </div>
                                            {isSelected ? (
                                                <input 
                                                    type="number" min="1" 
                                                    max={(barcodesMap[p.id] || []).length || p.stock} 
                                                    value={selections[p.id]} 
                                                    onChange={e => {
                                                        const maxAllowed = (barcodesMap[p.id] || []).length || p.stock;
                                                        let val = parseInt(e.target.value) || 1;
                                                        if (val > maxAllowed) val = maxAllowed;
                                                        changeLabelCount(p.id, val);
                                                    }}
                                                    className="w-full text-center fashion-input py-1 text-sm font-bold border-pink-300" 
                                                />
                                            ) : (
                                                <div className="w-full text-center text-gray-300 text-xs select-none">No selec.</div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {filteredProducts.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="px-4 py-12 text-center text-pink-400">
                                        No hay productos que coincidan con la búsqueda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
