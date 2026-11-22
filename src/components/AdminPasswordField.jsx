import React from 'react';
import { Lock } from 'lucide-react';

/**
 * Campo de contraseña de administrador para confirmar acciones destructivas.
 * La verificación la hace el padre (`confirmarContrasenaAdmin`); acá solo se captura.
 */
export default function AdminPasswordField({ id, value, onChange, error, disabled }) {
    return (
        <div className="text-left">
            <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-black text-red-800 uppercase tracking-widest mb-2">
                <Lock size={13} /> Contraseña de administrador
            </label>
            <input
                id={id}
                type="password"
                value={value}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                autoComplete="current-password"
                placeholder="Ingresa tu contraseña para confirmar"
                className="w-full border-2 border-red-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-400 bg-white"
            />
            {error && (
                <p role="alert" className="mt-2 text-xs font-bold text-red-600">{error}</p>
            )}
        </div>
    );
}
