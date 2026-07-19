import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, syncClosureIfDateExists, getLocalISOString } from '../db';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import {
    Tag, Plus, X, CheckCircle, AlertCircle,
    Clock, DollarSign, User, Phone, Package,
    ChevronDown, ChevronUp, Banknote, XCircle, Eye, Printer, Edit2
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { useAvailableStock } from '../hooks/useAvailableStock';
import { formatCurrency, drawPDFHeader } from '../utils';
import { splitProportional } from '../utils/reservationSplit';
import { groupReservations, summarizeGroup } from '../utils/reservationGroups';
import useCashRegister from '../hooks/useCashRegister';
import { useUser } from '../contexts/UserContext';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
    pending: { text: 'En Proceso', cls: 'badge-blue' },
    completed: { text: 'Completada', cls: 'badge-green' },
    cancelled: { text: 'Cancelada', cls: 'badge-red' },
    mixed: { text: 'Mixta', cls: 'badge-blue' },
};

function ProgressBar({ paid, total }) {
    const pct = Math.min(100, total > 0 ? (paid / total) * 100 : 0);
    return (
        <div className="w-full bg-pink-100 rounded-full h-2 overflow-hidden">
            <div className="h-2 rounded-full transition-all duration-500"
                style={{
                    width: `${pct}%`,
                    background: pct >= 100
                        ? 'linear-gradient(90deg,#16A34A,#15803D)'
                        : 'linear-gradient(90deg,#D946A8,#A3308A)',
                }} />
        </div>
    );
}

// ─── Componente principal ───────────────────────────────────────────────────────
export default function Reservations() {
    const { user } = useUser();
    const { shiftId: activeShiftId } = useCashRegister();
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const storeLogo = settings?.find(s => s.key === 'storeLogo')?.value || '';
    const resDays = parseInt(settings?.find(s => s.key === 'returnDays')?.value || '15');
    const returnFallback = 'Cambios y devoluciones válidos hasta 15 días desde la fecha de compra, presentando este comprobante. Pasado este plazo, no se aceptarán devoluciones.';
    const expiryFallback = 'RESERVA VIGENTE POR 15 DÍAS. Transcurrido este plazo sin efectuar el pago total, la reserva quedará anulada y el anticipo ingresará como ingreso a favor de la tienda. Condición aceptada al momento de la reserva.';
    const defExpiryMsg = settings?.find(s => s.key === 'reservationExpiryMessage')?.value || expiryFallback;
    const returnMsg = settings?.find(s => s.key === 'returnMessage')?.value || returnFallback;

    const reservations = useLiveQuery(() =>
        db.reservations.orderBy('createdAt').reverse().toArray(), []);
    const payments = useLiveQuery(() =>
        db.reservationPayments.toArray(), []);
    const products = useLiveQuery(() =>
        db.products.orderBy('name').toArray(), []);

    // ── Mapa de productos reservados: id -> cantidad ──
    const reservedMap = useAvailableStock() || {};

    // ── Estado local ──
    const [tab, setTab] = React.useState('active');   // active | history
    const [showNew, setShowNew] = React.useState(false);
    const [detail, setDetail] = React.useState(null);       // reserva abierta en panel
    const [openGroup, setOpenGroup] = React.useState(null); // grupo abierto en panel (cliente+fecha)
    const { msg, showMsg } = useNotification();
    const [confirm, setConfirm] = React.useState(null);       // { type, reservaId }
    const [abonoAmt, setAbonoAmt] = React.useState('');
    const [abonoPayment, setAbonoPayment] = React.useState('efectivo');
    const [abonoNote, setAbonoNote] = React.useState('');
    const [abonoBusy, setAbonoBusy] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [confirmCreate, setConfirmCreate] = React.useState(null); // datos validados pendientes de confirmar

    // ── Estado formulario nueva reserva ──
    const EMPTY_FORM = {
    clientName: '', clientPhone: '', notes: '', initialPayment: '',
    expiryMessage: '', paymentMethod: 'efectivo'
};
    const MAX_ITEMS = 5;   // máximo de prendas por reserva agrupada
    const [form, setForm] = React.useState(EMPTY_FORM);
    const [prodSearch, setProdSearch] = React.useState('');
    const [prodResults, setProdResults] = React.useState([]);
    // Prendas del grupo: { product, customPrice, priceError, searchedUnitCode }
    const [items, setItems] = React.useState([]);
    const [showProductSearch, setShowProductSearch] = React.useState(true);
    const itemsRef = React.useRef([]);
    itemsRef.current = items;
    const skipSearchRef = React.useRef(false);
    const [formBusy, setFormBusy] = React.useState(false);
    const maxDiscount = parseFloat(settings?.find(s => s.key === 'maxDiscount')?.value || '10');

    // Precio final de una prenda del grupo (con descuento si lo tiene)
    const itemFinalPrice = (it) => it.customPrice !== '' ? parseFloat(it.customPrice) : it.product.price;
    const groupTotal = Math.round(items.reduce((s, it) => s + (itemFinalPrice(it) || 0), 0) * 100) / 100;

    // ── Set de shortCodes ya reservados por reservas pendientes ──
    const reservedUnitCodes = React.useMemo(() => {
        return new Set(
            (reservations || [])
                .filter(r => r.status === 'pending' && r.productShortCode)
                .map(r => r.productShortCode)
        );
    }, [reservations]);

    // ── Búsqueda de producto en formulario ──
    // ── Búsqueda de producto con query directa a BD (igual que POS) ──
    React.useEffect(() => {
        if (!prodSearch.trim()) { setProdResults([]); return; }
        // Evitar re-búsqueda cuando se puso el nombre del producto tras selección
        if (skipSearchRef.current) { skipSearchRef.current = false; return; }
        const timer = setTimeout(async () => {
            const q = prodSearch.trim().toLowerCase();
            const isCode = /^\d+$/.test(q);

            // Obtener reservas pendientes para exclusión
            const pendingRes = await db.reservations.where('status').equals('pending').toArray();
            const pendingResCodes = new Set(pendingRes.map(r => r.productShortCode).filter(Boolean));
            const resMap = {};
            pendingRes.forEach(r => { resMap[r.productId] = (resMap[r.productId] || 0) + 1; });

            // Exclusión adicional: unidades y cantidades ya elegidas en el propio grupo
            const groupItems = itemsRef.current;
            const groupCodes = new Set(groupItems.map(it => it.searchedUnitCode).filter(Boolean));
            const groupCount = {};
            groupItems.forEach(it => { groupCount[it.product.id] = (groupCount[it.product.id] || 0) + 1; });

            // Buscar barcodes: solo disponibles (no vendidas, no reservadas, no en el grupo)
            let unitProductIds = new Set();
            let matchingBarcodes = [];
            if (isCode) {
                // Match EXACTO para códigos numéricos
                matchingBarcodes = await db.barcodes
                    .filter(b =>
                        !b.used && !pendingResCodes.has(b.shortCode) && !groupCodes.has(b.shortCode) &&
                        (b.shortCode === q || b.barcode === q)
                    ).toArray();
                unitProductIds = new Set(matchingBarcodes.map(b => b.productId));
            }

            const allProducts = await db.products.orderBy('name').toArray();

            const res = allProducts.filter(p => {
                const available = (p.stock || 0) - (resMap[p.id] || 0) - (groupCount[p.id] || 0);
                if (p.active === false || available <= 0) return false;
                if (isCode) {
                    return p.barcode === q || p.shortCode === q || unitProductIds.has(p.id);
                }
                return p.name?.toLowerCase().includes(q) ||
                       p.brand?.toLowerCase().includes(q);
            }).slice(0, 8);

            // ── Auto-selección: si el código buscado coincide exactamente con un
            //    shortCode o barcode unitario libre y hay un solo producto resultado ──
            if (isCode && res.length >= 1) {
                const freeExactUnit = matchingBarcodes[0];
                if (freeExactUnit) {
                    const matchedProduct = res.find(p => p.id === freeExactUnit.productId);
                    if (matchedProduct) {
                        addItem(matchedProduct, freeExactUnit.shortCode || '');
                        return;
                    }
                }
            }

            setProdResults(res);
        }, 200);
        return () => clearTimeout(timer);
    }, [prodSearch]);

    // ── Agregar prenda al grupo (hasta MAX_ITEMS) ──
    const addItem = async (p, preResolvedCode) => {
        if (itemsRef.current.length >= MAX_ITEMS) {
            showMsg('error', `Máximo ${MAX_ITEMS} prendas por reserva`);
            return;
        }
        const groupCodes = new Set(itemsRef.current.map(it => it.searchedUnitCode).filter(Boolean));
        const code = prodSearch.trim();
        let resolvedCode = preResolvedCode || '';
        // Resolver código unitario sin importar si es numérico o alfanumérico
        if (!resolvedCode && code) {
            const productBarcodes = await db.barcodes
                .where('productId').equals(p.id)
                .toArray();
            const pendingRes = await db.reservations
                .where('productId').equals(p.id)
                .and(r => r.status === 'pending')
                .toArray();
            const reservedCodes = new Set(pendingRes.map(r => r.productShortCode).filter(Boolean));
            const isFree = b => !b.used && !reservedCodes.has(b.shortCode) && !groupCodes.has(b.shortCode);

            // Match exacto primero
            const exactMatch = productBarcodes.find(b =>
                isFree(b) && (b.shortCode === code || b.barcode === code)
            );
            // Match parcial solo si no hay exacto
            const matched = exactMatch || productBarcodes.find(b =>
                isFree(b) &&
                ((b.shortCode && b.shortCode.includes(code)) ||
                 (b.barcode && b.barcode.includes(code)))
            );
            resolvedCode = matched?.shortCode || '';
        }
        // Nunca repetir la misma unidad física dentro del grupo
        if (resolvedCode && groupCodes.has(resolvedCode)) resolvedCode = '';

        setItems(prev => [...prev, { product: p, customPrice: '', priceError: '', searchedUnitCode: resolvedCode }]);
        setShowProductSearch(false);
        setProdSearch('');
        setProdResults([]);
    };

    // ── Quitar prenda del grupo ──
    const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

    // ── Editar precio de una prenda del grupo (misma validación que antes) ──
    const updateItemPrice = (idx, val) => {
        setItems(prev => prev.map((it, i) => {
            if (i !== idx) return it;
            let err = '';
            if (val !== '') {
                const num = parseFloat(val);
                if (isNaN(num) || num <= 0) err = 'El precio debe ser mayor a 0';
                else if (it.product.cost && num <= it.product.cost) err = `No puede ser menor o igual al costo (${formatCurrency(it.product.cost, currency)})`;
                else if (it.product.price - num < 0) err = 'El precio no puede ser mayor al original';
                else if (maxDiscount > 0 && (it.product.price - num) > maxDiscount) err = `Rebaja máxima: ${formatCurrency(maxDiscount, currency)}`;
            }
            return { ...it, customPrice: val, priceError: err };
        }));
    };

    // ── Calcular datos de una reserva ──
    const getReservationData = React.useCallback((reserva) => {
        const pays = (payments || []).filter(p => p.reservationId === reserva.id);
        const paid = pays.reduce((s, p) => s + (p.amount || 0), 0);
        const remaining = (reserva.totalPrice || 0) - paid;
        return { pays, paid, remaining };
    }, [payments]);

    // ── Mapa productId → shortCode del modelo (para búsqueda en lista) ──
    const productShortCodeMap = React.useMemo(() => {
        const m = {};
        (products || []).forEach(p => { if (p.shortCode) m[p.id] = p.shortCode; });
        return m;
    }, [products]);

    // ── Grupos de reservas: mismo cliente + misma fecha → una sola tarjeta ──
    // TODAS las reservas son visibles para vendedores y admin (sin filtro por vendedor).
    const groups = React.useMemo(() => {
        if (!reservations) return [];
        const byTab = reservations.filter(r =>
            tab === 'active' ? r.status === 'pending' : r.status !== 'pending');
        const grouped = groupReservations(byTab);
        const q = search.trim().toLowerCase();
        if (!q) return grouped;
        return grouped.filter(g => {
            if (g.clientName.toLowerCase().includes(q)) return true;
            if ((g.clientPhone || '').includes(search.trim())) return true;
            return g.items.some(r =>
                r.productName?.toLowerCase().includes(q) ||
                (r.productShortCode || '').toLowerCase().includes(q) ||
                (r.productBarcode || '').toLowerCase().includes(q) ||
                (productShortCodeMap[r.productId] || '').includes(search.trim()));
        });
    }, [reservations, tab, search, productShortCodeMap]);

    // Contador de la pestaña "En Proceso": grupos activos (coincide con las tarjetas)
    const activeGroupCount = React.useMemo(() =>
        groupReservations((reservations || []).filter(r => r.status === 'pending')).length,
    [reservations]);

    // Grupo abierto, re-derivado de `groups` para tener datos FRESCOS tras cada
    // cambio en BD (abono/entrega/cancelación cierra el detalle y vuelve al grupo)
    const liveGroup = openGroup ? groups.find(g => g.key === openGroup.key) || null : null;

    // ════════════════════════════════════════════════════════
    // ACCIONES
    // ════════════════════════════════════════════════════════

    /** Validar formulario y mostrar modal de confirmación antes de guardar */
    const handleCreate = async (e) => {
        e.preventDefault();
        if (items.length === 0) { showMsg('error', 'Agrega al menos una prenda'); return; }
        const badPrice = items.find(it => it.priceError);
        if (badPrice) { showMsg('error', badPrice.priceError); return; }
        const cname = form.clientName.trim();
        if (!cname) { showMsg('error', 'El nombre del cliente es obligatorio'); return; }
        if (cname.length < 2) { showMsg('error', 'El nombre del cliente debe tener al menos 2 caracteres'); return; }
        const initPay = parseFloat(form.initialPayment);
        if (isNaN(initPay) || initPay < 0.01) { showMsg('error', 'El abono inicial debe ser mayor a 0'); return; }
        if (initPay > groupTotal) { showMsg('error', `El abono no puede superar el total del grupo (${formatCurrency(groupTotal, currency)})`); return; }

        // Stock disponible por producto: descontar reservas pendientes de otros
        // clientes Y las unidades ya elegidas dentro del propio grupo
        const perProduct = {};
        items.forEach(it => { perProduct[it.product.id] = (perProduct[it.product.id] || 0) + 1; });
        for (const it of items) {
            const reserved = reservedMap[it.product.id] || 0;
            const available = (it.product.stock || 0) - reserved;
            if (available < perProduct[it.product.id]) {
                showMsg('error', `Stock insuficiente de "${it.product.name}": hay ${Math.max(0, available)} unidad(es) libre(s) y el grupo pide ${perProduct[it.product.id]}`);
                return;
            }
        }

        // Validar que las unidades buscadas no estén reservadas ni repetidas en el grupo
        const seenCodes = new Set();
        for (const it of items) {
            if (!it.searchedUnitCode) continue;
            if (reservedUnitCodes.has(it.searchedUnitCode)) {
                showMsg('error', `La unidad con código ${it.searchedUnitCode} ya está reservada. Busca otra unidad disponible.`);
                return;
            }
            if (seenCodes.has(it.searchedUnitCode)) {
                showMsg('error', `La unidad ${it.searchedUnitCode} está repetida en el grupo. Quita una de las dos.`);
                return;
            }
            seenCodes.add(it.searchedUnitCode);
        }

        // Todo válido → mostrar confirmación en lugar de guardar directamente
        setConfirmCreate({
            cname, initPay, total: groupTotal,
            items: items.map(it => ({ product: it.product, finalPrice: itemFinalPrice(it), searchedCode: it.searchedUnitCode })),
            form: { ...form },
        });
    };

    /** Ejecutar guardado después de confirmación del modal */
    const executeCreate = async () => {
        if (!confirmCreate) return;
        const { cname, initPay, items: groupItems, form: savedForm } = confirmCreate;
        setConfirmCreate(null);
        setFormBusy(true);
        try {
            // Reparto proporcional del abono (cuadra al centavo en la última prenda)
            const shares = splitProportional(initPay, groupItems.map(it => it.finalPrice));
            // groupId solo para reservas de más de una prenda (retrocompatibilidad)
            const groupId = groupItems.length > 1
                ? (typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `grp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
                : null;
            const paymentNote = groupItems.length > 1 ? 'Abono inicial (proporcional)' : 'Abono inicial';

            await db.transaction('rw', db.reservations, db.reservationPayments, db.barcodes, async () => {
                // Unidades ya asignadas DENTRO del propio grupo (no repetir la misma prenda física)
                const assignedCodes = new Set();

                for (let i = 0; i < groupItems.length; i++) {
                    const { product, finalPrice, searchedCode } = groupItems[i];

                    // Obtener shortCodes ya reservados por otras reservas pendientes del mismo producto
                    const pendingReservations = await db.reservations
                        .where('productId').equals(product.id)
                        .and(r => r.status === 'pending')
                        .toArray();
                    const reservedShortCodes = new Set(
                        pendingReservations.map(r => r.productShortCode).filter(Boolean)
                    );

                    // Leer TODOS los barcodes del producto y filtrar en JS puro
                    const allProductBarcodes = await db.barcodes
                        .where('productId').equals(product.id)
                        .toArray();

                    const availableUnits = allProductBarcodes.filter(b =>
                        !b.used && !reservedShortCodes.has(b.shortCode) && !assignedCodes.has(b.shortCode)
                    );

                    // Buscar la unidad específica que el vendedor buscó
                    let assignedUnit = null;

                    if (searchedCode && availableUnits.length > 0) {
                        // Match exacto primero
                        assignedUnit = availableUnits.find(b =>
                            b.shortCode === searchedCode || b.barcode === searchedCode
                        );
                        // Match parcial si no hay exacto
                        if (!assignedUnit) {
                            assignedUnit = availableUnits.find(b =>
                                (b.shortCode && b.shortCode.includes(searchedCode)) ||
                                (b.barcode && b.barcode.includes(searchedCode))
                            );
                        }
                    }

                    // Si no se encontró la preferida, asignar la primera libre
                    if (!assignedUnit && availableUnits.length > 0) {
                        assignedUnit = availableUnits[0];
                    }

                    const unitShortCode = assignedUnit?.shortCode || product.shortCode || '';
                    const unitBarcode = assignedUnit?.barcode || '';
                    if (assignedUnit?.shortCode) assignedCodes.add(assignedUnit.shortCode);

                    const reservaId = await db.reservations.add({
                        clientName: cname.toUpperCase(),
                        clientPhone: savedForm.clientPhone.trim(),
                        productId: product.id,
                        productName: product.name,
                        productSize: product.size || '',
                        productColor: product.color || '',
                        productShortCode: unitShortCode,
                        productBarcode: unitBarcode,
                        totalPrice: finalPrice,
                        originalPrice: product.price,
                        status: 'pending',
                        notes: savedForm.notes.trim().toUpperCase(),
                        expiryMessage: savedForm.expiryMessage || defExpiryMsg,
                        expiryDate: new Date(Date.now() + resDays * 24 * 60 * 60 * 1000).toISOString(),
                        sellerId: user?.id,
                        sellerName: user?.name || user?.username,
                        createdAt: getLocalISOString(),
                        ...(groupId ? { groupId } : {}),
                    });
                    await db.reservationPayments.add({
                        reservationId: reservaId,
                        date: getLocalISOString(),
                        amount: shares[i],
                        paymentMethod: savedForm.paymentMethod || 'efectivo',
                        notes: paymentNote,
                        registeredBy: user?.name || user?.username,
                        userId: user?.id,
                        shiftId: activeShiftId || undefined,
                    });
                }
            });

            await syncClosureIfDateExists(getLocalISOString().slice(0, 10), user?.id, activeShiftId);

            showMsg('success', groupItems.length > 1
                ? `✅ Reserva creada: ${groupItems.length} prendas apartadas en un solo grupo`
                : '✅ Reserva creada correctamente (prenda apartada)');
            setShowNew(false);
            setForm(EMPTY_FORM);
            setItems([]);
            setShowProductSearch(true);
            setProdSearch('');
        } catch (err) {
            showMsg('error', err.message || 'Error al crear la reserva');
        } finally {
            setFormBusy(false);
        }
    };

    /** Registrar abono a una reserva */
    const handleAbono = async () => {
        if (!detail) return;

        setAbonoBusy(true);
        try {
            // ── VALIDACIÓN EN TRANSMISIÓN: Leer pagos directamente de DB (no de cache) ──
            const currentPayments = await db.reservationPayments
                .where('reservationId')
                .equals(detail.id)
                .toArray();

            const prevPaid = currentPayments
                .filter(p => p.status !== 'annulled')
                .reduce((s, p) => s + (p.amount || 0), 0);
            const remaining = (detail.totalPrice || 0) - prevPaid;

            // ── Validaciones de monto ──────────────────────────────────────────
            const rawAmt = abonoAmt.trim();
            if (!rawAmt) { showMsg('error', 'Ingresa el monto del abono'); setAbonoBusy(false); return; }

            const amt = parseFloat(rawAmt);

            if (isNaN(amt)) {
                showMsg('error', 'El monto ingresado no es un número válido'); setAbonoBusy(false); return;
            }
            // ── BUG FIX: Redondear a 2 decimales antes de validar ──
            const amtRounded = Math.round(amt * 100) / 100;
            
            if (amtRounded <= 0) {
                showMsg('error', 'El monto debe ser mayor a Bs. 0.00'); setAbonoBusy(false); return;
            }
            if (amtRounded > detail.totalPrice) {
                showMsg('error', `El monto no puede superar el precio total de la prenda (${formatCurrency(detail.totalPrice, currency)})`); setAbonoBusy(false); return;
            }

            if (remaining <= 0) {
                showMsg('error', 'Esta reserva ya está completamente pagada'); setAbonoBusy(false); return;
            }
            // ── BUG FIX: amtRounded ya fue calculado arriba ──
            const remRounded = Math.round(remaining * 100) / 100;

            if (amtRounded > remRounded + 0.01) {
                showMsg('error',
                    `El abono (${formatCurrency(amtRounded, currency)}) supera el saldo pendiente (${formatCurrency(remRounded, currency)}). ` +
                    `Usa el botón "Pagar todo" para liquidar el saldo exacto.`
                ); setAbonoBusy(false); return;
            }
            // ──────────────────────────────────────────────────────────────────

            // ── TRANSACCIÓN ATÓMICA: Registrar abono y verificar completado en una sola transacción ──
            await db.transaction('rw', db.reservationPayments, db.reservations, db.products, db.kardex, db.sales, db.barcodes, async () => {
                // Re-leer pagos DENTRO de la transacción para evitar race condition de doble-toque
                const freshPayments = await db.reservationPayments
                    .where('reservationId')
                    .equals(detail.id)
                    .toArray();
                const freshPaid = Math.round(freshPayments
                    .filter(p => p.status !== 'annulled')
                    .reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100;
                const totalRounded = Math.round((detail.totalPrice || 0) * 100) / 100;
                const freshRemaining = Math.round((totalRounded - freshPaid) * 100) / 100;

                // Verificar que la reserva siga pendiente (guard contra doble-completación)
                const freshReservation = await db.reservations.get(detail.id);
                if (!freshReservation || freshReservation.status !== 'pending') {
                    throw new Error('Esta reserva ya fue completada o cancelada');
                }

                if (freshRemaining <= 0) throw new Error('Esta reserva ya está completamente pagada');
                if (amtRounded > freshRemaining + 0.01) {
                    throw new Error(
                        `El abono (${formatCurrency(amtRounded, currency)}) supera el saldo pendiente (${formatCurrency(freshRemaining, currency)})`
                    );
                }
                // Ajustar monto si excede saldo por redondeo (máx 1 centavo)
                const finalAmt = Math.min(amtRounded, freshRemaining);

                // Registrar abono
                await db.reservationPayments.add({
                    reservationId: detail.id,
                    date: getLocalISOString(),
                    amount: finalAmt,
                    paymentMethod: abonoPayment,
                    notes: abonoNote.trim().toUpperCase(),
                    registeredBy: user?.name || user?.username,
                    userId: user?.id,
                    shiftId: activeShiftId || undefined,
                });

                // Calcular nuevo total pagado DENTRO de la transacción
                const newPaid = Math.round((freshPaid + finalAmt) * 100) / 100;

                if (newPaid >= totalRounded) {
                    // ── Pago completado: completar reserva DENTRO de la transacción ──
                    await db.reservations.update(detail.id, {
                        status: 'completed',
                        completedAt: getLocalISOString(),
                    });

                    // Descontar stock FÍSICO
                    const product = await db.products.get(detail.productId);
                    if (!product) throw new Error("El producto ya no existe en el catálogo");

                    const newStock = (product.stock || 0) - 1;
                    await db.products.update(detail.productId, { stock: newStock });

                    // Marcar UN código de barras individual como usado
                    const b = await db.barcodes
                        .where('productId')
                        .equals(detail.productId)
                        .and(x => !x.used)
                        .first();
                    if (b) {
                        await db.barcodes.update(b.id, { used: true });
                    }

                    // Registrar SALIDA en Kardex
                    await db.kardex.add({
                        productId: detail.productId,
                        date: getLocalISOString(),
                        type: 'salida',
                        qty: 1,
                        notes: `Entrega de reserva #${detail.id} — ${detail.clientName}`,
                        balanceAfter: newStock,
                        unitCodes: b ? [{ shortCode: b.shortCode || '', barcode: b.barcode || '' }] : [],
                    });

                    // Registrar la venta
                    await db.sales.add({
                        date: getLocalISOString(),
                        items: [{
                            productId: detail.productId,
                            name: detail.productName,
                            size: detail.productSize,
                            color: detail.productColor,
                            price: detail.totalPrice,
                            qty: 1,
                        }],
                        total: newPaid,
                        paymentMethod: 'reserva',
                        sellerId: user?.id,
                        sellerName: user?.name || user?.username,
                        reservationId: detail.id,
                    });
                }
            });

            await syncClosureIfDateExists(getLocalISOString().slice(0, 10), user?.id, activeShiftId);

            setAbonoAmt(''); setAbonoNote('');
            // Comprobar si el pago cubrió el total basándonos en el monto ingresado vs saldo previo
            const prevRemaining = Math.round(((detail.totalPrice || 0) - currentPayments.reduce((s, p) => s + (p.amount || 0), 0)) * 100) / 100;
            if (amtRounded >= prevRemaining) {
                showMsg('success', '🎉 ¡Reserva completada! Prenda entregada al cliente — venta registrada.');
            } else {
                showMsg('success', `✅ Abono de ${formatCurrency(amtRounded, currency)} registrado correctamente`);
            }
            setDetail(null); // Cerrar panel de detalle
        } catch (err) {
            showMsg('error', err.message || 'Error al registrar el abono');
        } finally {
            setAbonoBusy(false);
        }
    };

    /**
     * Completar reserva manualmente (botón desde el panel) → verifica pagos y crea venta.
     */
    const completeReservation = async (reserva, skipConfirm = false) => {
        if (!skipConfirm) { setConfirm({ type: 'complete', reserva }); return; }

        // Guard: evitar doble-completación si el handleAbono ya la completó
        const freshReserva = await db.reservations.get(reserva.id);
        if (!freshReserva || freshReserva.status !== 'pending') {
            showMsg('error', 'Esta reserva ya fue completada o cancelada');
            setDetail(null); setConfirm(null);
            return;
        }

        // Leer pagos actuales directamente de DB
        const currentPayments = await db.reservationPayments
            .where('reservationId')
            .equals(reserva.id)
            .toArray();
        const paidTotal = currentPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const totalRounded = Math.round((reserva.totalPrice || 0) * 100) / 100;

        if (paidTotal < totalRounded) {
            showMsg('error', `La reserva no está completamente pagada. Faltan ${formatCurrency(totalRounded - paidTotal, currency)}`);
            return;
        }

        await db.transaction('rw', db.reservations, db.products, db.kardex, db.sales, db.barcodes, async () => {
            // 1. Descontar stock FÍSICO ahora que la prenda SALE de la tienda
            const product = await db.products.get(reserva.productId);
            if (!product) throw new Error("El producto ya no existe en el catálogo");

            const newStock = (product.stock || 0) - 1;
            await db.products.update(reserva.productId, { stock: newStock });

            // 1.1 Marcar UN código de barras individual como usado
            const b = await db.barcodes
                .where('productId').equals(reserva.productId)
                .and(x => !x.used)
                .first();
            if (b) {
                await db.barcodes.update(b.id, { used: true });
            }

            // 2. Registrar SALIDA en el Kardex
            await db.kardex.add({
                productId: reserva.productId,
                date: getLocalISOString(),
                type: 'salida',
                qty: 1,
                notes: `Entrega de reserva #${reserva.id} — ${reserva.clientName}`,
                balanceAfter: newStock,
                unitCodes: b ? [{ shortCode: b.shortCode || '', barcode: b.barcode || '' }] : [],
            });

            // 3. Marcar reserva como completada
            await db.reservations.update(reserva.id, {
                status: 'completed',
                completedAt: getLocalISOString(),
            });

            // 4. Registrar la venta
            await db.sales.add({
                date: getLocalISOString(),
                items: [{
                    productId: reserva.productId,
                    name: reserva.productName,
                    size: reserva.productSize,
                    color: reserva.productColor,
                    price: reserva.totalPrice,
                    qty: 1,
                }],
                total: paidTotal,
                paymentMethod: 'reserva',
                sellerId: user?.id,
                sellerName: user?.name || user?.username,
                reservationId: reserva.id,
            });
        });

        await syncClosureIfDateExists(getLocalISOString().slice(0, 10), user?.id, activeShiftId);

        setDetail(null);
        showMsg('success', '🎉 ¡Reserva completada! Prenda entregada al cliente — venta registrada.');
    };

    /** Cancelar reserva → ya no necesita devolver stock porque nunca se descontó físicamente */
    const cancelReservation = async (reserva) => {
        // Obtenemos los pagos antes de anularlos para saber qué fechas sincronizar
        const payments = await db.reservationPayments.where('reservationId').equals(reserva.id).toArray();
        const uniqueDates = [...new Set(payments.map(p => p.date?.slice(0, 10)))];

        // ── SEGURIDAD: Bloquear si alguna fecha de abono ya está cerrada (para este usuario) ──
        for (const d of uniqueDates) {
            const closure = await db.table('cashClosures').where('date').equals(d)
                .filter(c => c.userId === user?.id)
                .first();
            if (closure && closure.closedAt) {
                alert(`No se puede anular la reserva porque el día ${d} ya tiene CIERRE DE CAJA cerrado. 
No se pueden alterar registros de días cerrados.`);
                return;
            }
        }

        await db.transaction('rw', db.reservations, db.reservationPayments, db.cashClosures, async () => {
            // 1. Marcar la reserva como cancelada
            await db.reservations.update(reserva.id, {
                status: 'cancelled',
                cancelledAt: getLocalISOString(),
            });

            // 2. Marcar todos los pagos de esta reserva como anulados
            await db.reservationPayments
                .where('reservationId')
                .equals(reserva.id)
                .modify({ status: 'annulled' });
        });

        // 3. Sincronizar cierres de caja de las fechas afectadas
        for (const date of uniqueDates) {
            await syncClosureIfDateExists(date, user?.id, activeShiftId);
        }

        setDetail(null);
        setConfirm(null);
        showMsg('success', 'Reserva cancelada y reportes actualizados');
    };

    /** Imprime comprobante PDF de la reserva (estado actual del pago) */
    const printReservationVoucher = (reserva, pays, paid, remaining) => {
        const storeName = settings?.find(s => s.key === 'storeName')?.value || 'Tienda de Ropa';
        const storePhone = settings?.find(s => s.key === 'storePhone')?.value || '';
        const storeLogo = settings?.find(s => s.key === 'storeLogo')?.value || '';
        const curr = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
        const ticketMsg = settings?.find(s => s.key === 'ticketMessage')?.value || '¡Gracias por su compra!';
        // Mensaje de vigencia: primero el guardado en la reserva, luego el de configuración
        const defExpiryMsg = settings?.find(s => s.key === 'reservationExpiryMessage')?.value || '';
        const isCompleted = reserva.status === 'completed';

        // ── Formato Carta dividida (Media Carta Horizontal): 215.9 × 139.7 mm ──
        const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: [215.9, 139.7] });
        let y = 10;
        const pageWidth = 215.9;
        const marginX = 15;
        const center = pageWidth / 2;
        const right = pageWidth - marginX;

        // ── Encabezado Centralizado ──
        y = drawPDFHeader(doc, settings, 'NOTA DE RESERVA', y);
        y += 4;

        // ── Datos del cliente (misma línea si es posible) ──
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('CLIENTE:', marginX, y);
        doc.setFont('helvetica', 'normal');
        const telStr = reserva.clientPhone ? `  |  Tel: ${reserva.clientPhone}` : '';
        doc.text(`${reserva.clientName}${telStr}`, marginX + 17, y); y += 4;

        doc.setFont('helvetica', 'bold');
        doc.text('Reserva #:', marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${reserva.id}`, marginX + 17, y);
        doc.text(`Fecha: ${new Date(reserva.createdAt).toLocaleDateString()}`, right, y, { align: 'right' }); y += 3;
        
        doc.line(marginX, y, right, y); y += 4;

        // ── Prenda ──
        doc.setFont('helvetica', 'bold');
        doc.text('PRENDA:', marginX, y);
        
        doc.setFont('helvetica', 'normal');
        const prodName = reserva.productName || '';
        let pdDetails = '';
        if (reserva.productSize || reserva.productColor) {
            pdDetails = ` (${[reserva.productSize && `Talla: ${reserva.productSize}`, reserva.productColor && `Color: ${reserva.productColor}`].filter(Boolean).join(' | ')})`;
        }
        
        const splitName = doc.splitTextToSize(`${prodName}${pdDetails}`, 140);
        doc.text(splitName, marginX + 15, y);
        
        doc.setFont('helvetica', 'bold');
        if (reserva.originalPrice && reserva.originalPrice > (reserva.totalPrice || 0)) {
            doc.setTextColor(0, 0, 0);
            doc.text(`P. Original: ${formatCurrency(reserva.originalPrice, curr)}`, right, y, { align: 'right' });
            y += 3.5;
            doc.setTextColor(0, 0, 0);
            doc.text(`Precio final: ${formatCurrency(reserva.totalPrice || 0, curr)}  (-${formatCurrency(reserva.originalPrice - (reserva.totalPrice || 0), curr)})`, right, y, { align: 'right' });
        } else {
            doc.text(`Precio total: ${formatCurrency(reserva.totalPrice || 0, curr)}`, right, y, { align: 'right' });
        }
        y += (splitName.length * 3.5) + 1;

        // Código de referencia (shortCode) del producto reservado
        if (reserva.productShortCode) {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
            doc.text(`Cód. Ref: ${reserva.productShortCode}`, marginX + 15, y);
            y += 4;
        }

        doc.line(marginX, y, right, y); y += 4;

        // ── Historial de pagos ──
        doc.setFont('helvetica', 'bold');
        doc.text('PAGOS REALIZADOS:', marginX, y); y += 4;

        doc.setFont('helvetica', 'normal');
        if (pays.length === 0) {
            doc.text('Ningún abono registrado', marginX, y); y += 4;
        } else {
            pays.forEach((p, i) => {
                const label = i === 0 ? 'Abono inicial' : `Abono #${i + 1}`;
                const fecha = new Date(p.date).toLocaleDateString();
                const methodLabel = p.paymentMethod === 'qr' ? '(QR)' : '(Efectivo)';
                doc.text(`${fecha}  ${label} ${methodLabel}`, marginX, y);
                doc.text(`+${formatCurrency(p.amount || 0, curr)}`, right, y, { align: 'right' });
                y += 4;
            });
        }
        y -= 1;
        doc.line(marginX, y, right, y); y += 4;

        // ── Resumen financiero ──
        doc.setFont('helvetica', 'bold');
        doc.text('Total abonado:', marginX, y);
        doc.text(formatCurrency(paid, curr), right, y, { align: 'right' }); y += 5;

        if (isCompleted) {
            doc.setFontSize(10);
            doc.text('>>> PRENDA ENTREGADA <<<', center, y, { align: 'center' }); y += 6;
        } else {
            doc.setFontSize(9);
            doc.text('SALDO PENDIENTE:', marginX, y);
            doc.text(formatCurrency(remaining, curr), right, y, { align: 'right' }); y += 5;
        }

        doc.line(marginX, y, right, y); y += 4;

        // ── Pie ──
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Emitido: ${new Date().toLocaleString()}`, center, y, { align: 'center' }); y += 4;

        // Mensaje de vigencia
        const expiryMsg = reserva.expiryMessage || defExpiryMsg;
        if (expiryMsg) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9);
            const splitExp = doc.splitTextToSize(expiryMsg, pageWidth - marginX * 2);
            doc.text(splitExp, center, y, { align: 'center' });
            y += (splitExp.length * 3.5) + 2;
        }

        // Mensaje de agradecimiento
        if (ticketMsg) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text(ticketMsg, center, y, { align: 'center' }); y += 4;
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        if (reserva.sellerName) { doc.text(`Atendido por: ${reserva.sellerName}`, center, y, { align: 'center' }); y += 3; }
        doc.text('Conserve este comprobante.', center, y, { align: 'center' });

        doc.autoPrint();
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
    };

    /**
     * Imprime comprobante PDF CONSOLIDADO del grupo (mismo cliente + misma fecha):
     * una sola nota con todas las prendas y el historial de pagos del grupo.
     */
    const printGroupVoucher = (group, summary) => {
        const curr = currency;
        const ticketMsg = settings?.find(s => s.key === 'ticketMessage')?.value || '¡Gracias por su compra!';

        // ── Mismo formato que el comprobante individual: Media Carta Horizontal ──
        const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: [215.9, 139.7] });
        const pageWidth = 215.9;
        const pageHeight = 139.7;
        const marginX = 15;
        const center = pageWidth / 2;
        const right = pageWidth - marginX;
        let y = 10;

        // Salto de página simple cuando el contenido supera el alto útil
        const ensure = (needed) => {
            if (y + needed > pageHeight - 10) { doc.addPage(); y = 12; }
        };

        // ── Encabezado ──
        y = drawPDFHeader(doc, settings, 'NOTA DE RESERVA', y);
        y += 4;

        // ── Datos del cliente ──
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('CLIENTE:', marginX, y);
        doc.setFont('helvetica', 'normal');
        const telStr = group.clientPhone ? `  |  Tel: ${group.clientPhone}` : '';
        doc.text(`${group.clientName}${telStr}`, marginX + 17, y); y += 4;

        doc.setFont('helvetica', 'bold');
        doc.text('Reservas #:', marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.text(group.items.map(r => r.id).join(', '), marginX + 20, y);
        doc.text(`Fecha: ${new Date(group.items[0].createdAt).toLocaleDateString()}`, right, y, { align: 'right' }); y += 3;

        doc.line(marginX, y, right, y); y += 4;

        // ── Prendas del grupo ──
        doc.setFont('helvetica', 'bold');
        doc.text(`PRENDAS (${group.items.length}):`, marginX, y); y += 4;

        group.items.forEach((r, i) => {
            doc.setFont('helvetica', 'normal');
            let pdDetails = '';
            if (r.productSize || r.productColor) {
                pdDetails = ` (${[r.productSize && `Talla: ${r.productSize}`, r.productColor && `Color: ${r.productColor}`].filter(Boolean).join(' | ')})`;
            }
            const splitName = doc.splitTextToSize(`${i + 1}. ${r.productName || ''}${pdDetails}`, 150);
            ensure(splitName.length * 3.5 + 8);
            doc.text(splitName, marginX + 4, y);
            doc.setFont('helvetica', 'bold');
            doc.text(formatCurrency(r.totalPrice || 0, curr), right, y, { align: 'right' });
            y += splitName.length * 3.5;

            doc.setFont('helvetica', 'normal');
            if (r.originalPrice && r.originalPrice > (r.totalPrice || 0)) {
                doc.setFontSize(8);
                doc.text(`P. Original: ${formatCurrency(r.originalPrice, curr)}  (Desc: -${formatCurrency(r.originalPrice - (r.totalPrice || 0), curr)})`, marginX + 8, y);
                doc.setFontSize(9);
                y += 3.5;
            }
            if (r.productShortCode) {
                doc.text(`Cód. Ref: ${r.productShortCode}`, marginX + 8, y);
                y += 3.5;
            }
            y += 0.5;
        });

        ensure(6);
        doc.line(marginX, y, right, y); y += 4;

        // ── Historial de pagos consolidado ──
        doc.setFont('helvetica', 'bold');
        doc.text('PAGOS REALIZADOS:', marginX, y); y += 4;

        doc.setFont('helvetica', 'normal');
        if (summary.pays.length === 0) {
            doc.text('Ningún abono registrado', marginX, y); y += 4;
        } else {
            summary.pays.forEach(p => {
                ensure(4);
                const r = group.items.find(it => it.id === p.reservationId);
                const fecha = new Date(p.date).toLocaleDateString();
                const methodLabel = p.paymentMethod === 'qr' ? '(QR)' : '(Efectivo)';
                const prenda = (r?.productName || '').slice(0, 30);
                doc.text(`${fecha}  ${prenda} ${methodLabel}`, marginX, y);
                doc.text(`+${formatCurrency(p.amount || 0, curr)}`, right, y, { align: 'right' });
                y += 4;
            });
        }
        y -= 1;
        ensure(6);
        doc.line(marginX, y, right, y); y += 4;

        // ── Resumen financiero del grupo ──
        doc.setFont('helvetica', 'bold');
        ensure(5);
        doc.text('Total del grupo:', marginX, y);
        doc.text(formatCurrency(summary.total, curr), right, y, { align: 'right' }); y += 5;
        ensure(5);
        doc.text('Total abonado:', marginX, y);
        doc.text(formatCurrency(summary.paid, curr), right, y, { align: 'right' }); y += 5;

        if (summary.status === 'completed') {
            ensure(6);
            doc.setFontSize(10);
            doc.text('>>> PRENDAS ENTREGADAS <<<', center, y, { align: 'center' });
            doc.setFontSize(9);
            y += 6;
        } else if (summary.status !== 'cancelled') {
            ensure(5);
            doc.text('SALDO PENDIENTE:', marginX, y);
            doc.text(formatCurrency(summary.remaining, curr), right, y, { align: 'right' }); y += 5;
        }

        ensure(6);
        doc.line(marginX, y, right, y); y += 4;

        // ── Pie ──
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        ensure(4);
        doc.text(`Emitido: ${new Date().toLocaleString()}`, center, y, { align: 'center' }); y += 4;

        // Mensaje de vigencia (el guardado en la primera prenda, o el de configuración)
        const expiryMsg = group.items[0]?.expiryMessage || defExpiryMsg;
        if (expiryMsg) {
            const splitExp = doc.splitTextToSize(expiryMsg, pageWidth - marginX * 2);
            ensure(splitExp.length * 3.5 + 2);
            doc.setFont('helvetica', 'italic');
            doc.text(splitExp, center, y, { align: 'center' });
            y += (splitExp.length * 3.5) + 2;
        }

        if (ticketMsg) {
            ensure(4);
            doc.setFont('helvetica', 'bold');
            doc.text(ticketMsg, center, y, { align: 'center' }); y += 4;
        }

        ensure(8);
        doc.setFont('helvetica', 'normal');
        const sellers = [...new Set(group.items.map(r => r.sellerName).filter(Boolean))];
        if (sellers.length > 0) { doc.text(`Atendido por: ${sellers.join(', ')}`, center, y, { align: 'center' }); y += 3; }
        doc.text('Conserve este comprobante.', center, y, { align: 'center' });

        doc.autoPrint();
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
    };

    // ════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════
    return (
        <div className="max-w-7xl mx-auto fade-in">
            {!detail && !showNew && !liveGroup && (
                <>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <Tag size={24} strokeWidth={1.8} className="text-pink-600" />
                    Reservas (Sistema de Reserva)
                </h1>
                <button id="reserva-new" onClick={() => {
                        setShowNew(true);
                        setForm({ ...EMPTY_FORM, expiryMessage: defExpiryMsg });
                        setProdSearch('');
                        setItems([]);
                        setShowProductSearch(true);
                    }}
                    className="btn-primary flex items-center gap-2">
                    <Plus size={18} /> Nueva Reserva
                </button>
            </div>

            {/* ── Notificación ── */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
                </div>
            )}

            {/* ── Tabs + búsqueda ── */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex gap-2">
                    {[['active', 'En Proceso'], ['history', 'Historial']].map(([val, lbl]) => (
                        <button key={val} onClick={() => setTab(val)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all
                                    ${tab === val ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:border-pink-300'}`}>
                            {lbl}
                            {val === 'active' && (
                                <span className="ml-2 bg-pink-600 text-white text-xs rounded-full px-1.5 py-0.5">
                                    {activeGroupCount}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="relative flex-1 max-w-xs">
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar cliente, prenda o cód. corto..."
                        className="fashion-input text-sm" />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">

                {/* ─── Lista de reservas (Ancho completo) ─── */}
                <div className="space-y-3">

                    {/* 💡 Instrucción para la cajera */}
                    {tab === 'active' && groups.length > 0 && !detail && (
                        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4
                                        flex items-center gap-3 text-sm text-blue-700 font-semibold shadow-sm">
                            <AlertCircle size={20} className="text-blue-500" />
                            Selecciona una reserva o grupo para gestionar abonos, facturación y entrega
                        </div>
                    )}

                    {groups.length === 0 ? (
                        <div className="fashion-card py-20 text-center text-pink-300">
                            <Tag size={48} className="mx-auto mb-4 opacity-30" />
                            <p className="text-lg font-bold">
                                {tab === 'active' ? 'No hay reservas activas en este momento' : 'El historial de reservas está vacío'}
                            </p>
                            <p className="text-sm mt-1 opacity-60 font-medium">Usa el botón superior para crear una nueva reserva</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {groups.map(g => {
                                // ── Grupo de una sola prenda → tarjeta individual (como siempre) ──
                                if (g.items.length === 1) {
                                const r = g.items[0];
                                const { paid, remaining } = getReservationData(r);
                                const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
                                return (
                                    <button key={g.key}
                                        onClick={() => { 
                                            setDetail(r); 
                                            setAbonoAmt(''); 
                                            setAbonoPayment('efectivo');
                                            setAbonoNote(''); 
                                        }}
                                        className="fashion-card w-full text-left p-6 transition-all hover:shadow-xl hover:-translate-y-1 group border-2 border-transparent hover:border-pink-200">

                                        <div className="flex items-start justify-between mb-4">
                                            <div className="min-w-0">
                                                <h3 className="font-black text-pink-900 text-lg leading-tight truncate uppercase tracking-tight">{r.clientName}</h3>
                                                <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mt-1">RESERVA #{r.id}</p>
                                            </div>
                                            <span className={`shrink-0 ml-2 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl shadow-sm
                                                ${st.cls === 'badge-blue' ? 'bg-blue-600 text-white' : ''}
                                                ${st.cls === 'badge-green' ? 'bg-green-600 text-white' : ''}
                                                ${st.cls === 'badge-red' ? 'bg-red-600 text-white' : ''}`}>
                                                {st.text}
                                            </span>
                                        </div>

                                        <div className="mb-4">
                                            <p className="text-sm font-bold text-pink-800 line-clamp-1 uppercase mb-1">{r.productName}</p>
                                            {(r.productSize || r.productColor) && (
                                                <p className="text-[11px] font-bold text-pink-400 uppercase tracking-wide">
                                                    {r.productSize && `Talla: ${r.productSize}`}
                                                    {r.productColor && ` · Color: ${r.productColor}`}
                                                </p>
                                            )}
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <ProgressBar paid={paid} total={r.totalPrice} />
                                            <div className="flex justify-between text-xs font-black">
                                                <span className="text-green-600 uppercase">Abonado: {formatCurrency(paid, currency)}</span>
                                                <span className="text-pink-900 uppercase">Total: {formatCurrency(r.totalPrice, currency)}</span>
                                            </div>
                                        </div>

                                        {r.status === 'pending' && (
                                            <div className="bg-orange-50 p-2.5 rounded-xl border border-orange-100 mb-4">
                                                <p className="text-[10px] text-orange-400 font-black uppercase tracking-widest">Saldo Restante</p>
                                                <p className="text-lg font-black text-orange-600 font-mono leading-none mt-1">
                                                    {formatCurrency(remaining, currency)}
                                                </p>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-center pt-4 border-t border-pink-50">
                                            <p className="text-[10px] font-black text-pink-200 uppercase">
                                                {new Date(r.createdAt).toLocaleDateString()}
                                            </p>
                                            {r.expiryDate && r.status === 'pending' && (
                                                <div className={`text-[10px] font-black flex items-center gap-1.5 uppercase transition-colors
                                                    ${new Date(r.expiryDate) < new Date() ? 'text-red-500' : 'text-orange-500 group-hover:text-pink-600'}`}>
                                                    <Clock size={12} strokeWidth={2.5} /> Vence: {new Date(r.expiryDate).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                                }

                                // ── Grupo de varias prendas (mismo cliente + misma fecha) ──
                                const summary = summarizeGroup(g.items, payments);
                                const st = STATUS_LABEL[summary.status] || STATUS_LABEL.pending;
                                return (
                                    <button key={g.key}
                                        onClick={() => setOpenGroup(g)}
                                        className="fashion-card w-full text-left p-6 transition-all hover:shadow-xl hover:-translate-y-1 group border-2 border-purple-200 hover:border-purple-400">

                                        <div className="flex items-start justify-between mb-4">
                                            <div className="min-w-0">
                                                <h3 className="font-black text-pink-900 text-lg leading-tight truncate uppercase tracking-tight">{g.clientName}</h3>
                                                <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mt-1">
                                                    {new Date(g.items[0].createdAt).toLocaleDateString()}
                                                </p>
                                                <span className="inline-flex items-center gap-1 mt-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg bg-purple-100 text-purple-700 border border-purple-200">
                                                    <Package size={10} strokeWidth={2.5} /> Grupo de {g.items.length} prendas
                                                </span>
                                            </div>
                                            <span className={`shrink-0 ml-2 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl shadow-sm
                                                ${st.cls === 'badge-blue' ? 'bg-blue-600 text-white' : ''}
                                                ${st.cls === 'badge-green' ? 'bg-green-600 text-white' : ''}
                                                ${st.cls === 'badge-red' ? 'bg-red-600 text-white' : ''}`}>
                                                {st.text}
                                            </span>
                                        </div>

                                        <div className="mb-4 space-y-1">
                                            {g.items.slice(0, 3).map(r => (
                                                <p key={r.id} className="text-sm font-bold text-pink-800 line-clamp-1 uppercase">{r.productName}</p>
                                            ))}
                                            {g.items.length > 3 && (
                                                <p className="text-[11px] font-black text-pink-400 uppercase tracking-wide">+{g.items.length - 3} prenda(s) más…</p>
                                            )}
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <ProgressBar paid={summary.paid} total={summary.total} />
                                            <div className="flex justify-between text-xs font-black">
                                                <span className="text-green-600 uppercase">Abonado: {formatCurrency(summary.paid, currency)}</span>
                                                <span className="text-pink-900 uppercase">Total: {formatCurrency(summary.total, currency)}</span>
                                            </div>
                                        </div>

                                        {summary.status === 'pending' && (
                                            <div className="bg-orange-50 p-2.5 rounded-xl border border-orange-100 mb-4">
                                                <p className="text-[10px] text-orange-400 font-black uppercase tracking-widest">Saldo Restante</p>
                                                <p className="text-lg font-black text-orange-600 font-mono leading-none mt-1">
                                                    {formatCurrency(summary.remaining, currency)}
                                                </p>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-center pt-4 border-t border-pink-50">
                                            <p className="text-[10px] font-black text-purple-400 uppercase flex items-center gap-1">
                                                <Eye size={12} strokeWidth={2.5} /> Ver grupo
                                            </p>
                                            {summary.earliestExpiry && (
                                                <div className={`text-[10px] font-black flex items-center gap-1.5 uppercase transition-colors
                                                    ${new Date(summary.earliestExpiry) < new Date() ? 'text-red-500' : 'text-orange-500 group-hover:text-pink-600'}`}>
                                                    <Clock size={12} strokeWidth={2.5} /> Vence: {new Date(summary.earliestExpiry).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            </>
            )}

            {/* ════ VISTA DETALLE DE GRUPO (mismo cliente + misma fecha) ════ */}
            {liveGroup && !detail && (() => {
                const summary = summarizeGroup(liveGroup.items, payments);
                const pct = Math.min(100, summary.total > 0 ? (summary.paid / summary.total) * 100 : 0);
                const st = STATUS_LABEL[summary.status] || STATUS_LABEL.pending;
                const paysOf = (id) => summary.pays.filter(p => p.reservationId === id);
                return (
                    <div className="fade-in bg-white rounded-3xl shadow-xl border border-pink-100 mb-12">
                        <div className="p-6 md:p-8 max-w-4xl mx-auto">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-purple-100 rounded-2xl text-purple-600">
                                        <Package size={24} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">{liveGroup.clientName}</h2>
                                        <p className="text-pink-400 font-bold text-sm tracking-widest">
                                            GRUPO DE {liveGroup.items.length} PRENDAS · {new Date(liveGroup.items[0].createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => setOpenGroup(null)}
                                    className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center">
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Resumen del grupo */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="fashion-card p-6 bg-pink-50/50">
                                    <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mb-3">Contacto</p>
                                    <p className="font-bold text-pink-900 flex items-center gap-2"><Phone size={14} /> {liveGroup.clientPhone || 'Sin teléfono'}</p>
                                    <p className="text-xs text-pink-400 mt-1 italic">Creada: {new Date(liveGroup.items[0].createdAt).toLocaleDateString()}</p>
                                </div>
                                <div className="fashion-card p-6 bg-green-50/60 border border-green-100">
                                    <p className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-3">Total Abonado</p>
                                    <p className="text-3xl font-black text-green-700">{formatCurrency(summary.paid, currency)}</p>
                                    <p className="text-[10px] text-green-500 font-bold mt-1 uppercase">{summary.pays.length} abonos</p>
                                </div>
                                <div className="fashion-card p-6 bg-pink-900 text-white">
                                    <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-3">Total del Grupo</p>
                                    <p className="text-3xl font-black">{formatCurrency(summary.total, currency)}</p>
                                    {summary.status === 'pending' && (
                                        <p className="text-[10px] text-orange-300 font-bold mt-1 uppercase">Saldo: {formatCurrency(summary.remaining, currency)}</p>
                                    )}
                                </div>
                            </div>

                            {/* Progreso grupal */}
                            <div className="fashion-card p-6 mb-8">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mb-1">Estado del Pago Grupal</p>
                                        <h3 className="text-2xl font-black text-pink-900">{pct.toFixed(0)}% COMPLETADO</h3>
                                    </div>
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl shadow-sm
                                        ${st.cls === 'badge-blue' ? 'bg-blue-600 text-white' : ''}
                                        ${st.cls === 'badge-green' ? 'bg-green-600 text-white' : ''}
                                        ${st.cls === 'badge-red' ? 'bg-red-600 text-white' : ''}`}>
                                        {st.text}
                                    </span>
                                </div>
                                <ProgressBar paid={summary.paid} total={summary.total} />
                            </div>

                            {/* Prendas del grupo */}
                            <h3 className="font-black text-pink-900 uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
                                <Tag size={16} className="text-pink-400" /> Prendas del grupo — toca una para gestionar abonos y entrega
                            </h3>
                            <div className="space-y-3 mb-4">
                                {liveGroup.items.map(r => {
                                    const pPays = paysOf(r.id);
                                    const pPaid = Math.round(pPays.reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100;
                                    const pRemaining = Math.round(Math.max(0, (r.totalPrice || 0) - pPaid) * 100) / 100;
                                    const rst = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
                                    return (
                                        <button key={r.id}
                                            onClick={() => {
                                                setDetail(r);
                                                setAbonoAmt('');
                                                setAbonoPayment('efectivo');
                                                setAbonoNote('');
                                            }}
                                            className="w-full text-left bg-white p-5 rounded-2xl border-2 border-pink-100 hover:border-pink-300 hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <p className="font-black text-pink-900 uppercase truncate">{r.productName}</p>
                                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg
                                                        ${rst.cls === 'badge-blue' ? 'bg-blue-600 text-white' : ''}
                                                        ${rst.cls === 'badge-green' ? 'bg-green-600 text-white' : ''}
                                                        ${rst.cls === 'badge-red' ? 'bg-red-600 text-white' : ''}`}>
                                                        {rst.text}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] font-bold text-pink-400 uppercase">
                                                    Reserva #{r.id}
                                                    {r.productSize && ` · Talla: ${r.productSize}`}
                                                    {r.productColor && ` · Color: ${r.productColor}`}
                                                    {r.productShortCode && ` · Cód: ${r.productShortCode}`}
                                                </p>
                                                {r.status === 'pending' && (
                                                    <div className="mt-2 max-w-xs">
                                                        <ProgressBar paid={pPaid} total={r.totalPrice} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-lg font-black text-pink-900">{formatCurrency(r.totalPrice, currency)}</p>
                                                <p className="text-[11px] font-black text-green-600 uppercase">Abonado: {formatCurrency(pPaid, currency)}</p>
                                                {r.status === 'pending' && pRemaining > 0 && (
                                                    <p className="text-[11px] font-black text-orange-500 uppercase">Saldo: {formatCurrency(pRemaining, currency)}</p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Footer acciones */}
                            <div className="mt-8 pt-8 border-t-2 border-pink-50 flex flex-col md:flex-row gap-4">
                                <button onClick={() => setOpenGroup(null)}
                                    className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors w-full md:w-auto">
                                    Volver a Reservas
                                </button>
                                <button onClick={() => printGroupVoucher(liveGroup, summary)}
                                    className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black py-5 rounded-3xl text-sm shadow-md hover:shadow-lg uppercase tracking-widest flex items-center justify-center gap-2">
                                    <Printer size={18} /> Imprimir Comprobante Grupal
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ════ VISTA DETALLE Y ABONOS (PANTALLA COMPLETA) ════ */}
            {detail && (() => {
                const { pays, paid, remaining } = getReservationData(detail);
                const pct = Math.min(100, detail.totalPrice > 0 ? (paid / detail.totalPrice) * 100 : 0);
                const abonoNum = pays.length + 1;
                const abonoNumStr = abonoNum === 1 ? 'inicial' : `${abonoNum}° abono`;
                const amtVal = Math.round((parseFloat(abonoAmt) || 0) * 100) / 100;
                const isNaNVal = isNaN(amtVal);
                const isNeg = !isNaNVal && amtVal < 0;
                const isOver = !isNaNVal && amtVal > remaining + 0.01;
                const hasErr = isNaNVal || isNeg || isOver;

                return (
                    <div className="fade-in bg-white rounded-3xl shadow-xl border border-pink-100 mb-12">
                        <div className="p-6 md:p-8 max-w-4xl mx-auto">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-pink-100 rounded-2xl text-pink-600">
                                        <Eye size={24} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">{detail.clientName}</h2>
                                        <p className="text-pink-400 font-bold text-sm tracking-widest">RESERVA #{detail.id}</p>
                                    </div>
                                </div>
                                <button onClick={() => setDetail(null)} 
                                    className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="fashion-card p-6 bg-pink-50/50">
                                    <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mb-3">Contacto</p>
                                    <p className="font-bold text-pink-900 flex items-center gap-2"><Phone size={14} /> {detail.clientPhone || 'Sin teléfono'}</p>
                                    <p className="text-xs text-pink-400 mt-1 italic">Creada: {new Date(detail.createdAt).toLocaleDateString()}</p>
                                </div>
                                <div className="fashion-card p-6 border-2 border-pink-100/50">
                                    <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mb-3">Prenda</p>
                                    <p className="font-bold text-pink-900 truncate">{detail.productName}</p>
                                    <p className="text-xs text-pink-400">{detail.productSize && `Talla: ${detail.productSize}`} {detail.productColor && `· ${detail.productColor}`}</p>
                                </div>
                                <div className="fashion-card p-6 bg-pink-900 text-white">
                                    <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-3">Total Prenda</p>
                                    {detail.originalPrice && detail.originalPrice > detail.totalPrice && (
                                        <p className="text-xs line-through text-pink-400 mb-0.5">{formatCurrency(detail.originalPrice, currency)}</p>
                                    )}
                                    <p className="text-3xl font-black">{formatCurrency(detail.totalPrice, currency)}</p>
                                    {detail.originalPrice && detail.originalPrice > detail.totalPrice && (
                                        <p className="text-[10px] text-green-300 font-bold mt-1">Desc: -{formatCurrency(detail.originalPrice - detail.totalPrice, currency)}</p>
                                    )}
                                </div>
                            </div>

                            {/* Progreso de Pago */}
                            <div className="fashion-card p-8 mb-8">
                                <div className="flex justify-between items-end mb-4">
                                    <div>
                                        <p className="text-[10px] font-black text-pink-300 uppercase tracking-widest mb-1">Estado del Pago</p>
                                        <h3 className="text-2xl font-black text-pink-900">{pct.toFixed(0)}% COMPLETADO</h3>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-orange-500 uppercase">Saldo Pendiente</p>
                                        <p className="text-2xl font-black text-orange-600">{formatCurrency(remaining, currency)}</p>
                                    </div>
                                </div>
                                <ProgressBar paid={paid} total={detail.totalPrice} />
                                <div className="grid grid-cols-2 gap-4 mt-6">
                                    <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                                        <p className="text-[10px] font-black text-green-400 uppercase">Total Abonado</p>
                                        <p className="text-xl font-black text-green-700">{formatCurrency(paid, currency)}</p>
                                    </div>
                                    <div className="bg-pink-50 p-4 rounded-2xl border border-pink-100">
                                        <p className="text-[10px] font-black text-pink-400 uppercase">Número de Pagos</p>
                                        <p className="text-xl font-black text-pink-700">{pays.length} abonos</p>
                                    </div>
                                </div>
                            </div>

                            {/* Registro de Nuevo Abono / Historial */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Nuevo Abono */}
                                {detail.status === 'pending' && remaining > 0 && (
                                    <div className="fashion-card p-8 border-2 border-pink-200">
                                        <h3 className="font-black text-pink-900 uppercase tracking-widest text-sm mb-6 flex items-center gap-2">
                                            <Plus size={18} className="text-pink-500" /> Registrar {abonoNumStr}
                                        </h3>
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-pink-400 uppercase">Monto a abonar</label>
                                                <input type="number" value={abonoAmt} onChange={e => setAbonoAmt(e.target.value)}
                                                    className={`w-full fashion-input text-3xl font-black text-center py-6 ${hasErr ? 'border-red-400 bg-red-50' : ''}`} placeholder="0.00" />
                                                {hasErr && abonoAmt && <p className="text-[10px] text-red-500 font-bold uppercase text-center">Monto fuera de rango (Máx: {remaining.toFixed(2)})</p>}
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                {['efectivo', 'qr'].map(m => (
                                                    <button key={m} onClick={() => setAbonoPayment(m)}
                                                        className={`py-4 rounded-2xl font-black text-xs uppercase tracking-widest border-2 transition-all
                                                            ${abonoPayment === m ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-50 text-gray-300'}`}>
                                                        {m === 'efectivo' ? '💵 Efectivo' : '📱 Pago QR'}
                                                    </button>
                                                ))}
                                            </div>

                                            <input value={abonoNote} onChange={e => setAbonoNote(e.target.value.toUpperCase())}
                                                className="w-full fashion-input text-center text-xs" placeholder="NOTA OPCIONAL (EJ: CIERRE DE CUENTA)" />
                                            
                                            <div className="flex gap-2 flex-wrap justify-center">
                                                <button onClick={() => setAbonoAmt(remaining.toFixed(2))} className="text-[10px] font-black px-4 py-2 bg-green-100 text-green-700 rounded-full hover:bg-green-200 uppercase">Pagar Saldo {formatCurrency(remaining, currency)}</button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Historial con Scroll Interno */}
                                <div className="fashion-card p-8 bg-gray-50/30">
                                    <h3 className="font-black text-pink-900 uppercase tracking-widest text-sm mb-6 flex items-center gap-2">
                                        <Clock size={18} className="text-pink-300" /> Historial de Pagos
                                    </h3>
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                                        {pays.length === 0 ? (
                                            <p className="text-xs text-pink-300 text-center py-10 italic">No hay abonos registrados aún</p>
                                        ) : pays.map((p, i) => (
                                            <div key={p.id} className="bg-white p-4 rounded-2xl border border-pink-100 flex justify-between items-center shadow-sm">
                                                <div>
                                                    <p className="text-[10px] font-black text-pink-400 uppercase tracking-tighter">{i === 0 ? 'Registro Inicial' : `Abono #${i+1}`}</p>
                                                    <p className="text-xs font-bold text-pink-900">{new Date(p.date).toLocaleDateString()}</p>
                                                    <p className="text-[9px] text-pink-400 uppercase font-medium">{p.paymentMethod} · {p.registeredBy}</p>
                                                </div>
                                                <p className="font-black text-pink-700">{formatCurrency(p.amount, currency)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer Acciones Estático */}
                        <div className="mt-8 pt-8 border-t-2 border-pink-50 flex flex-col md:flex-row gap-4">
                            <button onClick={() => setDetail(null)} className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors w-full md:w-auto">{liveGroup ? 'Volver al Grupo' : 'Volver a Reservas'}</button>
                            
                            <button onClick={() => printReservationVoucher(detail, pays, paid, remaining)}
                                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black py-5 rounded-3xl text-sm shadow-md hover:shadow-lg uppercase tracking-widest flex items-center justify-center gap-2">
                                <Printer size={18} /> Imprimir Comprobante
                            </button>

                            {detail.status === 'pending' && (
                                <>
                                    {remaining > 0 ? (
                                        <button onClick={handleAbono} disabled={abonoBusy || !abonoAmt || hasErr || amtVal <= 0}
                                            className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black py-5 rounded-3xl text-sm shadow-md hover:shadow-lg disabled:opacity-50 uppercase tracking-widest">
                                            Confirmar Abono
                                        </button>
                                    ) : (
                                        <button onClick={() => setConfirm({ type: 'complete', reserva: detail })}
                                            className="flex-1 bg-gradient-to-r from-green-600 to-teal-600 text-white font-black py-5 rounded-3xl text-sm shadow-md hover:shadow-lg uppercase tracking-widest">
                                            Entregar Prenda ✓
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* ════ MODAL: CONFIRMAR NUEVA RESERVA ════ */}
            {confirmCreate && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 fade-in">
                    <div className="bg-white rounded-3xl shadow-2xl border border-pink-100 w-full max-w-md p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-amber-100 rounded-2xl text-amber-600">
                                <AlertCircle size={24} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-pink-900 uppercase">Confirmar Reserva</h3>
                                <p className="text-xs text-pink-400 font-bold">Revisa los datos antes de guardar</p>
                            </div>
                        </div>

                        <div className="space-y-3 mb-8">
                            <div className="bg-pink-50 rounded-2xl p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="font-black text-pink-400 uppercase text-[10px] tracking-widest">Cliente</span>
                                    <span className="font-black text-pink-900">{confirmCreate.cname.toUpperCase()}</span>
                                </div>
                                {confirmCreate.form.clientPhone && (
                                    <div className="flex justify-between text-sm">
                                        <span className="font-black text-pink-400 uppercase text-[10px] tracking-widest">Teléfono</span>
                                        <span className="font-bold text-pink-700">{confirmCreate.form.clientPhone}</span>
                                    </div>
                                )}

                                {/* ── Prendas del grupo ── */}
                                <div className="border-t border-pink-100 pt-2 mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                                    {confirmCreate.items.map((it, idx) => (
                                        <div key={idx} className="flex justify-between text-sm gap-2">
                                            <span className="font-black text-pink-900 text-xs truncate">
                                                {confirmCreate.items.length > 1 && <span className="text-pink-300 mr-1">{idx + 1}.</span>}
                                                {it.product.name}
                                                {it.searchedCode && <span className="text-green-600 ml-1 text-[10px]">({it.searchedCode})</span>}
                                            </span>
                                            <span className="font-black text-pink-900 shrink-0">
                                                {it.finalPrice < it.product.price && (
                                                    <span className="line-through text-pink-300 mr-2 text-xs">{formatCurrency(it.product.price, currency)}</span>
                                                )}
                                                {formatCurrency(it.finalPrice, currency)}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex justify-between text-sm border-t border-pink-100 pt-2 mt-2">
                                    <span className="font-black text-pink-400 uppercase text-[10px] tracking-widest">
                                        Total {confirmCreate.items.length > 1 ? `(${confirmCreate.items.length} prendas)` : ''}
                                    </span>
                                    <span className="font-black text-pink-900 text-base">{formatCurrency(confirmCreate.total, currency)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="font-black text-green-600 uppercase text-[10px] tracking-widest">
                                        Abono inicial {confirmCreate.items.length > 1 ? '(se reparte proporcionalmente)' : ''}
                                    </span>
                                    <span className="font-black text-green-700 text-base">{formatCurrency(confirmCreate.initPay, currency)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="font-black text-orange-500 uppercase text-[10px] tracking-widest">Saldo restante</span>
                                    <span className="font-black text-orange-600">{formatCurrency(confirmCreate.total - confirmCreate.initPay, currency)}</span>
                                </div>
                            </div>
                            <p className="text-center text-xs text-pink-400 italic">
                                {confirmCreate.items.length > 1
                                    ? `Las ${confirmCreate.items.length} prendas quedarán apartadas para este cliente`
                                    : 'La prenda quedará apartada para este cliente'}
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmCreate(null)}
                                className="flex-1 py-4 border-2 border-pink-200 text-pink-500 font-black rounded-2xl text-sm uppercase tracking-widest hover:bg-pink-50 transition-colors">
                                Cancelar
                            </button>
                            <button
                                onClick={executeCreate}
                                disabled={formBusy}
                                className="flex-1 py-4 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black rounded-2xl text-sm uppercase tracking-widest shadow-md hover:shadow-lg disabled:opacity-50 transition-all">
                                {formBusy ? 'Guardando...' : 'Confirmar y Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ VISTA NUEVA RESERVA (SIN MODAL) ════ */}
            {showNew && (
                <div className="fade-in">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-pink-100 rounded-2xl text-pink-600"><Tag size={24} strokeWidth={2.5} /></div>
                            <div>
                                <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">Nueva Reserva</h2>
                                <p className="text-pink-400 font-bold text-sm tracking-widest">APARTAR PRENDA</p>
                            </div>
                        </div>
                        <button onClick={() => setShowNew(false)} className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center hover:bg-pink-100 transition-colors"><X size={24} /></button>
                    </div>

                    <form onSubmit={handleCreate} className="space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="fashion-card p-8 space-y-4">
                                    <h3 className="text-xs font-black text-pink-300 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={14} /> Cliente</h3>
                                    <div>
                                        <label className="text-[10px] font-black text-pink-800 uppercase mb-1 block">Nombre Completo *</label>
                                        <input value={form.clientName} onChange={e => setForm(p => ({ ...p, clientName: e.target.value.toUpperCase() }))} className="fashion-input" required />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-pink-800 uppercase mb-1 block">Teléfono / WhatsApp</label>
                                        <input value={form.clientPhone} onChange={e => setForm(p => ({ ...p, clientPhone: e.target.value }))} className="fashion-input" type="tel" />
                                    </div>
                                </div>

                                <div className="fashion-card p-8">
                                    <h3 className="text-xs font-black text-pink-300 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <Package size={14} /> Prendas ({items.length}/{MAX_ITEMS})
                                    </h3>
                                    {(showProductSearch || items.length === 0) && items.length < MAX_ITEMS && (
                                        <div className="relative mb-4">
                                            <input value={prodSearch} onChange={e => setProdSearch(e.target.value)} className="fashion-input" placeholder="BUSCAR POR NOMBRE O CÓDIGO..." />
                                            {prodResults.length > 0 && (
                                                <div className="absolute z-10 w-full mt-2 bg-white border-2 border-pink-100 rounded-3xl shadow-2xl overflow-hidden">
                                                    {prodResults.map(p => (
                                                        <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full p-4 hover:bg-pink-50 text-left border-b last:border-0 border-pink-50">
                                                            <p className="font-black text-pink-950 uppercase text-xs">{p.name}</p>
                                                            <p className="text-[10px] text-pink-400 font-bold uppercase">T: {p.size || '-'} · {p.color || '-'} · {formatCurrency(p.price, currency)}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Lista de prendas del grupo ── */}
                                    <div className="space-y-3">
                                        {items.map((it, idx) => (
                                            <div key={idx} className="bg-pink-900 text-white p-5 rounded-[2rem] shadow-lg shadow-pink-100/50">
                                                <div className="flex justify-between items-center">
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black text-pink-400 uppercase">Prenda {idx + 1}</p>
                                                        <p className="font-bold uppercase text-sm truncate max-w-[200px]">{it.product.name}</p>
                                                        {it.searchedUnitCode && (
                                                            <p className="text-[10px] font-bold text-green-300 mt-0.5">Cód. Unidad: {it.searchedUnitCode}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <div className="text-right">
                                                            {it.customPrice !== '' && parseFloat(it.customPrice) < it.product.price && (
                                                                <p className="text-[10px] line-through text-pink-400">{formatCurrency(it.product.price, currency)}</p>
                                                            )}
                                                            <p className="text-xl font-black">{formatCurrency(itemFinalPrice(it) || 0, currency)}</p>
                                                        </div>
                                                        <button type="button" onClick={() => removeItem(idx)}
                                                            title="Quitar prenda"
                                                            className="p-2 bg-pink-800/60 rounded-xl hover:bg-red-600 transition-colors">
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {/* Editor de precio con descuento */}
                                                <div className="mt-3 pt-3 border-t border-pink-700/50">
                                                    <div className="flex items-center gap-2">
                                                        <Edit2 size={12} className="text-pink-400" />
                                                        <label className="text-[10px] font-black text-pink-400 uppercase">Precio con descuento</label>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder={it.product.price.toFixed(2)}
                                                            value={it.customPrice}
                                                            onChange={e => updateItemPrice(idx, e.target.value)}
                                                            className="flex-1 bg-pink-800/60 text-white font-black rounded-xl px-3 py-2 text-sm border border-pink-700 focus:border-pink-400 outline-none"
                                                        />
                                                        {it.customPrice !== '' && (
                                                            <button type="button" onClick={() => updateItemPrice(idx, '')}
                                                                className="p-2 bg-pink-800/60 rounded-xl hover:bg-pink-700 transition-colors">
                                                                <X size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {it.priceError && <p className="text-[10px] text-red-300 font-bold mt-1">{it.priceError}</p>}
                                                    {!it.priceError && it.customPrice !== '' && parseFloat(it.customPrice) < it.product.price && (
                                                        <p className="text-[10px] text-green-300 font-bold mt-1">Descuento: -{formatCurrency(it.product.price - parseFloat(it.customPrice), currency)}</p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* ── Agregar otra prenda / aviso de máximo ── */}
                                    {items.length > 0 && items.length < MAX_ITEMS && !showProductSearch && (
                                        <button type="button" onClick={() => setShowProductSearch(true)}
                                            className="w-full mt-4 py-4 border-2 border-dashed border-pink-300 text-pink-500 font-black rounded-2xl text-xs uppercase tracking-widest hover:bg-pink-50 transition-colors flex items-center justify-center gap-2">
                                            <Plus size={16} /> Agregar otra prenda
                                        </button>
                                    )}
                                    {items.length >= MAX_ITEMS && (
                                        <p className="mt-4 text-center text-[11px] font-black text-orange-500 uppercase tracking-widest bg-orange-50 border border-orange-200 rounded-2xl py-3">
                                            Máximo {MAX_ITEMS} prendas por reserva
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="fashion-card p-8 bg-gradient-to-br from-white to-pink-50/30">
                                    <h3 className="text-xs font-black text-pink-300 uppercase tracking-widest mb-4 flex items-center gap-2"><DollarSign size={14} /> Pago Bancario / Inicial</h3>
                                    <div className="space-y-4">
                                        {items.length > 0 && (
                                            <div className="bg-pink-900 text-white rounded-2xl p-4 flex justify-between items-center">
                                                <span className="text-[10px] font-black text-pink-400 uppercase tracking-widest">
                                                    Total del grupo ({items.length} {items.length === 1 ? 'prenda' : 'prendas'})
                                                </span>
                                                <span className="text-2xl font-black">{formatCurrency(groupTotal, currency)}</span>
                                            </div>
                                        )}
                                        <div>
                                            <label className="text-[10px] font-black text-pink-800 uppercase mb-1 block">Abono Inicial (único para todo el grupo) *</label>
                                            <input type="number" step="0.01" value={form.initialPayment} onChange={e => setForm(p => ({ ...p, initialPayment: e.target.value }))} className="fashion-input text-2xl font-black py-4" required />
                                            {items.length > 1 && (
                                                <p className="text-[10px] text-pink-400 font-bold mt-1 italic">Se repartirá proporcionalmente entre las {items.length} prendas</p>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {['efectivo', 'qr'].map(m => (
                                                <button key={m} type="button" onClick={() => setForm(p => ({ ...p, paymentMethod: m }))}
                                                    className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all
                                                        ${form.paymentMethod === m ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-50 text-gray-300'}`}>
                                                    {m === 'efectivo' ? '💵 Efectivo' : '📱 Pago QR'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="fashion-card p-8">
                                    <h3 className="text-xs font-black text-pink-300 uppercase tracking-widest mb-4 flex items-center gap-2"><Clock size={14} /> Vigencia y Notas</h3>
                                    <textarea value={form.expiryMessage} onChange={e => setForm(p => ({ ...p, expiryMessage: e.target.value }))} rows={2} className="fashion-input text-[11px] mb-4" required />
                                    <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value.toUpperCase() }))} className="fashion-input text-[11px]" placeholder="NOTAS INTERNAS (PAGO PENDIENTE, ETC)" />
                                </div>
                            </div>
                        </div>

                        {/* Botones de acción integrados en el formulario */}
                        <div className="flex gap-4 pt-4 border-t border-pink-100">
                            <button type="button" onClick={() => setShowNew(false)} className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest hover:border-pink-300 transition-colors">Cancelar</button>
                            <button type="submit" disabled={formBusy || items.length === 0}
                                className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black py-5 rounded-3xl shadow-xl disabled:opacity-50 uppercase tracking-widest">
                                {formBusy ? 'Guardando...' : 'Confirmar Reserva'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ════ VISTA CONFIRMACIÓN (PANTALLA COMPLETA / OVERLAY) ════ */}
            {confirm && (
                <div className="fixed inset-0 z-[100] bg-pink-900/40 backdrop-blur-md flex items-center justify-center p-6 fade-in">
                    <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-md text-center border-2 border-pink-100">
                        <div className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 ${confirm.type === 'complete' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                            {confirm.type === 'complete' ? <CheckCircle size={40} /> : <XCircle size={40} />}
                        </div>
                        <h3 className="text-2xl font-black text-pink-950 uppercase tracking-tight mb-2">
                            {confirm.type === 'complete' ? '¿Entregar Prenda?' : '¿Cancelar Reserva?'}
                        </h3>
                        <p className="text-pink-400 font-bold text-sm mb-6 leading-relaxed px-4">
                            {confirm.type === 'complete' 
                                ? 'Se marcará como completada y se registrará la venta final.' 
                                : 'La prenda volverá al stock. Esta acción no se puede deshacer.'}
                        </p>
                        <div className="space-y-3">
                            <button onClick={() => { 
                                    if(confirm.type === 'complete') completeReservation(confirm.reserva, true);
                                    else cancelReservation(confirm.reserva);
                                    setConfirm(null); 
                                }}
                                className={`w-full py-5 rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-xl transition-all hover:scale-[1.02] active:scale-95 ${confirm.type === 'complete' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                                {confirm.type === 'complete' ? 'SÍ, ENTREGAR AHORA' : 'SÍ, CANCELAR RESERVA'}
                            </button>
                            <button onClick={() => setConfirm(null)} className="w-full py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs text-pink-300 hover:text-pink-500 transition-colors">
                                NO, VOLVER ATRÁS
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
