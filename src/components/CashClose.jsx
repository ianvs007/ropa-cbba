import React from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    db, calculateClosureData, recordCashClosureChange,
    automaticcorrectDataIntegrity, getLocalISOString
} from '../db';
import { usePendingClosureDates } from '../hooks/usePendingClosureDates';
import { canCloseCashDate } from '../utils/pendingClosures';
import {
    DollarSign, TrendingUp, Receipt, Package, CheckCircle,
    AlertTriangle, Printer, ChevronRight, Wallet, CreditCard,
    PiggyBank, Calculator, ClipboardList, ArrowRight, Lock
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { formatCurrency, printCashCloseGlobal } from '../utils';
import useSecureDate from '../hooks/useSecureDate';
import useCashRegister from '../hooks/useCashRegister';
import { useUser } from '../contexts/UserContext';

/**
 * 💰 CashClose — Cierre de Caja Unificado
 * Flujo en 3 pasos: 1) Resumen → 2) Arqueo → 3) Confirmación
 */
export default function CashClose() {
    const { user } = useUser();
    // ── Inicializar seguridad de fecha ────────────────────────────────
    const { today: frozenToday, isManipulated, logEvent } = useSecureDate();
    const { shiftId: activeShiftId, opening: activeOpening, shiftNumber } = useCashRegister();
    
    // ── Estados ────────────────────────────────────────────────────────
    const [date, setDate] = React.useState(frozenToday || getLocalISOString().slice(0, 10));
    const [selectedShiftId, setSelectedShiftId] = React.useState(null);
    // Cierre retroactivo a nivel día (fecha pendiente SIN apertura de turno):
    // fuerza currentShiftId = null para que el cálculo no use el turno de hoy
    const [dayLevelRetro, setDayLevelRetro] = React.useState(false);
    const [step, setStep] = React.useState(1);

    // Sincronizar fecha si frozenToday tarda en cargar (sin pisar una
    // selección activa de turno pendiente o día retroactivo)
    React.useEffect(() => {
        if (frozenToday && date !== frozenToday && !selectedShiftId && !dayLevelRetro) {
            setDate(frozenToday);
        }
    }, [frozenToday]);

    // ── Fechas con cierre pendiente (misma fuente que el banner) ──
    const pendingCloseDates = usePendingClosureDates(frozenToday);

    // Datos del arqueo
    const [cashStart, setCashStart] = React.useState('');
    const [cashCount, setCashCount] = React.useState('');
    const [notes, setNotes] = React.useState('');

    // Estados de UI
    const [isEditing, setIsEditing] = React.useState(false);
    const [existingId, setExistingId] = React.useState(null);
    const { msg, showMsg } = useNotification();

    // Configuración
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';

    // El turno actual: selectedShiftId (turno pendiente elegido), o null en modo
    // día retroactivo (cálculo a nivel día), o activeShiftId (turno activo de hoy)
    const currentShiftId = selectedShiftId || (dayLevelRetro ? null : activeShiftId);

    // ── Datos del turno ──────────────────────────────────────────────────
    // En modo día retroactivo (dayLevelRetro) el cálculo incluye movimientos de
    // TODOS los usuarios: el día pendiente puede deberse a ventas de un vendedor
    // que ya no existe (mismo criterio que el detector de pendientes)
    const salesData = useLiveQuery(
        () => calculateClosureData(date, user?.id, currentShiftId, { allUsers: dayLevelRetro }),
        [date, user?.id, currentShiftId, dayLevelRetro]
    );
    const existing = useLiveQuery(
        () => currentShiftId
            ? db.table('cashClosures')
                .where('openingId').equals(currentShiftId)
                .first()
            : db.table('cashClosures')
                .where('date').equals(date)
                .filter(c => c.userId === user?.id)
                .first(),
        [date, user?.id, currentShiftId]
    );

    // ── Apertura de caja del turno (fondo de inicio automático) ──────
    const todayOpening = useLiveQuery(
        () => currentShiftId
            ? db.table('cashOpenings').get(currentShiftId)
            : db.table('cashOpenings')
                .where('date').equals(date)
                .filter(o => o.userId === user?.id)
                .first(),
        [date, user?.id, currentShiftId]
    );

    // Error de carga si no hay respuesta en tiempo razonable (opcional)
    const [timedOut, setTimedOut] = React.useState(false);
    React.useEffect(() => {
        const timer = setTimeout(() => setTimedOut(true), 4000);
        return () => clearTimeout(timer);
    }, [date]);

    // Robustez: Si salesData llega como nulo o vacío por error, o si pasa mucho tiempo, forzamos salida de carga
    const isLoading = (salesData === undefined || existing === undefined) && !timedOut;

    // ── Cálculos del arqueo ────────────────────────────────────────────
    // Fondo de inicio: usar campo de texto, o fallback a la apertura de caja registrada
    const cashStartIsFromOpening = !!todayOpening && !existingId;
    const startNum = parseFloat(cashStart) || (cashStartIsFromOpening ? (todayOpening?.cashStart ?? 0) : 0);
    const countNum = parseFloat(cashCount) || 0;
    // El efectivo esperado es la suma de Ventas en Efectivo + Abonos de Reservas en Efectivo
    const cashFromSales = (salesData?.cashSales || 0) + (salesData?.cashReservations || 0);
    const cashExpenses = salesData?.cashExpenses || 0;

    // Fórmula: Fondo Inicio + Ingresos Efectivo - Gastos Efectivo = Esperado
    const totalCashExpected = startNum + cashFromSales - cashExpenses;
    const cashDifference = countNum - totalCashExpected;
    const isBalanced = Math.abs(cashDifference) < 0.01;

    // ── Detectar turnos pendientes de cierre (últimos 30 días) ──────
    const pendingShifts = useLiveQuery(async () => {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const iso = thirtyDaysAgo.toISOString().slice(0, 10);
            const today = getLocalISOString().slice(0, 10);

            // Obtener aperturas del usuario en los últimos 30 días
            const openings = await db.table('cashOpenings')
                .where('date').above(iso)
                .filter(o => o.userId === user?.id)
                .toArray();

            // Obtener cierres del usuario
            const closures = await db.table('cashClosures')
                .where('date').above(iso)
                .filter(c => c.userId === user?.id && !!c.closedAt)
                .toArray();

            const closedOpeningIds = new Set(closures.map(c => c.openingId).filter(Boolean));

            // Turnos sin cierre (excluyendo el turno activo de hoy)
            return openings
                .filter(o => !closedOpeningIds.has(o.id) && (o.date < today || (o.date === today && o.id !== activeShiftId)))
                .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '') || (b.id - a.id))
                .slice(0, 10);
        } catch (e) {
            console.error(e);
            return [];
        }
    }, [activeShiftId]);

    // ── Seleccionar un día pendiente para cerrarlo ──
    // Si el día tiene apertura de turno sin cierre, se reutiliza el flujo de
    // turno pendiente (fondo de inicio + openingId). Si no la tiene (solo
    // ventas/abonos), se cierra a nivel día con dayLevelRetro.
    const selectPendingDay = React.useCallback((d) => {
        const shift = (pendingShifts || []).find(s => s.date === d);
        setDate(d);
        if (shift) {
            setSelectedShiftId(shift.id);
            setDayLevelRetro(false);
            setCashStart(shift.cashStart?.toString() || '');
        } else {
            setSelectedShiftId(null);
            setDayLevelRetro(true);
            setCashStart('');
        }
        setCashCount('');
        setNotes('');
        setExistingId(null);
        setIsEditing(false);
        setStep(1);
    }, [pendingShifts]);

    // ── Preselección al llegar desde el banner (state del router) ──
    const location = useLocation();
    const appliedNavRef = React.useRef(false);
    React.useEffect(() => {
        const target = location.state?.pendingDate;
        if (!target || appliedNavRef.current) return;
        // Esperar a que carguen ambas fuentes antes de decidir
        if (pendingShifts === undefined || pendingCloseDates === undefined) return;
        appliedNavRef.current = true;
        if (pendingCloseDates.includes(target)) selectPendingDay(target);
    }, [location.state, pendingShifts, pendingCloseDates, selectPendingDay]);
    // ── SEGURIDAD: Bloquear si hay manipulación detectada ──────────
    React.useEffect(() => {
        if (isManipulated) {
            showMsg('warning', '⚠️ ALERTA DE SEGURIDAD: Manipulación de fecha del SO detectada. Algunas acciones están bloqueadas.');
            logEvent('MANIPULATION_DETECTED', {
                component: 'CashClose',
                user: user?.username,
            }).catch(() => {});
        }
    }, [isManipulated]);
    // ── Cargar cierre existente ────────────────────────────────────────
    React.useEffect(() => {
        if (existing) {
            setCashStart(existing.cashStart?.toString() || todayOpening?.cashStart?.toString() || '');
            setCashCount(existing.cashOnHand != null ? existing.cashOnHand.toString() : '');
            setNotes(existing.notes || '');
            setExistingId(existing.id);
            setIsEditing(false);
            // closedAt existe → cierre completado → mostrar pantalla de éxito/impresión (step 2)
            // closedAt null → caja reabierta → mostrar formulario para nuevo cierre (step 1)
            setStep(existing.closedAt ? 2 : 1);
        } else if (existing !== undefined) {
            // Sin cierre previo: cargar fondo de inicio desde la apertura de caja
            setCashStart(todayOpening?.cashStart?.toString() || '');
            setCashCount('');
            setNotes('');
            setExistingId(null);
            setIsEditing(false);
            setStep(1);
        }
    }, [existing, todayOpening]);

    // ── Permitir edición de cierres cerrados ──
    const handleEnableEdit = () => {
        if (existing?.closedAt) {
            const confirmReopen = window.confirm(
                `🔓 REAPERTURA DE CIERRE\n\n` +
                `Fecha: ${new Date(existing.closedAt).toLocaleString('es')}\n\n` +
                `Deseas REABRIRSE este cierre para:\n` +
                `✓ Corregir datos del arqueo\n\n` +
                `Se registrará en auditoría automáticamente.\n\n` +
                `¿Continuar?`
            );
            if (!confirmReopen) return;
        }
        setIsEditing(true);
    };

    // ── Reabrir caja para seguir vendiendo ──
    const handleReopenRegister = async () => {
        if (!existingId || !existing?.closedAt) return;
        const confirmReopen = window.confirm(
            `🔓 REABRIR CAJA\n\n` +
            `Esto reabrirá el turno y podrás:\n` +
            `✓ Seguir vendiendo\n` +
            `✓ Registrar más gastos\n` +
            `✓ Realizar un nuevo cierre al final\n\n` +
            `El cierre anterior queda registrado en auditoría.\n\n` +
            `¿Continuar?`
        );
        if (!confirmReopen) return;

        try {
            // Auditar la reapertura antes de modificar
            try {
                await recordCashClosureChange(existingId, {
                    ...existing,
                    reopenReason: 'Reapertura para continuar turno',
                    previousClosedAt: existing.closedAt,
                    previousCashOnHand: existing.cashOnHand,
                    previousCashDifference: existing.cashDifference,
                }, user?.name || user?.username);
            } catch (auditErr) {
                console.warn('Advertencia: No se registró en auditoría', auditErr);
            }

            // Limpiar closedAt para marcar como "abierta" — NO borrar el registro
            await db.table('cashClosures').update(existingId, {
                closedAt: null,
                reopenedAt: new Date().toISOString(),
                reopenedBy: user?.name || user?.username,
            });

            setIsEditing(false);
            setCashCount('');
            setNotes('');
            // Mantener cashStart de la apertura
            if (todayOpening) setCashStart(todayOpening.cashStart?.toString() || '');
            setStep(1);
            showMsg('success', 'Caja reabierta. Puedes seguir vendiendo y cerrar al final del turno.');
        } catch (err) {
            console.error('Error al reabrir caja:', err);
            showMsg('error', `Error: ${err.message}`);
        }
    };

    // Handlers simplificados
    const handleSave = async () => {
        if (!salesData) return;
        if (isManipulated) {
            showMsg('error', '⚠️ No se puede cerrar caja con manipulación de fecha detectada. Corrige la fecha del sistema.');
            return;
        }

        // ── Autorización por fecha: hoy = normal; pasada pendiente = retroactivo;
        //    futura = bloqueada. La edición de un cierre existente (existingId)
        //    conserva su flujo/flag original.
        const evaluation = canCloseCashDate({
            selectedDate: date,
            today: frozenToday,
            pendingDates: pendingCloseDates || [],
        });
        if (!existingId && !evaluation.allowed) {
            showMsg('error', `⚠️ ${evaluation.reason}`);
            return;
        }
        const isRetro = existingId ? !!existing?.retroactive : evaluation.retroactive;

        const RETRO_NOTE = 'CIERRE RETROACTIVO — regularización';
        let finalNotes = notes.trim().toUpperCase();
        if (isRetro && !finalNotes.includes('CIERRE RETROACTIVO')) {
            finalNotes = finalNotes ? `${RETRO_NOTE} | ${finalNotes}` : RETRO_NOTE;
        }

        const data = {
            date,
            userId: user?.id,
            username: user?.username,
            openingId: currentShiftId || undefined,
            shiftNumber: todayOpening ? shiftNumber : undefined,
            cashStart: startNum,
            totalSales: salesData.totalSales,
            totalExpenses: salesData.totalExpenses,
            cashExpenses: salesData.cashExpenses,
            netIncome: salesData.netIncome,
            salesCount: salesData.salesCount,
            reservationPaymentsCount: salesData.reservationPaymentsCount,
            transactionCount: salesData.transactionCount,
            expensesCount: salesData.expensesCount,
            itemsSold: salesData.itemsSold,
            cashOnHand: countNum,
            notes: finalNotes,
            retroactive: isRetro || undefined,
            closedBy: user?.name || user?.username,
            closedAt: new Date().toISOString(),
            cashDifference,
            cashSales: salesData.cashSales,
            cashReservations: salesData.cashReservations,
            qrSales: salesData.qrSales,
            qrReservations: salesData.qrReservations,
            totalCashIn: salesData.totalCashIn,
            totalQrIn: salesData.totalQrIn,
            all: salesData.all,
            // Preservar datos de reapertura previos (solo handleReopenRegister los asigna)
            reopenedAt: existing?.reopenedAt || undefined,
            reopenedBy: existing?.reopenedBy || undefined,
        };

        if (existingId) data.id = existingId;

        try {
            const id = await db.transaction('rw', db.cashClosures, db.cashClosureHistory, async () => {
                const resultId = existingId
                    ? await db.table('cashClosures').update(existingId, data)
                    : await db.table('cashClosures').add(data);

                // Auditoría: registrar si fue re-cierre (existía un closedAt previo)
                if (existingId && existing?.closedAt) {
                    await recordCashClosureChange(existingId, data, user?.name || user?.username);
                }

                return resultId;
            });

            setExistingId(id || existingId);
            setIsEditing(false);
            setStep(2);
            showMsg('success', `Cierre ${existingId && existing?.closedAt ? 'reabierto y actualizado' : (existingId ? 'actualizado' : 'registrado')} correctamente`);
        } catch (err) {
            console.error('Error al guardar cierre:', err);
            showMsg('error', `Error: ${err.message}`);
        }
    };

    const handlePrint = () => {
        printCashCloseGlobal({
            ...salesData,
            cashStart: startNum,
            cashOnHand: countNum,
            notes,
            date,
            cashDifference,
        });
    };

    const handleNewDate = () => {
        const nextDate = new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10);
        setDate(nextDate);
        setCashStart('');
        setCashCount('');
        setNotes('');
        setExistingId(null);
        setIsEditing(false);
        setStep(1);
    };

    // ── Render: Paso 1 - Formulario de Cierre (Resumen + Arqueo) ────────
    const renderClosureForm = () => (
        <div className="space-y-6">
            {/* Encabezado Principal */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl shadow-blue-900/20">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-xl font-black uppercase tracking-tight">Cierre de Caja</h2>
                        </div>
                        <div className="flex items-center gap-2 text-blue-100 text-sm font-bold bg-blue-900/30 px-3 py-1.5 rounded-xl border border-blue-400/20">
                            <div className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400" />
                            <span className="opacity-70 uppercase text-[10px] tracking-widest">TURNO:</span>
                            <span className="text-white">{user?.name || user?.username || 'USUARIO DESCONOCIDO'}</span>
                        </div>
                        <p className="text-blue-100/80 text-[10px] mt-2 font-medium italic">
                            ID: {user?.id || 'NO-ID'} • {new Date(date + 'T12:00:00').toLocaleDateString('es', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long'
                            })}
                        </p>
                    </div>
                    <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 backdrop-blur-sm">
                        <Wallet size={32} />
                    </div>
                </div>
            </div>

            {/* ── Días pendientes de cierre (ventas/abonos o turnos sin cerrar) ── */}
            {(pendingCloseDates || []).length > 0 && !selectedShiftId && !dayLevelRetro && (
                <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                            <AlertTriangle size={20} className="text-red-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-red-800 text-sm">⚠️ Días pendientes de cierre</h3>
                            <p className="text-red-500 text-xs">Tienes {pendingCloseDates.length} día(s) sin cerrar caja. Selecciona uno para regularizarlo.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {pendingCloseDates.map(d => {
                            const shift = (pendingShifts || []).find(s => s.date === d);
                            return (
                                <button
                                    key={d}
                                    onClick={() => selectPendingDay(d)}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 transition shadow-sm"
                                >
                                    <Receipt size={14} />
                                    {new Date(d + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}
                                    {shift && ` • ${new Date(shift.openedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`}
                                    <span className="opacity-75">— Cerrar este día</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Info de turno/día pendiente seleccionado */}
            {(selectedShiftId || dayLevelRetro) && (
                <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 p-3 rounded-xl">
                    <span className="text-orange-600 text-xs font-bold">
                        📅 Cerrando {selectedShiftId ? 'turno' : 'día'} pendiente del {new Date(date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long' })}
                        {' '}(cierre retroactivo — quedará auditado)
                    </span>
                    <button
                        onClick={() => {
                            setDate(frozenToday || getLocalISOString().slice(0, 10));
                            setSelectedShiftId(null);
                            setDayLevelRetro(false);
                            setCashStart('');
                            setCashCount('');
                            setNotes('');
                            setExistingId(null);
                            setIsEditing(false);
                            setStep(1);
                        }}
                        className="text-[10px] text-pink-600 font-bold underline hover:text-pink-800 ml-auto"
                    >
                        ← Volver a hoy
                    </button>
                </div>
            )}

            {/* Selector de Fecha */}
            <div className="flex items-center gap-3 bg-white p-4 rounded-xl shadow-sm border border-pink-100">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-pink-400 uppercase mb-1 flex items-center gap-1">
                        <Lock size={12} />
                        Fecha del Cierre
                    </label>
                    {/* Texto formateado con locale 'es' explícito: el <input type="date">
                        nativo mostraba MM/DD/YYYY en navegadores con locale en-US */}
                    <input
                        type="text"
                        value={new Date(date + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        disabled={true}
                        className="w-full bg-gray-50 text-pink-900 font-bold focus:outline-none cursor-not-allowed opacity-75"
                    />
                    <p className="text-[10px] text-pink-400 mt-1">
                        {currentShiftId && todayOpening
                            ? `🔄 Turno #${shiftNumber} • Abierto: ${new Date(todayOpening.openedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
                            : '🔐 Fecha congelada al login para seguridad'
                        }
                    </p>
                </div>
                {isManipulated && (
                    <div className="bg-red-100 p-2 rounded-lg">
                        <AlertTriangle size={20} className="text-red-600" />
                    </div>
                )}
            </div>

            {/* Sin actividad o error de carga */}
            {(isLoading || !salesData) ? (
                <div className="py-12 flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-3 border-pink-500/30 border-t-pink-500 rounded-full animate-spin" />
                    <p className="text-pink-600 font-semibold">{isLoading ? 'Cargando datos...' : 'Datos no disponibles'}</p>
                </div>
            ) : (!salesData.all || salesData.all.length === 0) ? (
                /* Si hay turno abierto/pendiente, mostrar aviso pero NO bloquear el cierre */
                (currentShiftId || todayOpening) ? (
                    <>
                        <div className="text-center py-6">
                            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Package size={32} className="text-amber-400" />
                            </div>
                            <h3 className="text-base font-bold text-amber-800 mb-1">Turno sin ventas registradas</h3>
                            <p className="text-amber-500 text-xs">No se encontraron ventas ni abonos en este turno, pero puedes cerrarlo igualmente.</p>
                        </div>

                        {/* Formulario de Arqueo — siempre visible para turnos abiertos */}
                        <div className="space-y-4">
                            <div className="fashion-card p-5 border-2 border-blue-100">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-blue-900 flex items-center gap-2">
                                        <DollarSign size={18} className="text-blue-600" />
                                        Arqueo Físico
                                    </h3>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">
                                            Fondo de Inicio
                                            {todayOpening && !existingId && (
                                                <span className="ml-2 text-emerald-500 font-bold">✓ Registrado en apertura</span>
                                            )}
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={cashStart}
                                            onChange={e => setCashStart(e.target.value)}
                                            disabled={(!!existingId && !isEditing) || (!!todayOpening && !existingId)}
                                            className="w-full fashion-input h-10 font-bold"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Efectivo en Caja (Contado)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={cashCount}
                                            onChange={e => setCashCount(e.target.value)}
                                            disabled={!!existingId && !isEditing}
                                            className="w-full fashion-input h-12 text-lg font-black border-2 focus:border-pink-500"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Observaciones</label>
                                        <textarea
                                            value={notes}
                                            onChange={e => setNotes(e.target.value)}
                                            disabled={!!existingId && !isEditing}
                                            className="w-full fashion-input h-16 resize-none text-sm"
                                            placeholder="Notas opcionales..."
                                        />
                                    </div>
                                </div>

                                {/* Diferencia Dinámica */}
                                {(cashStart || cashCount) && (
                                    <div className="mt-4 p-3 rounded-xl bg-gray-50 border border-gray-200">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs text-gray-500">Debería haber:</span>
                                            <span className="text-sm font-bold text-gray-700">{formatCurrency(totalCashExpected, currency)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-bold text-gray-700">Diferencia:</span>
                                            <span className={`text-base font-black ${
                                                isBalanced ? 'text-green-600' :
                                                cashDifference > 0 ? 'text-blue-600' : 'text-red-600'
                                            }`}>
                                                {cashDifference >= 0 ? '+' : ''}{formatCurrency(cashDifference, currency)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={(cashStart === '' && !cashStartIsFromOpening) || cashCount === '' || isManipulated}
                                className={`w-full h-14 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition shadow-lg
                                    ${(cashStart === '' && !cashStartIsFromOpening) || cashCount === '' || isManipulated
                                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                                        : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white hover:shadow-pink-200'
                                    }`}
                            >
                                <CheckCircle size={22} />
                                {existingId ? 'Actualizar Cierre' : 'Guardar y Cerrar Caja'}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-12">
                        <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Package size={40} className="text-pink-300" />
                        </div>
                        <h3 className="text-lg font-bold text-pink-900 mb-2">Sin actividad registrada</h3>
                        <p className="text-pink-400 text-sm mb-4">No hay ventas ni abonos en esta fecha</p>
                        <button
                            onClick={() => setDate(new Date(Date.now() - 86400000).toISOString().slice(0, 10))}
                            className="text-pink-600 font-semibold text-sm hover:underline"
                        >
                            ← Ver día anterior
                        </button>
                    </div>
                )
            ) : (
                <>
                    {/* Resumen del Sistema */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <KpiCard
                            label="Efectivo en Caja"
                            value={formatCurrency(salesData.totalCashIn - salesData.cashExpenses, currency)}
                            icon={Wallet}
                            color="blue"
                        />
                        <KpiCard
                            label="Ventas Turno"
                            value={formatCurrency(salesData.totalSales, currency)}
                            icon={TrendingUp}
                            color="pink"
                        />
                        <KpiCard
                            label="Utilidad Neta"
                            value={formatCurrency(salesData.netIncome, currency)}
                            icon={PiggyBank}
                            color="green"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Columna Izquierda: Detalle de Ingresos */}
                        <div className="space-y-4">
                            <div className="fashion-card p-5">
                                <h3 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                                    <Wallet size={18} className="text-pink-600" />
                                    Ingresos en Efectivo
                                </h3>
                                <div className="space-y-3">
                                    <DetailRow
                                        label="Ventas al contado"
                                        amount={salesData.cashSales}
                                        icon="🛍️"
                                        bg="pink"
                                    />
                                    <DetailRow
                                        label="Abonos por reservas"
                                        amount={salesData.cashReservations}
                                        icon="🔖"
                                        bg="pink"
                                    />
                                    <DetailRow
                                        label="Gastos en efectivo"
                                        amount={-salesData.cashExpenses}
                                        icon="💸"
                                        bg="red"
                                        negative
                                    />
                                    <div className="border-t border-pink-100 pt-3 mt-3">
                                        <DetailRow
                                            label="Neto en caja"
                                            amount={salesData.totalCashIn - salesData.cashExpenses}
                                            icon="📦"
                                            bg="blue"
                                            bold
                                        />
                                    </div>
                                </div>
                            </div>

                            {salesData.totalQrIn > 0 && (
                                <div className="fashion-card p-5">
                                    <h3 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                                        <CreditCard size={18} className="text-blue-600" />
                                        Ingresos QR / Banco
                                    </h3>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between bg-blue-50 rounded-xl p-4 border border-blue-100">
                                            <span className="text-sm font-bold text-blue-800">Total No-Efectivo</span>
                                            <span className="font-black text-blue-700 text-lg">
                                                {formatCurrency(salesData.totalQrIn, currency)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Columna Derecha: Formulario de Arqueo */}
                        <div className="space-y-4">
                            <div className="fashion-card p-5 border-2 border-blue-100">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-blue-900 flex items-center gap-2">
                                        <DollarSign size={18} className="text-blue-600" />
                                        Arqueo Físico
                                    </h3>
                                    {existingId && !isEditing && (
                                        <button
                                            onClick={handleEnableEdit}
                                            className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
                                                existing?.closedAt
                                                    ? 'text-orange-600 bg-orange-50 border-orange-100 hover:bg-orange-100'
                                                    : 'text-pink-600 bg-pink-50 border-pink-100 hover:bg-pink-100'
                                            }`}
                                        >
                                            {existing?.closedAt ? '🔓 REABRIR' : 'EDITAR'}
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">
                                            Fondo de Inicio
                                            {todayOpening && !existingId && (
                                                <span className="ml-2 text-emerald-500 font-bold">✓ Registrado en apertura</span>
                                            )}
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={cashStart}
                                            onChange={e => setCashStart(e.target.value)}
                                            disabled={(!!existingId && !isEditing) || (!!todayOpening && !existingId)}
                                            className="w-full fashion-input h-10 font-bold"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Efectivo en Caja (Contado)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={cashCount}
                                            onChange={e => setCashCount(e.target.value)}
                                            disabled={!!existingId && !isEditing}
                                            className="w-full fashion-input h-12 text-lg font-black border-2 focus:border-pink-500"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Observaciones</label>
                                        <textarea
                                            value={notes}
                                            onChange={e => setNotes(e.target.value)}
                                            disabled={!!existingId && !isEditing}
                                            className="w-full fashion-input h-16 resize-none text-sm"
                                            placeholder="Notas opcionales..."
                                        />
                                    </div>
                                </div>

                                {/* Diferencia Dinámica */}
                                {(cashStart || cashCount) && (
                                    <div className="mt-4 p-3 rounded-xl bg-gray-50 border border-gray-200">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs text-gray-500">Debería haber:</span>
                                            <span className="text-sm font-bold text-gray-700">{formatCurrency(totalCashExpected, currency)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-bold text-gray-700">Diferencia:</span>
                                            <span className={`text-base font-black ${
                                                isBalanced ? 'text-green-600' :
                                                cashDifference > 0 ? 'text-blue-600' : 'text-red-600'
                                            }`}>
                                                {cashDifference >= 0 ? '+' : ''}{formatCurrency(cashDifference, currency)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={(cashStart === '' && !cashStartIsFromOpening) || cashCount === '' || isManipulated}
                                className={`w-full h-14 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition shadow-lg
                                    ${(cashStart === '' && !cashStartIsFromOpening) || cashCount === '' || isManipulated
                                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                                        : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white hover:shadow-pink-200'
                                    }`}
                            >
                                <CheckCircle size={22} />
                                {existingId ? 'Actualizar Cierre' : 'Guardar y Cerrar Caja'}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
    // ── Render: Paso 2 - Éxito y Opciones de Impresión ──────────────────
    const renderStepSuccess = () => (
        <div className="space-y-6">
            {/* Encabezado de éxito */}
            <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-2xl p-8 text-white shadow-lg text-center">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={40} />
                </div>
                <h2 className="text-2xl font-bold mb-2">¡Cierre Completado!</h2>
                <p className="text-green-100 font-medium">
                    El arqueo de caja del {new Date(date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long' })} ha sido guardado correctamente.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                    onClick={handlePrint}
                    className="flex flex-col items-center gap-3 p-6 bg-white border-2 border-pink-100 rounded-3xl hover:bg-pink-50 transition shadow-sm group"
                >
                    <div className="w-14 h-14 bg-pink-100 text-pink-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
                        <Printer size={28} />
                    </div>
                    <div>
                        <p className="font-bold text-pink-900">Imprimir Reporte</p>
                        <p className="text-xs text-pink-400">Obtener comprobante detallado en PDF</p>
                    </div>
                </button>

                <button
                    onClick={handleNewDate}
                    className="flex flex-col items-center gap-3 p-6 bg-white border-2 border-blue-100 rounded-3xl hover:bg-blue-50 transition shadow-sm group"
                >
                    <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
                        <ArrowRight size={28} />
                    </div>
                    <div>
                        <p className="font-bold text-blue-900">Ver Siguiente Día</p>
                        <p className="text-xs text-blue-400">Continuar con la fecha posterior</p>
                    </div>
                </button>

                {existing?.closedAt && date === (frozenToday || getLocalISOString().slice(0, 10)) && (
                    <button
                        onClick={handleReopenRegister}
                        className="flex flex-col items-center gap-3 p-6 bg-white border-2 border-emerald-100 rounded-3xl hover:bg-emerald-50 transition shadow-sm group"
                    >
                        <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
                            🔓
                        </div>
                        <div>
                            <p className="font-bold text-emerald-900">Reabrir Caja</p>
                            <p className="text-xs text-emerald-500">Seguir vendiendo y cerrar después</p>
                        </div>
                    </button>
                )}

                {existing?.closedAt && (
                    <button
                        onClick={() => {
                            handleEnableEdit();
                            setStep(1);
                        }}
                        className="flex flex-col items-center gap-3 p-6 bg-white border-2 border-orange-100 rounded-3xl hover:bg-orange-50 transition shadow-sm group"
                    >
                        <div className="w-14 h-14 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
                            ✏️
                        </div>
                        <div>
                            <p className="font-bold text-orange-900">Corregir Cierre</p>
                            <p className="text-xs text-orange-400">Editar datos del arqueo</p>
                        </div>
                    </button>
                )}
            </div>

            {/* Resumen Final */}
            <div className="fashion-card p-5 opacity-90">
                <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                    <ClipboardList size={18} />
                    Resumen de Operación
                </h3>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center py-2">
                        <span className="text-gray-500">Neto Esperado (Sistema):</span>
                        <span className="font-bold text-gray-700">{formatCurrency(totalCashExpected, currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                        <span className="text-gray-500">Contado Físicamente:</span>
                        <span className="font-bold text-gray-700">{formatCurrency(countNum, currency)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 bg-gray-50 px-4 rounded-xl mt-2 border border-gray-200">
                        <span className="font-bold text-gray-700 text-base">Diferencia Final:</span>
                        <span className={`text-lg font-black ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(cashDifference, currency)}
                        </span>
                    </div>
                </div>
                {notes && (
                    <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                        <p className="text-xs font-bold text-amber-700 mb-1 tracking-wider uppercase">Observaciones:</p>
                        <p className="text-sm text-amber-900 leading-relaxed italic">"{notes}"</p>
                    </div>
                )}
            </div>
        </div>
    );

    // ── Render Principal (Con estado de carga seguro) ──────────────────
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 fade-in">
                <div className="w-12 h-12 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin" />
                <div className="text-center">
                    <p className="text-pink-900 font-black uppercase tracking-tight">Sincronizando Turno</p>
                    <p className="text-pink-500 text-sm font-bold animate-pulse">{user?.name || user?.username}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto fade-in pb-8">
            {/* Notificaciones Flash */}
            {msg && (
                <div className={`mb-5 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium animate-pulse
                    ${msg.type === 'success'
                        ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    {msg.text}
                </div>
            )}

            {/* Selector de Pasos Simplificado */}
            <div className="flex items-center justify-center gap-8 mb-8">
                <div className="flex flex-col items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all shadow-md
                        ${step === 1 ? 'bg-pink-600 text-white ring-4 ring-pink-100 scale-110' : 'bg-green-500 text-white'}`}>
                        {step === 1 ? '1' : <CheckCircle size={20} />}
                    </div>
                    <span className={`text-[10px] font-black tracking-widest ${step === 1 ? 'text-pink-900' : 'text-green-600'}`}>FORMULARIO</span>
                </div>
                <div className={`w-12 h-1 rounded-full ${step === 2 ? 'bg-green-500' : 'bg-gray-200'}`} />
                <div className="flex flex-col items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all shadow-md
                        ${step === 2 ? 'bg-pink-600 text-white ring-4 ring-pink-100 scale-110' : 'bg-gray-200 text-gray-400'}`}>
                        2
                    </div>
                    <span className={`text-[10px] font-black tracking-widest ${step === 2 ? 'text-pink-900' : 'text-gray-400'}`}>ÉXITO</span>
                </div>
            </div>

            {/* Contenido Dinámico */}
            {step === 1 ? renderClosureForm() : renderStepSuccess()}
        </div>
    );
}

// ── Componentes Auxiliares ────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color }) {
    const colorClasses = {
        pink: 'bg-pink-100 text-pink-600',
        red: 'bg-red-100 text-red-600',
        green: 'bg-green-100 text-green-600',
        purple: 'bg-purple-100 text-purple-600',
        blue: 'bg-blue-100 text-blue-600',
    };

    return (
        <div className="fashion-card p-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colorClasses[color]}`}>
                <Icon size={20} />
            </div>
            <p className="text-lg font-black text-pink-900">{value}</p>
            <p className="text-xs text-pink-500 font-medium mt-0.5">{label}</p>
        </div>
    );
}

function DetailRow({ label, amount, icon, bg = 'pink', negative = false, bold = false, currency = 'Bs.' }) {
    const bgClasses = {
        pink: 'bg-pink-50',
        red: 'bg-red-50',
        blue: 'bg-blue-50',
    };

    return (
        <div className={`flex items-center justify-between ${bgClasses[bg]} rounded-xl px-4 py-3 border border-pink-100/50`}>
            <div className="flex items-center gap-3">
                <span className="text-xl">{icon}</span>
                <span className={`text-sm ${bold ? 'font-bold' : 'font-medium'} text-pink-800`}>{label}</span>
            </div>
            <span className={`text-base ${bold ? 'font-black' : 'font-bold'} ${negative ? 'text-red-600' : 'text-pink-700'}`}>
                {amount >= 0 ? '' : '-'}{formatCurrency(Math.abs(amount), currency)}
            </span>
        </div>
    );
}

function StepIndicator({ number, active, completed, label }) {
    return (
        <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition
                ${completed
                    ? 'bg-pink-500 text-white'
                    : active
                        ? 'bg-pink-600 text-white ring-4 ring-pink-200'
                        : 'bg-pink-100 text-pink-400'
                }`}>
                {completed ? <CheckCircle size={16} /> : number}
            </div>
            <span className={`text-xs font-bold hidden sm:block ${active ? 'text-pink-700' : 'text-pink-300'}`}>
                {label}
            </span>
        </div>
    );
}
