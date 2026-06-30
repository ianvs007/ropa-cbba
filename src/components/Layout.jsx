import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    ShoppingBag, LayoutDashboard, ShoppingCart, ClipboardList,
    Package, Users, Settings, Database, LogOut, Menu, X,
    History, Boxes, DollarSign, Tag, ListTree, Receipt, Truck,
    Calendar, AlertTriangle
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalISOString } from '../db';
import useCashRegister from '../hooks/useCashRegister';
import CashOpenModal from './CashOpenModal';
import { useUser } from '../contexts/UserContext';
import { hasPermission, PERMISSIONS } from '../utils/permissions';

/** Definición de navegación por rol.
 *  Los items con `perm` solo se muestran si el usuario tiene ese permiso
 *  (el admin principal pasa siempre por hasPermission). Items sin `perm`
 *  son visibles para todo admin. */
const NAV_ADMIN = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Reporte Mensual', path: '/monthly-report', icon: Calendar },
    { label: 'Historial de ventas y gastos', path: '/sales', icon: ClipboardList },
    { label: 'Productos', path: '/products', icon: Package, perm: PERMISSIONS.EDIT_PRODUCTS },
    { label: 'Catálogo Base', path: '/product-options', icon: ListTree, perm: PERMISSIONS.EDIT_PRODUCTS },
    { label: 'Etiquetado Masivo', path: '/mass-labeling', icon: Tag, perm: PERMISSIONS.EDIT_PRODUCTS },
    { label: 'Inventario', path: '/inventory', icon: Boxes },
    { label: 'Movimientos', path: '/kardex', icon: History },
    { label: 'Usuarios', path: '/users', icon: Users, perm: PERMISSIONS.MANAGE_USERS },
    { label: 'Gastos', path: '/expenses', icon: Receipt },
    { label: 'Configuración', path: '/settings', icon: Settings, perm: PERMISSIONS.SETTINGS },
    { label: 'Backup', path: '/backup', icon: Database, perm: PERMISSIONS.BACKUP },
];

const NAV_SELLER = [
    { label: 'Punto de Venta', path: '/pos', icon: ShoppingCart },
    { label: 'Reservas', path: '/reservations', icon: Tag },
    { label: 'Historial de ventas y gastos', path: '/sales', icon: ClipboardList },
    { label: 'Gastos', path: '/expenses', icon: Receipt },
    { label: 'Cierre de Caja', path: '/cash', icon: DollarSign },
];

export default function Layout({ children }) {
    const { user, logout } = useUser();
    const [sidebarOpen, setSidebarOpen] = React.useState(false);
    const location = useLocation();

    // ── Detector de Turnos Pendientes de Cierre ──
    const pendingClosures = useLiveQuery(async () => {
        if (!user?.id) return [];
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const iso = thirtyDaysAgo.toISOString().slice(0, 10);
            const today = getLocalISOString().slice(0, 10);

            const openings = await db.table('cashOpenings')
                .where('date').aboveOrEqual(iso)
                .filter(o => o.userId === user.id)
                .toArray();

            const closures = await db.table('cashClosures')
                .where('date').aboveOrEqual(iso)
                .filter(c => c.userId === user.id && !!c.closedAt)
                .toArray();

            const closedOpeningIds = new Set(closures.map(c => c.openingId).filter(Boolean));

            return openings
                .filter(o => !closedOpeningIds.has(o.id) && o.date < today)
                .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
        } catch (e) {
            console.error('Error detectando pendientes:', e);
            return [];
        }
    }, [user?.id]) || [];

    const hasPendingClosures = pendingClosures.length > 0;
    const navigate = useNavigate();

    // ── Apertura de caja obligatoria para vendedores ──
    const { isOpen: cashIsOpen, isClosed: cashIsClosed, openCash, isLoading: cashLoading } = useCashRegister();
    const needsCashOpen = user.role !== 'admin' && !cashIsOpen && !cashIsClosed && !cashLoading;

    // ── Modal obligatorio: mostrar solo una vez por sesión ──
    const [pendingModalDismissed, setPendingModalDismissed] = React.useState(false);
    const showPendingModal = hasPendingClosures && !pendingModalDismissed && user.role !== 'admin' && location.pathname !== '/cash';

    // Prioridad de modales: 1) Cierres pendientes, 2) Apertura de caja
    const showCashOpenModal = needsCashOpen && !showPendingModal;

    // Items con `perm` se filtran por permiso; los sin `perm` siempre se muestran.
    // El admin principal ve todo (hasPermission devuelve true para username 'admin').
    const nav = (user.role === 'admin' ? NAV_ADMIN : NAV_SELLER)
        .filter(item => !item.perm || hasPermission(user, item.perm));

    return (
        <div className="flex h-screen overflow-hidden" style={{ background: 'var(--cream)' }}>

            {/* ── Overlay móvil ── */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/50 z-20 lg:hidden"
                    onClick={() => setSidebarOpen(false)} />
            )}

            {/* ══════════════════ SIDEBAR ══════════════════
                w-52 en laptop HD (1280px), w-56 en pantallas grandes, w-64 en full HD+
            */}
            <aside className={`
                fixed lg:static inset-y-0 left-0 z-30
                w-56 xl:w-60 2xl:w-64
                flex flex-col h-full shrink-0
                transition-transform duration-300 ease-in-out
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}
                style={{ background: 'linear-gradient(180deg, #1A0A14 0%, #2D1525 100%)' }}>

                {/* Logo */}
                <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10 shrink-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: 'linear-gradient(135deg, #D946A8, #A3308A)' }}>
                        <ShoppingBag size={18} className="text-white" strokeWidth={1.5} />
                    </div>
                    <div className="overflow-hidden">
                        <p className="text-white font-bold text-sm leading-tight truncate">Tienda de Ropa</p>
                        <p className="text-pink-400 text-xs truncate">Sistema de Ventas</p>
                    </div>
                    <button onClick={() => setSidebarOpen(false)}
                        className="ml-auto text-white/40 hover:text-white lg:hidden">
                        <X size={18} />
                    </button>
                </div>

                {/* Usuario */}
                <div className="px-3 py-2.5 mx-2.5 mt-2.5 rounded-xl border border-white/10 shrink-0"
                    style={{ background: 'rgba(217,70,168,0.15)' }}>
                    <p className="text-white font-semibold text-sm truncate">{user.name || user.username}</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                        ${user.role === 'admin' ? 'bg-pink-500/30 text-pink-300' : 'bg-blue-500/30 text-blue-300'}`}>
                        {user.role === 'admin' ? 'Administrador' : 'Vendedor'}
                    </span>
                </div>

                {/* Navegación */}
                <nav role="navigation" aria-label="Menú principal" className="flex-1 overflow-y-auto py-2.5 scrollbar-thin px-2.5 space-y-0.5">
                    {nav.map(({ label, path, icon: Icon, badge }) => (
                        <NavLink key={path} to={path}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                                `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all
                                ${isActive
                                    ? 'sidebar-active text-white'
                                    : 'text-white/60 hover:text-white hover:bg-white/10'}`
                            }>
                            <Icon size={16} strokeWidth={1.8} />
                            {label}
                            {badge && (
                                <span className="ml-auto bg-green-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                                    {badge}
                                </span>
                            )}
                            {label === 'Cierre de Caja' && hasPendingClosures && (
                                <span className="ml-auto bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                                    {pendingClosures.length}
                                </span>
                            )}
                        </NavLink>
                    ))}
                </nav>

                {/* Logout */}
                <div className="p-2.5 border-t border-white/10 shrink-0">
                    <button onClick={logout}
                        aria-label="Cerrar sesión"
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl
                                       text-white/60 hover:text-white hover:bg-red-500/20
                                       transition-all text-sm font-medium">
                        <LogOut size={16} strokeWidth={1.8} />
                        Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* ══════════════════ MAIN CONTENT ══════════════════ */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">

                {/* Top bar móvil */}
                <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-pink-100
                                   shadow-sm lg:hidden shrink-0">
                    <button onClick={() => setSidebarOpen(true)}
                        className="text-pink-600 hover:text-pink-800">
                        <Menu size={22} />
                    </button>
                    <p className="font-bold text-pink-800 text-sm truncate">Tienda de Ropa</p>
                </header>

                {/* Contenido — padding adaptativo por resolución */}
                <main className="flex-1 overflow-y-auto scrollbar-thin p-3 md:p-4 xl:p-5 2xl:p-6">
                    {children}
                </main>
            </div>

            {/* ══════════════════ MODAL CIERRES PENDIENTES ══════════════════ */}
            {showPendingModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-[fadeIn_0.3s_ease-out]">
                        {/* Header */}
                        <div role="alert" className="bg-gradient-to-r from-red-500 to-red-600 p-6 text-white text-center">
                            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                <AlertTriangle size={32} />
                            </div>
                            <h2 className="text-xl font-bold">Turnos Sin Cerrar</h2>
                            <p className="text-red-100 text-sm mt-1">
                                Tienes {pendingClosures.length} turno(s) sin cierre de caja
                            </p>
                        </div>
                        {/* Body */}
                        <div className="p-6 space-y-4">
                            <p className="text-gray-600 text-sm text-center">
                                Para mantener el control financiero, debes completar los cierres pendientes antes de continuar.
                            </p>
                            <div className="space-y-2">
                                {pendingClosures.slice(0, 5).map(shift => (
                                    <div key={shift.id} className="flex items-center justify-between bg-red-50 rounded-xl px-4 py-3 border border-red-100">
                                        <span className="text-sm font-bold text-red-800">
                                            📅 {new Date(shift.date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
                                            {' • '}
                                            {new Date(shift.openedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className="text-[10px] font-bold text-red-500 uppercase">Pendiente</span>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => {
                                    setPendingModalDismissed(true);
                                    navigate('/cash');
                                }}
                                className="w-full h-12 bg-gradient-to-r from-red-500 to-red-600 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-red-200 transition flex items-center justify-center gap-2"
                            >
                                <DollarSign size={18} />
                                Ir a Cerrar Caja Ahora
                            </button>
                            <button
                                onClick={() => setPendingModalDismissed(true)}
                                className="w-full h-10 text-gray-400 text-sm font-medium hover:text-gray-600 transition"
                            >
                                Recordarme después
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════════════ MODAL APERTURA DE CAJA ══════════════════ */}
            {showCashOpenModal && (
                <CashOpenModal onOpen={openCash} />
            )}
        </div>
    );
}
