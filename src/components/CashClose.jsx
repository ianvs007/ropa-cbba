import React from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    db, calculateClosureData, recordCashClosureChange,
    automaticcorrectDataIntegrity, regularizePendingClosures, getLocalISOString
} from '../db';
import { usePendingClosureDates, usePendingClosuresSummary } from '../hooks/usePendingClosureDates';
import { canCloseCashDate } from '../utils/pendingClosures';
import {
    DollarSign, TrendingUp, Receipt, Package, CheckCircle,
    AlertTriangle, Printer, ChevronRight, Wallet, CreditCard,
    PiggyBank, Calculator, ClipboardList, Lock
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { formatCurrency, printCashCloseGlobal } from '../utils';
import useSecureDate from '../hooks/useSecureDate';
import useCashRegister from '../hooks/useCashRegister';
import CashOpenModal from './CashOpenModal';
import { useUser } from '../contexts/UserContext';

/**
 * 💰 CashClose — Cierre de Caja Unificado
 * Flujo en 2 pasos: 1) Arqueo → 2) Completado
 */
export default function CashClose() {
    const { user } = useUser();
    // ── Inicializar seguridad de fecha ────────────────────────────────
    const { today: frozenToday, isManipulated, logEvent } = useSecureDate();
    const {
        isOpen: shiftIsOpen,
        shiftId: activeShiftId,
        opening: activeOpening,
        shiftNumber,
        openCash,
    } = useCashRegister();
    
    // ── Estados ────────────────────────────────────────────────────────
    const [date, setDate] = React.useState(frozenToday || getLocalISOString().slice(0, 10));
    const [selectedShiftId, setSelectedShiftId] = React.useState(null);
    // Cierre retroactivo a nivel día (fecha pendiente SIN apertura de turno):
    // fuerza currentShiftId = null para que el cálculo no use el turno de hoy
    const [dayLevelRetro, setDayLevelRetro] = React.useState(false);
    const [step, setStep] = React.useState(1);

    // Estados para gestión compacta y regularización masiva de pendientes
    const [showAllPending, setShowAllPending] = React.useState(false);
    const [confirmRegularizeModal, setConfirmRegularizeModal] = React.useState(false);
    const [regularizingAll, setRegularizingAll] = React.useState(false);
    const [manualOpenModal, setManualOpenModal] = React.useState(false);

    // Sincronizar fecha si frozenToday tarda en cargar (sin pisar una
    // selección activa de turno pendiente o día retroactivo)
    React.useEffect(() => {
        if (frozenToday && date !== frozenToday && !selectedShiftId && !dayLevelRetro) {
            setDate(frozenToday);
        }
    }, [frozenToday]);

    // ── Fechas con cierre pendiente (misma fuente que el banner) ──
    const pendingCloseDates = usePendingClosureDates(frozenToday);
    const pendingDaysSummary = usePendingClosuresSummary(frozenToday) || [];
    const summaryByDate = React.useMemo(
        () => Object.fromEntries(pendingDaysSummary.map(item => [item.date, item])),
        [pendingDaysSummary]
    );

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

            // Días regularizados con cierre RETROACTIVO (de cualquier usuario):
            // limpian el día completo, incluidas las aperturas sin cierre por openingId
            const retroClosures = await db.table('cashClosures')
                .where('date').above(iso)
                .filter(c => !!c.closedAt && c.retroactive === true)
                .toArray();
            const retroDates = new Set(retroClosures.map(c => (c.date || '').slice(0, 10)));

            // Turnos sin cierre (excluyendo el turno activo de hoy)
            return openings
                .filter(o => !closedOpeningIds.has(o.id) && !retroDates.has((o.date || '').slice(0, 10))
                    && (o.date < today || (o.date === today && o.id !== activeShiftId)))
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
                `✏️ CORREGIR CIERRE\n\n` +
                `Fecha: ${new Date(existing.closedAt).toLocaleString('es')}\n\n` +
                `¿Deseas corregir los datos del arqueo de este cierre?\n` +
                `El turno seguirá cerrado.\n` +
                `El cambio quedará registrado en auditoría automáticamente.\n\n` +
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
        //    futura = bloqueada. Al actualizar un cierre existente (existingId) se
        //    conserva su flag, PERO si el día sigue pendiente (evaluation.retroactive)
        //    se promueve a retroactivo: un cierre viejo no-retroactivo no limpia los
        //    movimientos de OTROS usuarios del día y lo dejaba atascado para siempre
        //    (la corrección nunca lo convertía en retroactivo → día pendiente eterno).
        const evaluation = canCloseCashDate({
            selectedDate: date,
            today: frozenToday,
            pendingDates: pendingCloseDates || [],
        });
        if (!existingId && !evaluation.allowed) {
            showMsg('error', `⚠️ ${evaluation.reason}`);
            return;
        }
        const isRetro = existingId
            ? (!!existing?.retroactive || evaluation.retroactive)
            : evaluation.retroactive;

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

    const returnToToday = React.useCallback(() => {
        setDate(frozenToday || getLocalISOString().slice(0, 10));
        setSelectedShiftId(null);
        setDayLevelRetro(false);
        setCashStart('');
        setCashCount('');
        setNotes('');
        setExistingId(null);
        setIsEditing(false);
        setStep(1);
    }, [frozenToday]);

    // ── Regularizar todos los días pendientes en 1 clic ──
    const handleRegularizeAll = async () => {
        if (regularizingAll || !(pendingCloseDates || []).length) return;
        setRegularizingAll(true);
        try {
            const res = await regularizePendingClosures({
                dates: pendingCloseDates,
                today: frozenToday,
                user,
            });
            setConfirmRegularizeModal(false);
            returnToToday();
            showMsg('success', `✅ Se regularizaron y cerraron ${res.count} día(s) pendientes correctamente`);
        } catch (err) {
            console.error('Error al regularizar días pendientes:', err);
            showMsg('error', `Error al regularizar: ${err.message}`);
        } finally {
            setRegularizingAll(false);
        }
    };

    const isRetroMode = !!(selectedShiftId || dayLevelRetro);
    const pendingList = pendingCloseDates || [];
    const visiblePendingDates = showAllPending ? pendingList : pendingList.slice(0, 6);

    // ── Render: Paso 1 - Formulario de Cierre (Resumen + Arqueo) ────────
    const renderClosureForm = () => (
        <div className="space-y-6">
            {/* Encabezado Principal con estado claro del turno y acciones rápidas */}
            <div className={`rounded-2xl p-6 text-white shadow-xl transition-colors ${
                isRetroMode
                    ? 'bg-gradient-to-r from-amber-600 to-orange-700 shadow-orange-900/20'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-700 shadow-blue-900/20'
            }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <h2 className="text-xl font-black uppercase tracking-tight">
                                {isRetroMode ? 'Regularización de Caja (Día Anterior)' : 'Abrir / Cerrar Caja'}
                            </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-2 text-blue-100 text-xs font-bold bg-black/20 px-3 py-1.5 rounded-xl border border-white/15">
                                <div className={`w-2 h-2 rounded-full ${
                                    isRetroMode ? 'bg-amber-300' : (shiftIsOpen ? 'bg-green-400 shadow-sm shadow-green-400' : 'bg-gray-300')
                                }`} />
                                <span className="opacity-80 uppercase text-[10px] tracking-widest">
                                    {isRetroMode
                                        ? 'MODO RETROACTIVO:'
                                        : (shiftIsOpen ? `CAJA ABIERTA (TURNO #${shiftNumber || 1}):` : 'CAJA HOY:')}
                                </span>
                                <span className="text-white">{user?.name || user?.username || 'USUARIO'}</span>
                            </div>
                            {todayOpening && !isRetroMode && (
                                <span className="text-[11px] font-bold bg-white/15 px-3 py-1.5 rounded-xl border border-white/10">
                                    Fondo inicial: {formatCurrency(todayOpening.cashStart || 0, currency)}
                                </span>
                            )}
                        </div>
                        <p className="text-white/80 text-xs mt-2 font-medium">
                            📅 {new Date(date + 'T12:00:00').toLocaleDateString('es', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                            })}
                        </p>
                    </div>
                    <div className="flex items-center gap-3 self-start sm:self-center">
                        {isRetroMode ? (
                            <button
                                onClick={returnToToday}
                                className="px-4 py-2.5 bg-white text-orange-700 font-black text-xs uppercase tracking-wider rounded-xl shadow hover:bg-orange-50 transition"
                            >
                                ← Volver al Turno de Hoy
                            </button>
                        ) : !shiftIsOpen && (
                            <button
                                onClick={() => setManualOpenModal(true)}
                                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center gap-1.5 border border-emerald-300/40"
                            >
                                🔓 Abrir Nuevo Turno
                            </button>
                        )}
                        <div className="w-14 h-14 bg-white/10 rounded-2xl hidden sm:flex items-center justify-center border border-white/10 backdrop-blur-sm">
                            <Wallet size={28} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Panel Compacto e Inteligente de Días Pendientes de Cierre ── */}
            {pendingList.length > 0 && !isRetroMode && (
                <div className="bg-red-50/90 border-2 border-red-200 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                                <AlertTriangle size={20} className="text-red-600" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-black text-red-900 text-sm">
                                        Tienes {pendingList.length} día(s) anterior(es) sin cerrar caja
                                    </h3>
                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-red-200/80 text-red-800 px-2 py-0.5 rounded-full">
                                        Historial pendiente
                                    </span>
                                </div>
                                <p className="text-red-700/80 text-xs mt-0.5 leading-relaxed">
                                    Son fechas pasadas donde quedaron ventas, abonos o turnos abiertos (incluyendo datos de prueba) sin cierre registrado. Puedes regularizar todos en 1 clic o revisar uno por uno.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setConfirmRegularizeModal(true)}
                                className="px-4 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md transition flex items-center gap-1.5"
                            >
                                <CheckCircle size={15} />
                                Regularizar todos ({pendingList.length})
                            </button>
                        </div>
                    </div>

                    {/* Grilla compacta de días pendientes (máx 6 por defecto) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {visiblePendingDates.map(d => {
                            const shift = (pendingShifts || []).find(s => s.date === d);
                            const info = summaryByDate[d];
                            return (
                                <button
                                    key={d}
                                    onClick={() => selectPendingDay(d)}
                                    className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white hover:bg-red-600 text-red-900 hover:text-white border border-red-200 hover:border-red-600 rounded-xl transition shadow-xs group text-left"
                                >
                                    <div className="min-w-0">
                                        <p className="text-xs font-black capitalize truncate">
                                            {new Date(d + 'T12:00:00').toLocaleDateString('es', {
                                                weekday: 'short',
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                            })}
                                        </p>
                                        <p className="text-[11px] text-red-500 group-hover:text-red-100 font-semibold truncate">
                                            {info
                                                ? `${info.label} • Esp: ${formatCurrency(info.expectedCash, currency)}`
                                                : (shift ? `Turno abierto ${new Date(shift.openedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'Pendiente de arqueo')}
                                        </p>
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-wider bg-red-100 group-hover:bg-white/20 text-red-700 group-hover:text-white px-2.5 py-1 rounded-lg shrink-0">
                                        Cerrar →
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {pendingList.length > 6 && (
                        <div className="flex items-center justify-between pt-1 border-t border-red-200/60">
                            <span className="text-[11px] text-red-600 font-medium">
                                Mostrando {visiblePendingDates.length} de {pendingList.length} días pendientes
                            </span>
                            <button
                                onClick={() => setShowAllPending(prev => !prev)}
                                className="text-xs font-black text-red-700 hover:text-red-900 underline cursor-pointer"
                            >
                                {showAllPending ? '▲ Mostrar menos' : `▼ Ver los ${pendingList.length} días`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Info de turno/día pendiente seleccionado */}
            {isRetroMode && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl">
                    <div className="flex items-center gap-2.5">
                        <span className="text-lg">📅</span>
                        <div>
                            <p className="text-amber-900 text-xs font-black uppercase tracking-wide">
                                Regularizando {selectedShiftId ? 'turno' : 'día'} del {new Date(date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                            </p>
                            <p className="text-amber-700 text-[11px]">
                                Este cierre se guardará como retroactivo y limpiará la fecha pendiente para todos los usuarios.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={returnToToday}
                        className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-bold rounded-xl hover:bg-amber-100 transition"
                    >
                        ← Volver al Turno de Hoy
                    </button>
                </div>
            )}

            {/* Selector de Fecha */}
            <div className="flex items-center gap-3 bg-white p-4 rounded-xl shadow-sm border border-pink-100">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-pink-400 uppercase mb-1 flex items-center gap-1">
                        <Lock size={12} />
                        Fecha del Arqueo
                    </label>
                    <input
                        type="text"
                        value={new Date(date + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        disabled={true}
                        className="w-full bg-gray-50 text-pink-900 font-bold focus:outline-none cursor-not-allowed opacity-75"
                    />
                    <p className="text-[10px] text-pink-400 mt-1">
                        {currentShiftId && todayOpening
                            ? `🔄 Turno #${shiftNumber} • Abierto: ${new Date(todayOpening.openedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
                            : '🔐 Fecha protegida por el control de seguridad de caja'
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
                /* Si hay turno abierto/pendiente o modo retroactivo, permitir cerrar aunque no haya ventas */
                (currentShiftId || todayOpening || isRetroMode) ? (
                    <>
                        <div className="text-center py-6 bg-amber-50/60 border border-amber-200/80 rounded-2xl">
                            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-2">
                                <Package size={28} className="text-amber-600" />
                            </div>
                            <h3 className="text-base font-bold text-amber-900 mb-1">Turno sin ventas en efectivo/QR</h3>
                            <p className="text-amber-700 text-xs max-w-md mx-auto">
                                No se registraron ventas ni abonos de caja en esta fecha, pero puedes completar el arqueo y cerrar el turno normalmente.
                            </p>
                        </div>

                        {/* Formulario de Arqueo — siempre visible para turnos abiertos */}
                        <ArqueoFisicoCard
                            cashStart={cashStart}
                            setCashStart={setCashStart}
                            cashCount={cashCount}
                            setCashCount={setCashCount}
                            notes={notes}
                            setNotes={setNotes}
                            existingId={existingId}
                            isEditing={isEditing}
                            todayOpening={todayOpening}
                            cashStartIsFromOpening={cashStartIsFromOpening}
                            totalCashExpected={totalCashExpected}
                            cashDifference={cashDifference}
                            isBalanced={isBalanced}
                            isManipulated={isManipulated}
                            currency={currency}
                            handleSave={handleSave}
                            handleEnableEdit={handleEnableEdit}
                            existing={existing}
                        />
                    </>
                ) : (
                    <div className="text-center py-12 bg-white rounded-2xl border border-pink-100 shadow-xs">
                        <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Package size={40} className="text-pink-300" />
                        </div>
                        <h3 className="text-lg font-bold text-pink-900 mb-2">Aún no hay actividad hoy</h3>
                        <p className="text-pink-400 text-sm mb-5">
                            No tienes un turno abierto ni ventas registradas en esta fecha.
                        </p>
                        <button
                            onClick={() => setManualOpenModal(true)}
                            className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-emerald-200 transition inline-flex items-center gap-2"
                        >
                            🔓 Abrir Caja e Iniciar Turno Hoy
                        </button>
                    </div>
                )
            ) : (
                <>
                    {/* Resumen del Sistema */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <KpiCard
                            label="Efectivo Neto de Ventas"
                            value={formatCurrency(salesData.totalCashIn - salesData.cashExpenses, currency)}
                            icon={Wallet}
                            color="blue"
                        />
                        <KpiCard
                            label="Total Ingresos (Efectivo + QR)"
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
                                    Movimientos en Efectivo ({salesData.transactionCount} op.)
                                </h3>
                                <div className="space-y-3">
                                    <DetailRow
                                        label="Fondo de inicio de turno"
                                        amount={startNum}
                                        icon="🔓"
                                        bg="blue"
                                        currency={currency}
                                    />
                                    <DetailRow
                                        label="Ventas al contado"
                                        amount={salesData.cashSales}
                                        icon="🛍️"
                                        bg="pink"
                                        currency={currency}
                                    />
                                    <DetailRow
                                        label="Abonos por reservas"
                                        amount={salesData.cashReservations}
                                        icon="🔖"
                                        bg="pink"
                                        currency={currency}
                                    />
                                    <DetailRow
                                        label="Gastos en efectivo"
                                        amount={-salesData.cashExpenses}
                                        icon="💸"
                                        bg="red"
                                        negative
                                        currency={currency}
                                    />
                                    <div className="border-t border-pink-100 pt-3 mt-3">
                                        <DetailRow
                                            label="Efectivo esperado en cajón"
                                            amount={totalCashExpected}
                                            icon="📦"
                                            bg="blue"
                                            bold
                                            currency={currency}
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
                                            <span className="text-sm font-bold text-blue-800">Total No-Efectivo (Banco)</span>
                                            <span className="font-black text-blue-700 text-lg">
                                                {formatCurrency(salesData.totalQrIn, currency)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Columna Derecha: Formulario de Arqueo */}
                        <ArqueoFisicoCard
                            cashStart={cashStart}
                            setCashStart={setCashStart}
                            cashCount={cashCount}
                            setCashCount={setCashCount}
                            notes={notes}
                            setNotes={setNotes}
                            existingId={existingId}
                            isEditing={isEditing}
                            todayOpening={todayOpening}
                            cashStartIsFromOpening={cashStartIsFromOpening}
                            totalCashExpected={totalCashExpected}
                            cashDifference={cashDifference}
                            isBalanced={isBalanced}
                            isManipulated={isManipulated}
                            currency={currency}
                            handleSave={handleSave}
                            handleEnableEdit={handleEnableEdit}
                            existing={existing}
                            showEditPill
                        />
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
                    El arqueo de caja del {new Date(date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })} ha sido guardado correctamente.
                </p>
                {isRetroMode && (
                    <button
                        onClick={returnToToday}
                        className="mt-4 px-5 py-2.5 bg-white text-green-700 font-black text-xs uppercase tracking-wider rounded-xl shadow hover:bg-green-50 transition"
                    >
                        ← Volver al Turno de Hoy
                    </button>
                )}
            </div>

            {/* Si aún quedan días pendientes, permitir continuar o regularizar todos desde aquí */}
            {pendingList.length > 0 && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div>
                        <p className="text-amber-900 font-bold text-sm">
                            ⚠️ Aún quedan {pendingList.length} día(s) anterior(es) sin cerrar
                        </p>
                        <p className="text-amber-700 text-xs">
                            Puedes cerrar el siguiente día pendiente o regularizar todos en un solo paso.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => selectPendingDay(pendingList[0])}
                            className="px-3.5 py-2 bg-white border border-amber-300 text-amber-900 font-bold text-xs rounded-xl hover:bg-amber-100 transition"
                        >
                            Siguiente día ({new Date(pendingList[0] + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })})
                        </button>
                        <button
                            onClick={() => setConfirmRegularizeModal(true)}
                            className="px-3.5 py-2 bg-amber-600 text-white font-black text-xs rounded-xl hover:bg-amber-700 transition"
                        >
                            ⚡ Regularizar todos ({pendingList.length})
                        </button>
                    </div>
                </div>
            )}

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
                            <p className="text-xs text-emerald-500">Reabre el turno para seguir vendiendo; harás un nuevo cierre al final</p>
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
                            <p className="text-xs text-orange-400">Solo edita los montos del arqueo; el turno sigue cerrado</p>
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
                    <span className={`text-[10px] font-black tracking-widest ${step === 1 ? 'text-pink-900' : 'text-green-600'}`}>ARQUEO</span>
                </div>
                <div className={`w-12 h-1 rounded-full ${step === 2 ? 'bg-green-500' : 'bg-gray-200'}`} />
                <div className="flex flex-col items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all shadow-md
                        ${step === 2 ? 'bg-pink-600 text-white ring-4 ring-pink-100 scale-110' : 'bg-gray-200 text-gray-400'}`}>
                        2
                    </div>
                    <span className={`text-[10px] font-black tracking-widest ${step === 2 ? 'text-pink-900' : 'text-gray-400'}`}>COMPLETADO</span>
                </div>
            </div>

            {/* Contenido Dinámico */}
            {step === 1 ? renderClosureForm() : renderStepSuccess()}

            {/* Modal de Confirmación de Regularización Masiva */}
            {confirmRegularizeModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-[fadeIn_0.2s_ease-out]">
                        <div className="bg-gradient-to-r from-red-600 to-rose-600 p-6 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                                    <CheckCircle size={26} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black uppercase tracking-tight">
                                        Regularizar {pendingList.length} día(s) pendientes
                                    </h3>
                                    <p className="text-red-100 text-xs mt-0.5">
                                        Cierre automático y auditado de días anteriores
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1.5 leading-relaxed">
                                <p className="font-bold">💡 ¿Por qué aparecen tantos días pendientes?</p>
                                <p>
                                    Cuando se cargan datos de prueba o se registran ventas en días pasados sin realizar el cierre de caja al final del turno, el sistema los marca como pendientes de regularización.
                                </p>
                            </div>
                            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-xs text-gray-700 space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-500 font-medium">Días a regularizar:</span>
                                    <span className="font-black text-gray-900">{pendingList.length} día(s)</span>
                                </div>
                                {pendingList.length > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500 font-medium">Rango de fechas:</span>
                                        <span className="font-bold text-gray-800">
                                            {new Date(pendingList[0] + 'T12:00:00').toLocaleDateString('es')} al {new Date(pendingList[pendingList.length - 1] + 'T12:00:00').toLocaleDateString('es')}
                                        </span>
                                    </div>
                                )}
                                <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-200">
                                    ✓ Se conservarán intactas todas las ventas, gastos y reportes.<br />
                                    ✓ Cada día quedará cerrado y cuadrado con sus montos reales en auditoría.
                                </p>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
                                <button
                                    onClick={() => setConfirmRegularizeModal(false)}
                                    disabled={regularizingAll}
                                    className="flex-1 h-12 rounded-xl border-2 border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleRegularizeAll}
                                    disabled={regularizingAll}
                                    className="flex-1 h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-black text-sm shadow-lg hover:shadow-emerald-200 transition flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <CheckCircle size={18} />
                                    {regularizingAll ? 'Regularizando...' : `Confirmar y Cerrar (${pendingList.length})`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal para abrir nuevo turno manualmente desde /cash */}
            {manualOpenModal && (
                <div className="relative z-50">
                    <CashOpenModal
                        onOpen={async (startVal, openNotes) => {
                            await openCash(startVal, openNotes);
                            setManualOpenModal(false);
                            showMsg('success', '✅ Caja abierta e inicio de turno registrado');
                        }}
                    />
                </div>
            )}
        </div>
    );
}

// ── Componentes Auxiliares ────────────────────────────────────────────

/**
 * Card de Arqueo Físico (Fondo de Inicio + Efectivo Contado + Observaciones +
 * Diferencia Dinámica + botón Guardar). Se usa tanto en la rama "turno sin
 * ventas" como en la rama normal de renderClosureForm; solo la rama normal
 * muestra el pill EDITAR/CORREGIR (showEditPill).
 */
function ArqueoFisicoCard({
    cashStart, setCashStart, cashCount, setCashCount, notes, setNotes,
    existingId, isEditing, todayOpening, cashStartIsFromOpening,
    totalCashExpected, cashDifference, isBalanced, isManipulated,
    currency, handleSave, handleEnableEdit, existing, showEditPill = false,
}) {
    const isLocked = !!existingId && !isEditing;

    const handleQuickFillExpected = () => {
        if (isLocked) return;
        if (cashStart === '' && !cashStartIsFromOpening) {
            setCashStart('0');
        }
        setCashCount(Math.max(0, totalCashExpected).toFixed(2));
    };

    return (
        <div className="space-y-4">
            <div className="fashion-card p-5 border-2 border-blue-100">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-blue-900 flex items-center gap-2">
                        <DollarSign size={18} className="text-blue-600" />
                        Arqueo Físico de Caja
                    </h3>
                    {showEditPill && existingId && !isEditing && (
                        <button
                            onClick={handleEnableEdit}
                            className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
                                existing?.closedAt
                                    ? 'text-orange-600 bg-orange-50 border-orange-100 hover:bg-orange-100'
                                    : 'text-pink-600 bg-pink-50 border-pink-100 hover:bg-pink-100'
                            }`}
                        >
                            {existing?.closedAt ? '✏️ CORREGIR' : 'EDITAR'}
                        </button>
                    )}
                </div>

                {/* Resumen siempre visible del efectivo esperado en caja */}
                <div className="mb-4 p-3.5 rounded-xl bg-blue-50/80 border border-blue-200/80 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">
                            Efectivo esperado en cajón
                        </p>
                        <p className="text-[11px] text-blue-500">
                            Fondo inicial + Ventas efectivo − Gastos
                        </p>
                    </div>
                    <span className="text-lg font-black text-blue-900">
                        {formatCurrency(totalCashExpected, currency)}
                    </span>
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
                            disabled={isLocked || (!!todayOpening && !existingId)}
                            className="w-full fashion-input h-10 font-bold"
                            placeholder="0.00"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-bold text-gray-500 uppercase">
                                Efectivo en Caja (Contado)
                            </label>
                            {!isLocked && (
                                <button
                                    type="button"
                                    onClick={handleQuickFillExpected}
                                    className="text-[11px] font-black text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200 transition"
                                >
                                    ⚡ Cuadrar exacto ({formatCurrency(totalCashExpected, currency)})
                                </button>
                            )}
                        </div>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={cashCount}
                            onChange={e => setCashCount(e.target.value)}
                            disabled={isLocked}
                            className="w-full fashion-input h-12 text-lg font-black border-2 focus:border-pink-500"
                            placeholder="Ingresa el monto físico contado..."
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Observaciones</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            disabled={isLocked}
                            className="w-full fashion-input h-16 resize-none text-sm"
                            placeholder="Notas opcionales..."
                        />
                    </div>
                </div>

                {/* Diferencia Dinámica */}
                {cashCount !== '' && (
                    <div className={`mt-4 p-3.5 rounded-xl border ${
                        isBalanced
                            ? 'bg-emerald-50 border-emerald-200'
                            : cashDifference > 0
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-red-50 border-red-200'
                    }`}>
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-gray-700">
                                {isBalanced ? '✅ Caja Cuadrada:' : cashDifference > 0 ? '➕ Sobrante en Caja:' : '⚠️ Faltante en Caja:'}
                            </span>
                            <span className={`text-base font-black ${
                                isBalanced ? 'text-emerald-700' :
                                cashDifference > 0 ? 'text-blue-700' : 'text-red-600'
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
    );
}

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
