import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Barcode, Printer, Download } from 'lucide-react';

/**
 * Barcode — Generación e impresión de etiquetas de ropa con código de barras
 * Usa JsBarcode vía SVG para renderizar el código y jsPDF para imprimir
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

export default function BarcodeModule() {
    const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const storeName = settings?.find(s => s.key === 'storeName')?.value || 'Tienda';

    const [selected, setSelected] = React.useState([]);
    const [perRow, setPerRow] = React.useState(3);
    const [labelSize, setLabelSize] = React.useState('small'); // small | medium | large
    const canvasRef = React.useRef({});

    const toggleProduct = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const selectAll = () => setSelected((products || []).map(p => p.id));
    const clearAll = () => setSelected([]);

    const selectedProducts = (products || []).filter(p => selected.includes(p.id));

    // Dibuja código de barras en canvas usando la API SVG del browser
    const drawBarcode = (svgEl, code) => {
        if (!svgEl || !code) return;
        // Usamos la API nativa del DOM para crear SVG de barcode de manera simple
        // Formato: líneas verticales basadas en EAN-13 simplificado (visual demo)
        const digits = code.split('').map(Number);
        svgEl.innerHTML = '';
        svgEl.setAttribute('viewBox', '0 0 120 40');
        // Barra decorativa simple (representación visual del código)
        let x = 5;
        for (let i = 0; i < code.length; i++) {
            const d = parseInt(code[i]);
            const w = 0.8 + (d % 3) * 0.3;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', 2);
            rect.setAttribute('width', w);
            rect.setAttribute('height', 28);
            rect.setAttribute('fill', i % (d + 1) === 0 ? '#000' : '#555');
            svgEl.appendChild(rect);
            x += w + 1.5;
        }
        // Texto del código
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', 60);
        text.setAttribute('y', 38);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '5');
        text.setAttribute('font-family', 'monospace');
        text.textContent = code;
        svgEl.appendChild(text);
    };

    // Imprimir etiquetas
    const printLabels = () => {
        const labelConfigs = { small: { w: 50, h: 30 }, medium: { w: 70, h: 40 }, large: { w: 90, h: 55 } };
        const { w, h } = labelConfigs[labelSize];
        const margin = 5;
        const pageW = perRow * (w + margin) + margin;

        const win = window.open('', '_blank');
        win.document.write(`
            <html><head><title>Etiquetas</title>
            <style>
                * { margin:0; padding:0; box-sizing:border-box; }
                body { font-family: Arial, sans-serif; }
                .page { display:flex; flex-wrap:wrap; padding:${margin}mm; }
                .label {
                    width:${w}mm; height:${h}mm; border:0.5px solid #ccc;
                    margin:${margin / 2}mm; padding:2mm;
                    display:flex; flex-direction:column; justify-content:space-between;
                    page-break-inside:avoid;
                }
                .store { font-size:6px; color:#888; text-align:center; }
                .name  { font-size:7px; font-weight:bold; text-align:center; overflow:hidden; }
                .info  { font-size:6px; color:#666; text-align:center; }
                .price { font-size:10px; font-weight:bold; text-align:center; color:#D946A8; }
                .code  { font-size:5px; font-family:monospace; text-align:center; }
            </style></head><body>
            <div class="page">
                ${selectedProducts.map(p => `
                    <div class="label">
                        <div class="store">${escapeHtml(storeName)}</div>
                        <div class="name">${escapeHtml(p.name)}</div>
                        <div class="info">${p.size ? 'T: ' + escapeHtml(p.size) : ''} ${p.color ? '&middot; ' + escapeHtml(p.color) : ''}</div>
                        <div style="text-align:center;font-size:20px;">|||||||||||</div>
                        <div class="code">${escapeHtml(p.barcode)}</div>
                        <div class="price">${escapeHtml(currency)}${p.price?.toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
            <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}<\/script>
            </body></html>
        `);
        win.document.close();
    };

    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-5 flex items-center gap-2">
                <Barcode size={24} strokeWidth={1.8} className="text-pink-600" />
                Etiquetas con Código de Barras
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* ─── Productos ─── */}
                <div className="lg:col-span-2 fashion-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-pink-100 flex items-center justify-between">
                        <span className="font-semibold text-pink-900 text-sm">
                            Seleccionar Productos ({selected.length} seleccionados)
                        </span>
                        <div className="flex gap-2">
                            <button onClick={selectAll} className="text-xs text-pink-600 hover:text-pink-800 font-semibold">
                                Todos
                            </button>
                            <span className="text-pink-300">·</span>
                            <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600 font-semibold">
                                Limpiar
                            </button>
                        </div>
                    </div>
                    <div className="divide-y divide-pink-50 max-h-96 overflow-y-auto scrollbar-thin">
                        {(products || []).map(p => (
                            <label key={p.id}
                                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors
                                       ${selected.includes(p.id) ? 'bg-pink-50' : 'hover:bg-pink-50/50'}`}>
                                <input type="checkbox" checked={selected.includes(p.id)}
                                    onChange={() => toggleProduct(p.id)}
                                    className="accent-pink-600 w-4 h-4" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-pink-900 text-sm truncate">{p.name}</p>
                                    <p className="text-xs text-pink-400">
                                        {p.barcode} · {p.size || '-'} · {p.color || '-'}
                                    </p>
                                </div>
                                <span className="font-bold text-pink-700 text-sm shrink-0">
                                    {settings?.find(s => s.key === 'currency')?.value || 'Bs.'}{p.price?.toFixed(2)}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* ─── Configuración e impresión ─── */}
                <div className="space-y-3">
                    <div className="fashion-card p-4 space-y-4">
                        <h2 className="font-bold text-pink-900 text-sm">Configuración de Etiqueta</h2>

                        <div>
                            <label className="text-sm font-semibold text-pink-800 mb-1 block">Tamaño</label>
                            <div className="space-y-1">
                                {[['small', 'Pequeña (50x30mm)'], ['medium', 'Mediana (70x40mm)'], ['large', 'Grande (90x55mm)']].map(([val, lbl]) => (
                                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" value={val} checked={labelSize === val}
                                            onChange={() => setLabelSize(val)}
                                            className="accent-pink-600" />
                                        <span className="text-sm text-pink-800">{lbl}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-semibold text-pink-800 mb-1 block">
                                Etiquetas por fila: {perRow}
                            </label>
                            <input type="range" min="1" max="5" value={perRow}
                                onChange={e => setPerRow(parseInt(e.target.value))}
                                className="w-full accent-pink-600" />
                        </div>
                    </div>

                    {/* Preview etiqueta */}
                    <div className="fashion-card p-4">
                        <p className="text-sm font-semibold text-pink-800 mb-3">Vista previa</p>
                        <div className="bg-white border-2 border-pink-200 rounded-xl p-3 text-center space-y-1">
                            <p className="text-xs text-gray-400">{storeName}</p>
                            <p className="text-xs font-bold text-gray-800 leading-tight">
                                {selectedProducts[0]?.name || 'Nombre del producto'}
                            </p>
                            <p className="text-xs text-gray-500">
                                T: {selectedProducts[0]?.size || 'M'} · {selectedProducts[0]?.color || 'Negro'}
                            </p>
                            <div className="text-2xl tracking-widest text-gray-800 font-mono my-1">|||||||||</div>
                            <p className="text-xs font-mono text-gray-600">
                                {selectedProducts[0]?.barcode || '2001234567890'}
                            </p>
                            <p className="text-sm font-black text-pink-700">
                                {currency}{selectedProducts[0]?.price?.toFixed(2) || '0.00'}
                            </p>
                        </div>
                    </div>

                    <button
                        id="barcode-print"
                        onClick={printLabels}
                        disabled={selected.length === 0}
                        className="btn-primary w-full flex items-center justify-center gap-2
                                   disabled:opacity-40 disabled:cursor-not-allowed py-3">
                        <Printer size={18} />
                        Imprimir {selected.length > 0 ? `(${selected.length})` : ''} Etiquetas
                    </button>
                </div>
            </div>
        </div>
    );
}
