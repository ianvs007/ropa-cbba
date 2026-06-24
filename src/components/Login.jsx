import React from 'react';
import { db } from '../db';
import { ShoppingBag, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { verifyPassword } from '../utils/crypto';
import { useUser } from '../contexts/UserContext';

/**
 * Login — Pantalla de inicio de sesión
 * Verifica usuario y contraseña contra la tabla `users` de Dexie.
 */
export default function Login() {
    const { login } = useUser();
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [showPass, setShowPass] = React.useState(false);
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const user = await db.users
                .where('username').equals(username.trim().toLowerCase())
                .first();

            const passwordValid = user ? await verifyPassword(password, user.password) : false;
            if (!user || !passwordValid || user.active === false) {
                setError('Usuario o contraseña incorrectos');
                setLoading(false);
                return;
            }
            login({ id: user.id, username: user.username, name: user.name, role: user.role });
        } catch (err) {
            setError('Error de conexión con la base de datos');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #1A0A14 0%, #4A1A38 50%, #1A0A14 100%)' }}>

            {/* Fondo decorativo */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
                    style={{ background: 'radial-gradient(circle, #D946A8, transparent)' }} />
                <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full opacity-10"
                    style={{ background: 'radial-gradient(circle, #C9963B, transparent)' }} />
            </div>

            <div className="relative w-full max-w-md mx-4">
                {/* Card */}
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-2xl">

                    {/* Logo */}
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
                            style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                            <ShoppingBag size={36} className="text-white" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-2xl font-bold text-white">Sistema de Ventas</h1>
                        <p className="text-pink-300 text-sm mt-1">Tienda de Ropa</p>
                    </div>

                    {/* Formulario */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-pink-200 text-sm font-medium mb-1.5">Usuario</label>
                            <input
                                id="login-username"
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="Ingresa tu usuario"
                                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
                                           text-white placeholder-white/40 focus:outline-none
                                           focus:ring-2 focus:ring-pink-400 focus:border-pink-400 transition-all"
                                autoComplete="username"
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-pink-200 text-sm font-medium mb-1.5">Contraseña</label>
                            <div className="relative">
                                <input
                                    id="login-password"
                                    type={showPass ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12
                                               text-white placeholder-white/40 focus:outline-none
                                               focus:ring-2 focus:ring-pink-400 focus:border-pink-400 transition-all"
                                    autoComplete="current-password"
                                />
                                <button type="button" onClick={() => setShowPass(p => !p)}
                                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white">
                                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div role="alert" className="flex items-center gap-2 bg-red-500/20 border border-red-400/30 rounded-xl px-4 py-3">
                                <AlertCircle size={16} className="text-red-300 shrink-0" />
                                <span className="text-red-200 text-sm">{error}</span>
                            </div>
                        )}

                        <button
                            id="login-submit"
                            type="submit"
                            disabled={loading || !username || !password}
                            className="w-full py-3 rounded-xl font-bold text-white transition-all active:scale-95
                                       disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                            style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                            {loading ? 'Verificando...' : 'Ingresar'}
                        </button>
                    </form>

                    <p className="text-white/30 text-xs text-center mt-6">
                        Sistema de gestión de tienda de ropa • v1.0
                    </p>
                </div>
            </div>
        </div>
    );
}
