import React from 'react';
import { KeyRound, AlertCircle } from 'lucide-react';
import { db } from '../db';
import { hashPassword } from '../utils/crypto';
import { validarNuevaContrasena, LARGO_MINIMO_CONTRASENA } from '../utils/passwordPolicy';

/**
 * Cambio de contraseña OBLIGATORIO en el primer ingreso (credenciales iniciales o
 * marcadas con `mustChangePassword`). El usuario no entra al sistema hasta completarlo.
 */
export default function ForcePasswordChange({ user, actual, onDone, onCancel }) {
    const [nueva, setNueva] = React.useState('');
    const [confirmacion, setConfirmacion] = React.useState('');
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const validacion = validarNuevaContrasena({ actual, nueva, confirmacion, username: user.username });
        if (!validacion.ok) {
            setError(validacion.error);
            return;
        }
        setError('');
        setLoading(true);
        try {
            await db.users.update(user.id, {
                password: await hashPassword(nueva),
                mustChangePassword: false,
            });
            onDone();
        } catch {
            setError('No se pudo guardar la nueva contraseña');
            setLoading(false);
        }
    };

    const inputClass = `w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
        text-white placeholder-white/40 focus:outline-none
        focus:ring-2 focus:ring-pink-400 focus:border-pink-400 transition-all`;

    return (
        <div className="min-h-screen flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #1A0A14 0%, #4A1A38 50%, #1A0A14 100%)' }}>
            <div className="relative w-full max-w-md mx-4">
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-2xl">
                    <div className="flex flex-col items-center mb-6">
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
                            style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                            <KeyRound size={30} className="text-white" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-xl font-bold text-white text-center">Elige una contraseña nueva</h1>
                        <p className="text-pink-300 text-sm mt-2 text-center">
                            Hola {user.name || user.username}: por seguridad debes cambiar la contraseña inicial
                            antes de usar el sistema.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-pink-200 text-sm font-medium mb-1.5">Nueva contraseña</label>
                            <input
                                id="cambio-password-nueva"
                                type="password"
                                value={nueva}
                                onChange={e => setNueva(e.target.value)}
                                placeholder={`Mínimo ${LARGO_MINIMO_CONTRASENA} caracteres`}
                                className={inputClass}
                                autoComplete="new-password"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-pink-200 text-sm font-medium mb-1.5">Repite la contraseña</label>
                            <input
                                id="cambio-password-confirmar"
                                type="password"
                                value={confirmacion}
                                onChange={e => setConfirmacion(e.target.value)}
                                className={inputClass}
                                autoComplete="new-password"
                            />
                        </div>

                        {error && (
                            <div role="alert" className="flex items-center gap-2 bg-red-500/20 border border-red-400/30 rounded-xl px-4 py-3">
                                <AlertCircle size={16} className="text-red-300 shrink-0" />
                                <span className="text-red-200 text-sm">{error}</span>
                            </div>
                        )}

                        <button
                            id="cambio-password-guardar"
                            type="submit"
                            disabled={loading || !nueva || !confirmacion}
                            className="w-full py-3 rounded-xl font-bold text-white transition-all active:scale-95
                                       disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                            style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                            {loading ? 'Guardando...' : 'Guardar y entrar'}
                        </button>
                        <button type="button" onClick={onCancel}
                            className="w-full py-2 text-sm text-white/60 hover:text-white">
                            Cancelar
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
