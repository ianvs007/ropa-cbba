import React from 'react';
import { DollarSign, Unlock, AlertTriangle } from 'lucide-react';
import { getLocalISOString } from '../db';
import { useUser } from '../contexts/UserContext';

/**
 * 💰 CashOpenModal — Modal obligatorio de apertura de caja
 * Se muestra bloqueando la pantalla hasta que el vendedor registre el fondo de inicio.
 */
export default function CashOpenModal({ onOpen }) {
    const { user } = useUser();
    const [cashStart, setCashStart] = React.useState('');
    const [notes, setNotes] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');

    const today = getLocalISOString().slice(0, 10);
    const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('es', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const handleSubmit = async () => {
        const amount = parseFloat(cashStart);
        if (isNaN(amount) || amount < 0) {
            setError('Ingresa un monto válido (puede ser 0.00)');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onOpen(cashStart, notes);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-6 text-white text-center">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Unlock size={32} />
                    </div>
                    <h2 className="text-xl font-bold">Apertura de Caja</h2>
                    <p className="text-emerald-100 text-sm mt-1">{dateLabel}</p>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5">
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
                        <p className="text-blue-700 text-sm font-medium">
                            👋 Bienvenido/a <span className="font-bold">{user?.name || user?.username}</span>
                        </p>
                        <p className="text-blue-500 text-xs mt-1">
                            Registra el efectivo con el que inicias tu turno para comenzar a vender.
                        </p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">
                            Efectivo Inicial (Fondo de Caja)
                        </label>
                        <div className="relative">
                            <DollarSign size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                            <input
                                type="text"
                                inputMode="decimal"
                                value={cashStart}
                                onChange={e => setCashStart(e.target.value)}
                                className="w-full h-14 pl-10 pr-4 text-2xl font-black border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition"
                                placeholder="0.00"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                            />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                            Si no hay fondo inicial, ingresa 0
                        </p>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">
                            Observaciones (opcional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="w-full h-16 px-4 py-2 text-sm border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none resize-none transition"
                            placeholder="Notas opcionales..."
                        />
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className={`w-full h-14 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition shadow-lg
                            ${saving
                                ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                                : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:shadow-emerald-200'
                            }`}
                    >
                        <Unlock size={22} />
                        {saving ? 'Abriendo...' : 'Abrir Caja e Iniciar Turno'}
                    </button>
                </div>
            </div>
        </div>
    );
}
