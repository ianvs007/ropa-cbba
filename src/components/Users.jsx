import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Users as UsersIcon, User, Plus, Edit2, Trash2, X, CheckCircle, Shield, Eye, EyeOff } from 'lucide-react';
import { hashPassword } from '../utils/crypto';
import { useUser } from '../contexts/UserContext';
import { PERMISSIONS, PERMISSION_LABELS } from '../utils/permissions';

/**
 * Users — Gestión de usuarios del sistema (Admin / Vendedor)
 */
export default function Users() {
    const { user: loggedUser } = useUser();
    const users = useLiveQuery(() => db.users.toArray(), []);
    const [showForm, setShowForm] = React.useState(false);
    const [editing, setEditing] = React.useState(null);
    const [form, setForm] = React.useState({ username: '', name: '', password: '', role: 'seller', active: true, permissions: {} });
    const [msg, setMsg] = React.useState(null);
    const [delId, setDelId] = React.useState(null);
    const [showPass, setShowPass] = React.useState(false);
    const [formBusy, setFormBusy] = React.useState(false);

    const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000); };

    const openEdit = (u) => {
        setForm({ username: u.username || '', name: u.name || '', password: '', role: u.role || 'seller', active: u.active !== false, permissions: u.permissions || {} });
        setEditing(u.id);
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false); setEditing(null);
        setForm({ username: '', name: '', password: '', role: 'seller', active: true, permissions: {} });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.username.trim()) { showMsg('error', 'Usuario es obligatorio'); return; }
        if (form.username.trim().length < 3) { showMsg('error', 'El usuario debe tener al menos 3 caracteres'); return; }
        if (!editing && !form.password) { showMsg('error', 'Contraseña es obligatoria'); return; }
        if (form.password && form.password.length < 6) { showMsg('error', 'La contraseña debe tener al menos 6 caracteres'); return; }

        // Verificar usuario único
        const existing = await db.users.where('username').equals(form.username.trim().toLowerCase()).first();
        if (existing && existing.id !== editing) { showMsg('error', 'El nombre de usuario ya existe'); return; }

        const data = {
            username: form.username.trim().toLowerCase(),
            name: form.name.trim().toUpperCase(),
            role: form.role,
            active: form.active,
            // Permisos granulares: solo aplican a admins secundarios; para sellers
            // se guarda {} (hasPermission devuelve false para no-admin igualmente).
            permissions: form.role === 'admin' ? (form.permissions || {}) : {},
        };
        if (form.password) data.password = await hashPassword(form.password);

        setFormBusy(true);
        try {
            if (editing) {
                await db.users.update(editing, data);
                showMsg('success', 'Usuario actualizado');
            } else {
                await db.users.add(data);
                showMsg('success', 'Usuario creado');
            }
            closeForm();
        } catch (err) {
            console.error(err);
            showMsg('error', 'Error al guardar el usuario');
        } finally {
            setFormBusy(false);
        }
    };

    // ════ FORMULARIO USUARIO (PANTALLA COMPLETA REAL - EARLY RETURN) ════
    if (showForm) {
        return (
            <div className="max-w-4xl mx-auto fade-in pb-72">
                {/* Header */}
                <div className="flex items-center justify-between mb-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-pink-100 rounded-2xl text-pink-600">
                            <Shield size={24} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-pink-900 uppercase tracking-tight">
                                {editing ? 'Editar Perfil' : 'Nuevo Miembro'}
                            </h2>
                            <p className="text-pink-400 font-bold text-sm tracking-widest uppercase">SEGURIDAD Y ACCESO</p>
                        </div>
                    </div>
                    <button onClick={closeForm}
                        className="w-12 h-12 bg-pink-50 text-pink-400 rounded-2xl flex items-center justify-center hover:bg-pink-100 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {msg && (
                    <div role="alert" className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                        ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                        {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />} {msg.text}
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-8">
                    <div className="fashion-card p-8 space-y-6 border-2 border-pink-100/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-pink-800 uppercase tracking-widest flex items-center gap-2">
                                    <User size={12} className="text-pink-400" /> Nombre de Exhibición *
                                </label>
                                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                    placeholder="EJ: MARÍA LÓPEZ" className="fashion-input" required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-pink-800 uppercase tracking-widest flex items-center gap-2">
                                    <UsersIcon size={12} className="text-pink-400" /> ID Usuario / Login *
                                </label>
                                <input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value.toLowerCase() }))}
                                    placeholder="EJ: MARIAL" className="fashion-input font-mono" required />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-pink-800 uppercase tracking-widest flex items-center gap-2">
                                <Shield size={12} className="text-pink-400" /> Contraseña
                                {editing && <span className="text-[8px] text-pink-300 ml-1 font-bold">(DEJAR VACÍO PARA MANTENER)</span>}
                            </label>
                            <div className="relative">
                                <input type={showPass ? 'text' : 'password'}
                                    value={form.password}
                                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                                    placeholder="••••••••" className="fashion-input pr-12 text-xl tracking-[0.2em]"
                                    required={!editing} />
                                <button type="button" onClick={() => setShowPass(p => !p)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-pink-400 hover:text-pink-600 p-2">
                                    {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-pink-800 uppercase tracking-widest">Nivel de Acceso</label>
                                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                                    className="fashion-input appearance-none bg-no-repeat bg-[right_1rem_center]">
                                    <option value="seller">🛍️ Vendedor Especializado</option>
                                    <option value="admin">👑 Administrador Central</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-4 pt-4">
                                <div className="flex items-center gap-3 cursor-pointer select-none"
                                    onClick={() => setForm(p => ({ ...p, active: !p.active }))}>
                                    <div className={`w-12 h-6 rounded-full transition-all relative ${form.active ? 'bg-pink-600' : 'bg-gray-200'}`}>
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form.active ? 'left-7' : 'left-1'}`} />
                                    </div>
                                    <span className="text-[10px] font-black text-pink-800 uppercase tracking-widest">Estado Activo</span>
                                </div>
                            </div>
                        </div>

                        {/* ── Permisos granulares: solo el admin principal, sobre un admin
                            secundario (nunca sobre el propio 'admin') ── */}
                        {loggedUser?.username === 'admin'
                            && form.role === 'admin'
                            && form.username.trim().toLowerCase() !== 'admin' && (
                            <div className="space-y-3 pt-6 border-t-2 border-pink-100/50">
                                <label className="text-[10px] font-black text-pink-800 uppercase tracking-widest flex items-center gap-2">
                                    <Shield size={12} className="text-pink-400" /> Permisos de Administrador
                                </label>
                                <p className="text-[10px] text-pink-400 font-bold tracking-wide">
                                    Por defecto sin acceso. Tilda lo que este administrador podrá hacer.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                                        <label key={key}
                                            className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-pink-100 cursor-pointer hover:bg-pink-50/50 transition-colors">
                                            <input type="checkbox"
                                                checked={!!form.permissions?.[key]}
                                                onChange={e => setForm(p => ({ ...p, permissions: { ...p.permissions, [key]: e.target.checked } }))}
                                                className="w-4 h-4 accent-pink-600 shrink-0" />
                                            <span className="text-xs font-bold text-pink-700">{label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer Flotante Acciones */}
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-6 z-50">
                        <div className="bg-white border-2 border-pink-100 p-4 rounded-[2.5rem] shadow-2xl flex gap-4">
                            <button type="button" onClick={closeForm}
                                className="px-8 py-5 border-2 border-pink-100 text-pink-400 font-black rounded-3xl text-xs uppercase tracking-widest">
                                Cancelar
                            </button>
                            <button type="submit" disabled={formBusy}
                                className="flex-1 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-black py-5 rounded-3xl text-sm shadow-xl uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                                {formBusy ? 'Guardando...' : (editing ? 'Actualizar Perfil ✓' : 'Crear Usuario ✓')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto fade-in">
            <div className="flex items-center justify-between mb-5">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <UsersIcon size={24} strokeWidth={1.8} className="text-pink-600" />
                    Gestión de Usuarios
                </h1>
                <button id="user-new" onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
                    <Plus size={18} /> Nuevo Usuario
                </button>
            </div>

            {msg && (
                <div role="alert" className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium fade-in
                    ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />} {msg.text}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(users || []).map(u => (
                    <div key={u.id} className={`fashion-card p-5 ${!u.active ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between mb-3">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-white text-lg"
                                style={{
                                    background: u.role === 'admin'
                                        ? 'linear-gradient(135deg, #D946A8, #A3308A)'
                                        : 'linear-gradient(135deg, #2563EB, #1D4ED8)'
                                }}>
                                {(u.name || u.username || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => openEdit(u)}
                                    aria-label="Editar usuario"
                                    className="text-pink-500 hover:text-pink-700 transition-colors">
                                    <Edit2 size={15} />
                                </button>
                                {(users || []).length > 1 && (
                                    <button onClick={() => setDelId(u.id)}
                                        aria-label="Eliminar usuario"
                                        className="text-red-400 hover:text-red-600 transition-colors">
                                        <Trash2 size={15} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <p className="font-bold text-pink-900">{u.name || u.username}</p>
                        <p className="text-sm text-pink-500 font-mono">@{u.username}</p>
                        <div className="flex items-center gap-2 mt-2">
                            <span className={u.role === 'admin' ? 'badge-rose' : 'badge-blue'}>
                                {u.role === 'admin' ? '👑 Admin' : '🛍️ Vendedor'}
                            </span>
                            <span className={u.active !== false ? 'badge-green' : 'badge-red'}>
                                {u.active !== false ? 'Activo' : 'Inactivo'}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* ════ VISTA CONFIRMACIÓN ELIMINACIÓN (PANTALLA COMPLETA) ════ */}
            {delId && (
                <div className="fixed inset-0 z-[100] bg-pink-900/40 backdrop-blur-md flex items-center justify-center p-6 fade-in">
                    <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-md text-center border-2 border-pink-100">
                        <div className="w-20 h-20 mx-auto bg-red-100 text-red-600 rounded-3xl flex items-center justify-center mb-6">
                            <Trash2 size={40} />
                        </div>
                        <h3 className="text-2xl font-black text-pink-950 uppercase tracking-tight mb-2">¿Eliminar Usuario?</h3>
                        <p className="text-pink-400 font-bold text-sm mb-8 leading-relaxed px-4 text-balance">
                            Esta acción revocará permanentemente todos los accesos del usuario al sistema.
                        </p>
                        <div className="space-y-3">
                            <button onClick={async () => { await db.users.delete(delId); setDelId(null); showMsg('success', 'Usuario eliminado'); }}
                                className="w-full bg-red-600 text-white py-5 rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-xl hover:bg-red-700 transition-all">
                                SÍ, ELIMINAR AHORA
                            </button>
                            <button onClick={() => setDelId(null)} 
                                className="w-full py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs text-pink-300 hover:text-pink-500 transition-colors">
                                NO, MANTENER USUARIO
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
