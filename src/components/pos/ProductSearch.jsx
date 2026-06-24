import React from 'react';
import { Barcode, Package } from 'lucide-react';
import { db, findProductByBarcode } from '../../db';
import { useAvailableStock } from '../../hooks/useAvailableStock';
import { formatCurrency } from '../../utils';

/**
 * 🔍 ProductSearch — Buscador de productos para el POS
 * Soporta escaneo por código de barras, shortCode y búsqueda por nombre.
 *
 * @prop {string}   currency      - Símbolo de moneda
 * @prop {Function} onAdd         - Callback al seleccionar un producto: onAdd(product)
 * @prop {boolean}  scanFlash     - Si true, muestra efecto visual de escaneo
 * @prop {Function} onError       - Callback para reportar errores: onError(msg)
 */
export default function ProductSearch({ currency, onAdd, scanFlash, onError }) {
    const reservedMap = useAvailableStock() || {};
    const [query, setQuery] = React.useState('');
    const [results, setResults] = React.useState([]);
    const inputRef = React.useRef(null);

    // ── Refocus: solo regresa el foco al buscador si el foco va a un elemento
    //    que NO es un campo de formulario (input, textarea, select, button)
    const refocus = React.useCallback((e) => {
        const goingTo = e?.relatedTarget;
        const tag = goingTo?.tagName?.toUpperCase();
        // Si el foco va a otro input/textarea/select/button, no interferir
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
        setTimeout(() => {
            // Segunda verificación: si ya hay otro input activo, no mover el foco
            const active = document.activeElement?.tagName?.toUpperCase();
            if (active === 'INPUT' || active === 'TEXTAREA' || active === 'SELECT') return;
            inputRef.current?.focus();
        }, 80);
    }, []);

    // Captura global del teclado para el scanner físico
    // Solo redirige teclas cuando NINGÚN campo de formulario está activo
    React.useEffect(() => {
        const handleGlobal = (e) => {
            if (document.activeElement === inputRef.current) return;
            const tag = document.activeElement?.tagName?.toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleGlobal);
        return () => window.removeEventListener('keydown', handleGlobal);
    }, []);

    // Búsqueda reactiva con debounce 250ms
    React.useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        const timer = setTimeout(async () => {
            const q = query.trim().toLowerCase();
            const isCode = /^\d+$/.test(q);
            const all = await db.products.toArray();

            // Obtener shortCodes reservados por reservas pendientes
            const pendingRes = await db.reservations.where('status').equals('pending').toArray();
            const reservedCodes = new Set(pendingRes.map(r => r.productShortCode).filter(Boolean));

            let unitProductIds = new Set();
            if (isCode) {
                // Match EXACTO en barcodes: solo unidades disponibles (no vendidas, no reservadas)
                const matchingUnits = await db.barcodes.filter(b =>
                    !b.used && !reservedCodes.has(b.shortCode) &&
                    (b.shortCode === q || b.barcode === q)
                ).toArray();
                unitProductIds = new Set(matchingUnits.map(b => b.productId));
            }

            const found = all.filter(p => {
                const available = p.stock - (reservedMap[p.id] || 0);
                if (available <= 0 || p.active === false) return false;
                if (isCode) {
                    // Para códigos: match exacto en producto o unidades disponibles
                    return p.barcode === q || p.shortCode === q || unitProductIds.has(p.id);
                }
                // Para texto: match parcial solo en nombre y marca
                return p.name?.toLowerCase().includes(q) ||
                       p.brand?.toLowerCase().includes(q);
            }).slice(0, 10);
            setResults(found);
        }, 250);
        return () => clearTimeout(timer);
    }, [query, reservedMap]);

    const handleKeyDown = async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const code = query.trim();
        if (!code) return;

        // Verificar si el código corresponde a una unidad vendida o reservada
        const isCode = /^\d+$/.test(code);
        if (isCode) {
            const unit = await db.barcodes.where('shortCode').equals(code).or('barcode').equals(code).first();
            if (unit) {
                if (unit.used) { onError('Este código ya fue vendido'); return; }
                const pendingRes = await db.reservations.where('status').equals('pending').toArray();
                const reservedCodes = new Set(pendingRes.map(r => r.productShortCode).filter(Boolean));
                if (reservedCodes.has(unit.shortCode)) { onError('Este código está reservado'); return; }
            }
        }

        const p = await findProductByBarcode(code);
        if (p) {
            const available = p.stock - (reservedMap[p.id] || 0);
            if (available > 0) { onAdd(p, code); setQuery(''); setResults([]); return; }
            else { onError(`Sin stock disponible para "${p.name}"`); return; }
        }

        // Obtener shortCodes reservados
        const pendingResAll = await db.reservations.where('status').equals('pending').toArray();
        const reservedCodesAll = new Set(pendingResAll.map(r => r.productShortCode).filter(Boolean));

        // Búsqueda: solo unidades disponibles (no vendidas, no reservadas), match exacto para códigos
        let unitProductIds = new Set();
        if (isCode) {
            const matchingUnits = await db.barcodes.filter(b =>
                !b.used && !reservedCodesAll.has(b.shortCode) &&
                (b.shortCode === code || b.barcode === code)
            ).toArray();
            unitProductIds = new Set(matchingUnits.map(b => b.productId));
        }

        const all = await db.products.toArray();
        const byName = all.filter(p => {
            const available = p.stock - (reservedMap[p.id] || 0);
            if (p.active === false || available <= 0) return false;
            if (isCode) {
                return p.barcode === code || p.shortCode === code || unitProductIds.has(p.id);
            }
            return p.name?.toLowerCase().includes(code.toLowerCase()) ||
                   p.brand?.toLowerCase().includes(code.toLowerCase());
        }).slice(0, 10);

        if (byName.length === 1) { onAdd(byName[0], code); setQuery(''); setResults([]); }
        else setResults(byName);
    };

    const selectProduct = (p) => {
        // Solo pasar el código buscado si es un código (no un nombre de texto)
        const code = query.trim();
        const isCode = /^\d+$/.test(code);
        onAdd(p, isCode ? code : ''); setQuery(''); setResults([]); refocus();
    };

    return (
        <div className={`fashion-card p-4 transition-all duration-300 ${scanFlash ? 'ring-2 ring-green-400 bg-green-50/30' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                    <Barcode size={18} className="text-pink-500" />
                    <span className="font-semibold text-pink-900 text-sm">Buscar Producto</span>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    {scanFlash ? '✓ Escaneado!' : 'Listo para escanear'}
                </span>
            </div>
            <input
                ref={inputRef}
                id="pos-search"
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={refocus}
                placeholder="Escanear código o escribir nombre..."
                className={`fashion-input transition-all ${scanFlash ? 'border-green-400' : ''}`}
            />
            {results.length > 0 && (
                <div className="mt-2 border border-pink-100 rounded-xl overflow-hidden shadow-lg">
                    {results.map(p => (
                        <button key={p.id} onClick={() => selectProduct(p)}
                            className="w-full flex items-center justify-between px-4 py-3
                                       hover:bg-pink-50 transition-colors border-b border-pink-50 last:border-0 text-left">
                            <div className="flex items-center gap-3">
                                {p.photo ? (
                                    <img src={p.photo} alt={p.name} className="w-10 h-10 rounded-lg object-cover shrink-0 border border-pink-100" />
                                ) : (
                                    <div className="w-10 h-10 rounded-lg bg-pink-50 flex items-center justify-center shrink-0 border border-pink-100">
                                        <Package size={20} className="text-pink-300" />
                                    </div>
                                )}
                                <div>
                                    <p className="font-semibold text-pink-900 text-sm">{p.name}</p>
                                    <p className="text-xs text-pink-500">
                                        {p.size && `Talla: ${p.size}`} {p.color && `· ${p.color}`} · Stock: {p.stock}
                                    </p>
                                </div>
                            </div>
                            <span className="font-bold text-pink-700">{formatCurrency(p.price, currency)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
