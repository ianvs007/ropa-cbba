import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, syncClosureIfDateExists, getLocalISOString } from '../db';
import { 
    Plus, Trash2, Receipt, Calendar, Tag, Banknote, 
    AlertCircle, Filter, ArrowDownCircle, User, CheckCircle 
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { formatCurrency } from '../utils';
import useSecureDate from '../hooks/useSecureDate';
import useCashRegister from '../hooks/useCashRegister';
import { useUser } from '../contexts/UserContext';

/**
 * Módulo de Gastos — Control administrativo y contable
 * Permite registrar egresos de dinero vinculados al cierre de caja.
 */
export default function Expenses() {
    const { user } = useUser();
    // ── Seguridad de fecha ────────────────────
    const { today: frozenToday, isManipulated, logEvent } = useSecureDate();
    const { shiftId: activeShiftId } = useCashRegister();
    
    const [amount, setAmount] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [description, setDescription] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('efectivo');
    const [isBusy, setIsBusy] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const { msg, showMsg } = useNotification();

    // Datos de la DB
    const categories = useLiveQuery(() => db.expenseCategories.toArray(), []);
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    
    // Gastos recientes (últimos 30 días)
    const expenses = useLiveQuery(async () => {
        const data = await db.expenses.orderBy('date').reverse().limit(50).toArray();
        // Unir con nombres de categorías
        const cats = await db.expenseCategories.toArray();
        const scoped = (user?.role === 'admin')
            ? data
            : data.filter(e => {
                const uid = user?.id?.toString();
                const isOwnerById = e.userId !== undefined && e.userId !== null && e.userId.toString() === uid;
                const isOwnerByName = (e.registeredBy || '').toLowerCase() === ((user?.name || user?.username || '').toLowerCase());
                return isOwnerById || isOwnerByName;
            });

        return scoped.map(e => ({
            ...e,
            categoryName: cats.find(c => c.id === e.categoryId)?.name || 'Sin categoría'
        }));
    }, [user?.id, user?.role, user?.name, user?.username]);

    const filteredExpenses = (expenses || []).filter(e => 
        e.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.categoryName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(e.id || '').includes(searchTerm)
    );

    const handleSave = async (e) => {
        e.preventDefault();
        if (!amount || !categoryId || !description) return;

        const amountNum = parseFloat(amount);
        
        // ── VALIDACIÓN: Monto debe ser positivo ──
        if (isNaN(amountNum) || amountNum <= 0) {
            showMsg('error', 'El monto del gasto debe ser mayor a 0');
            return;
        }
        
        // ── SEGURIDAD: Solo permite registrar gastos de HOY (fecha congelada) ──
        const currentDate = getLocalISOString().slice(0, 10);
        if (frozenToday && currentDate !== frozenToday) {
            showMsg('error', `❌ Solo puedes registrar gastos de HOY (${frozenToday})`);
            await logEvent('EXPENSE_BLOCKED_WRONG_DATE', {
                attemptedDate: currentDate,
                frozenToday,
                userId: user?.username,
            }).catch(() => {});
            return;
        }

        // ── ALERTA: Si hay manipulación de fecha detectada ──
        if (isManipulated) {
            showMsg('warning', '⚠️ Manipulación de fecha del SO detectada. Registra con precaución.');
            await logEvent('EXPENSE_WITH_DETECTED_MANIPULATION', {
                expenseAmount: amountNum,
                frozenToday,
                userId: user?.username,
            }).catch(() => {});
        }

        setIsBusy(true);
        try {
            await db.expenses.add({
                amount: amountNum,
                categoryId: parseInt(categoryId),
                description: description.toUpperCase().trim(),
                paymentMethod,
                date: getLocalISOString(),
                registeredBy: user.username,
                userId: user.id,
                notes: '',
                shiftId: activeShiftId || undefined,
            });

            // ── Sincronizar cierre si existe ──
            await syncClosureIfDateExists(getLocalISOString().slice(0, 10), user?.id, activeShiftId);

            // Limpiar form
            setAmount('');
            setDescription('');
            setPaymentMethod('efectivo');
            showMsg('success', 'Gasto registrado correctamente');
        } catch (err) {
            showMsg('error', 'Error al registrar el gasto: ' + err.message);
        } finally {
            setIsBusy(false);
        }
    };

    const handleDelete = async (id) => {
        // Obtener el gasto a eliminar
        const expense = await db.expenses.get(id);
        if (!expense) return;

        // En rol vendedor, solo permitir eliminar gastos propios
        if (user?.role !== 'admin') {
            const uid = user?.id?.toString();
            const isOwnerById = expense.userId !== undefined && expense.userId !== null && expense.userId.toString() === uid;
            const isOwnerByName = (expense.registeredBy || '').toLowerCase() === ((user?.name || user?.username || '').toLowerCase());
            if (!isOwnerById && !isOwnerByName) {
                showMsg('error', 'No tienes permiso para eliminar este gasto');
                return;
            }
        }
        
        const expenseDate = expense.date?.slice(0, 10);
        
        // Verificar si hay cierre de caja para la fecha del gasto
        const closure = await db.cashClosures
            .where('date').equals(expenseDate)
            .filter(c => c.userId && c.userId.toString() === (expense.userId || user?.id || '').toString())
            .first();
        
        let confirmMsg = '¿Eliminar este registro de gasto?';
        if (closure) {
            confirmMsg = `⚠️ ADVERTENCIA: Existe un cierre de caja para el ${new Date(expenseDate).toLocaleDateString()}. 
Al eliminar este gasto, el cierre quedará descuadrado. ¿Estás seguro de continuar?`;
        } else if (expenseDate < frozenToday) {
            confirmMsg = `⚠️ ADVERTENCIA: Este gasto es de una fecha anterior (${new Date(expenseDate).toLocaleDateString()}). 
¿Estás seguro de eliminarlo?`;
        }
        
        if (!confirm(confirmMsg)) return;
        
        await db.expenses.delete(id);
        
        // ── Sincronizar cierre si existe (con userId y shiftId del gasto) ──
        await syncClosureIfDateExists(expenseDate, expense.userId || user?.id, expense.shiftId);

        showMsg('success', 'Gasto eliminado');
    };

    return (
        <div className="max-w-6xl mx-auto fade-in">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                        <Receipt size={24} className="text-pink-600" />
                        Control de Gastos
                    </h1>
                    <p className="text-pink-500 text-sm">Registra salidas de dinero administrativo</p>
                </div>
            </header>

            {/* Notificaciones */}
            {msg && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {msg.text}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* ══ FORMULARIO DE REGISTRO RÁPIDO ══ */}
                <div className="lg:col-span-1">
                    <div className="fashion-card p-5 sticky top-6 border-2 border-pink-100">
                        <h2 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                            <Plus size={18} className="text-pink-600" />
                            Nuevo Gasto
                        </h2>
                        
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-pink-700 mb-1 block uppercase">Monto ({currency}) *</label>
                                <input 
                                    type="number" step="0.01" required
                                    value={amount} onChange={e => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="fashion-input text-xl font-bold no-spinner"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-pink-700 mb-1 block uppercase">Categoría *</label>
                                <select 
                                    required value={categoryId} 
                                    onChange={e => setCategoryId(e.target.value)}
                                    className="fashion-input"
                                >
                                    <option value="">Seleccionar...</option>
                                    {categories?.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-pink-700 mb-1 block uppercase">Descripción / Glosa *</label>
                                <textarea 
                                    required rows={2}
                                    value={description} onChange={e => setDescription(e.target.value)}
                                    placeholder="Ej: PAGO DE LUZ MARZO, ALMUERZO PERSONAL..."
                                    className="fashion-input text-sm resize-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-pink-700 mb-2 block uppercase">Método de Pago *</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'efectivo', label: '💵 EFECTIVO', color: 'text-green-700' },
                                        { id: 'qr', label: '📱 PAGO QR', color: 'text-blue-700' }
                                    ].map(m => (
                                        <button 
                                            key={m.id} type="button"
                                            onClick={() => setPaymentMethod(m.id)}
                                            className={`py-2 px-1 rounded-xl text-[10px] font-bold border transition-all
                                                ${paymentMethod === m.id 
                                                    ? 'border-pink-500 bg-pink-50 shadow-sm scale-[1.02]' 
                                                    : 'border-pink-50 bg-white text-gray-400 opacity-60'}`}
                                        >
                                            <span className={paymentMethod === m.id ? m.color : ''}>{m.label}</span>
                                        </button>
                                    ))}
                                </div>
                                {paymentMethod === 'efectivo' && (
                                    <p className="text-[10px] text-orange-600 font-medium mt-1.5 flex items-center gap-1">
                                        <ArrowDownCircle size={10} /> Se descontará del arqueo de caja de hoy.
                                    </p>
                                )}
                            </div>

                            <button 
                                type="submit" disabled={isBusy}
                                className="btn-primary w-full py-3 flex items-center justify-center gap-2 shadow-lg shadow-pink-200"
                            >
                                {isBusy ? 'Guardando...' : <><Plus size={18} /> Registrar Gasto</>}
                            </button>
                        </form>
                    </div>
                </div>

                {/* ══ LISTADO DE GASTOS ══ */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="fashion-card p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
                        <div className="relative w-full sm:w-64">
                            <input 
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Buscar gastos..."
                                className="fashion-input py-1.5 text-sm"
                            />
                        </div>
                        <div className="flex items-center gap-2 text-xs font-semibold text-pink-400">
                            <Filter size={14} />
                            <span>Mostrando últimos 50 registros</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {filteredExpenses.length === 0 ? (
                            <div className="fashion-card p-10 text-center opacity-50">
                                <Receipt size={40} className="mx-auto mb-2 text-pink-200" />
                                <p className="text-pink-900 font-medium">No hay gastos registrados</p>
                                <p className="text-xs">Usa el formulario para empezar</p>
                            </div>
                        ) : (
                            filteredExpenses.map(exp => (
                                <div key={exp.id} className="fashion-card p-4 hover:shadow-md transition-shadow group relative overflow-hidden">
                                    {/* Indicador de método de pago lateral */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${exp.paymentMethod === 'qr' ? 'bg-blue-400' : 'bg-green-400'}`} />
                                    
                                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-bold bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full uppercase">
                                                    {exp.categoryName}
                                                </span>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase
                                                    ${exp.paymentMethod === 'qr' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                                                    {exp.paymentMethod === 'qr' ? 'QR' : 'Efectivo'}
                                                </span>
                                            </div>
                                            <p className="font-bold text-gray-900 leading-tight mb-2 uppercase">{exp.description}</p>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={12} className="text-pink-400" />
                                                    {new Date(exp.date).toLocaleString()}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <User size={12} className="text-pink-400" />
                                                    Por: {exp.registeredBy}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0">
                                            <p className="text-xl font-black text-pink-600">
                                                {formatCurrency(exp.amount, currency)}
                                            </p>
                                            <button 
                                                onClick={() => handleDelete(exp.id)}
                                                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                title="Eliminar gasto"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* NOTA DE AUDITORÍA */}
            <footer className="mt-8 flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4">
                <AlertCircle size={18} className="text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                    <b>Nota de Seguridad:</b> Los gastos registrados aquí son auditables. Cada transacción
                    guarda la identidad del usuario que la realizó. Los gastos en <b>Efectivo</b> afectan 
                    automáticamente el flujo de caja diario en el módulo de Cierre de Caja.
                </p>
            </footer>
        </div>
    );
}
