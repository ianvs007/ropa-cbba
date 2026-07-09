import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalISOString } from '../../db';
import {
    TrendingUp, ShoppingBag, Package, AlertTriangle,
    DollarSign, BarChart2, Award,
    Receipt
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';

const COLORS = ['#D946A8', '#A3308A', '#C9963B', '#2563EB', '#16A34A', '#EA580C'];

/**
 * Dashboard — Resumen ejecutivo con KPIs y gráficos de ventas
 */
export default function Dashboard() {
    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const lowStock = parseInt(settings?.find(s => s.key === 'lowStockAlert')?.value || '5');

    const sales = useLiveQuery(() => db.sales.toArray(), []);
    const products = useLiveQuery(() => db.products.toArray(), []);
    const resPayments = useLiveQuery(() => db.reservationPayments.toArray(), []);
    const expenses = useLiveQuery(() => db.expenses.toArray(), []);
    const reservations = useLiveQuery(() => db.reservations.toArray(), []);

    // ── KPIs ──
    const today = getLocalISOString().slice(0, 10);
    const thisMonth = getLocalISOString().slice(0, 7);

    const activeSales = (sales || []).filter(s => s.status !== 'annulled');
    const salesToday = activeSales.filter(s => s.date?.startsWith(today));
    const salesMonth = activeSales.filter(s => s.date?.startsWith(thisMonth));
    const activeResIds = new Set((reservations || []).filter(r => r.status !== 'cancelled' && r.status !== 'annulled').map(r => r.id));
    const resPaymentsToday = (resPayments || []).filter(p => p.date?.startsWith(today) && p.status !== 'annulled' && activeResIds.has(p.reservationId));
    const resPaymentsMonth = (resPayments || []).filter(p => p.date?.startsWith(thisMonth) && p.status !== 'annulled' && activeResIds.has(p.reservationId));

    // Ingresos = Ventas (no reserva) + Abonos de reserva
    const revenueToday = salesToday.filter(s => s.paymentMethod !== 'reserva').reduce((s, v) => s + (v.total || 0), 0) +
                         resPaymentsToday.reduce((s, v) => s + (v.amount || 0), 0);
    const revenueMonth = salesMonth.filter(s => s.paymentMethod !== 'reserva').reduce((s, v) => s + (v.total || 0), 0) +
                         resPaymentsMonth.reduce((s, v) => s + (v.amount || 0), 0);

    const expensesToday = (expenses || []).filter(e => e.date?.startsWith(today))
                          .reduce((s, v) => s + (v.amount || 0), 0);
    const expensesMonth = (expenses || []).filter(e => e.date?.startsWith(thisMonth))
                          .reduce((s, v) => s + (v.amount || 0), 0);
    const netProfit = revenueMonth - expensesMonth;

    const lowStockProds = (products || []).filter(p => p.stock > 0 && p.stock <= lowStock);
    const outStock = (products || []).filter(p => p.stock <= 0);

    // ── Ventas últimos 7 días ──
    const last7 = React.useMemo(() => {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const label = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
            const totalSales = activeSales.filter(s => s.date?.startsWith(key) && s.paymentMethod !== 'reserva').reduce((s, v) => s + (v.total || 0), 0);
            const totalRes = (resPayments || []).filter(p => p.date?.startsWith(key) && p.status !== 'annulled' && activeResIds.has(p.reservationId)).reduce((s, v) => s + (v.amount || 0), 0);
            days.push({ label, total: totalSales + totalRes });
        }
        return days;
    }, [sales, resPayments]);
    
    // ── Ventas últimos 6 meses ──
    const last6Months = React.useMemo(() => {
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setDate(1); // Evitar saltos si hoy es 31
            d.setMonth(d.getMonth() - i);
            const monthKey = d.toISOString().slice(0, 7); // YYYY-MM
            const label = d.toLocaleDateString('es', { month: 'short', year: '2-digit' }).toUpperCase();
            
            const totalSales = activeSales.filter(s => s.date?.startsWith(monthKey) && s.paymentMethod !== 'reserva').reduce((s, v) => s + (v.total || 0), 0);
            const totalRes = (resPayments || []).filter(p => p.date?.startsWith(monthKey) && p.status !== 'annulled' && activeResIds.has(p.reservationId)).reduce((s, v) => s + (v.amount || 0), 0);
            const totalExp = (expenses || []).filter(e => e.date?.startsWith(monthKey)).reduce((s, v) => s + (v.amount || 0), 0);
            
            const income = totalSales + totalRes;
            const net = income - totalExp;
            
            months.push({ label, total: income, net, expenses: totalExp });
        }
        return months;
    }, [sales, resPayments, expenses]);

    // ── Productos más vendidos ──
    const topProducts = React.useMemo(() => {
        const counts = {};
        activeSales.forEach(s => {
            (s.items || []).forEach(item => {
                // Filtrar items sin nombre para evitar entradas vacías
                if (!item.name) return;
                counts[item.name] = (counts[item.name] || 0) + item.qty;
            });
        });
        return Object.entries(counts)
            .map(([name, qty]) => ({ name: name.length > 15 ? name.slice(0, 15) + '…' : name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 6);
    }, [sales]);

    // ── Ventas por método de pago (este mes) ──
    const payByMethod = React.useMemo(() => {
        const m = {};
        salesMonth.filter(s => s.paymentMethod !== 'reserva').forEach(s => { 
            m[s.paymentMethod] = (m[s.paymentMethod] || 0) + s.total; 
        });
        resPaymentsMonth.forEach(p => {
            const method = p.paymentMethod || 'efectivo';
            m[method] = (m[method] || 0) + p.amount;
        });
        return Object.entries(m).map(([name, value]) => ({ 
            name: name === 'qr' ? 'QR' : name.charAt(0).toUpperCase() + name.slice(1), 
            value 
        }));
    }, [salesMonth, resPaymentsMonth]);

    const kpis = [
        { label: 'Ventas Hoy', value: `${currency}${revenueToday.toFixed(2)}`, icon: TrendingUp, color: '#D946A8', bg: '#FDF0F9' },
        { label: 'Gastos Hoy', value: `${currency}${expensesToday.toFixed(2)}`, icon: Receipt, color: '#DC2626', bg: '#FEF2F2' },
        { label: 'Ingresos Mes', value: `${currency}${revenueMonth.toFixed(2)}`, icon: DollarSign, color: '#2563EB', bg: '#EFF6FF' },
        { label: 'Gastos Mes', value: `${currency}${expensesMonth.toFixed(2)}`, icon: Receipt, color: '#DC2626', bg: '#FEF2F2' },
        { label: 'Utilidad Mes', value: `${currency}${netProfit.toFixed(2)}`, icon: Award, color: '#16A34A', bg: '#F0FDF4' },
        { label: 'Stock Bajo', value: lowStockProds.length, icon: AlertTriangle, color: '#EA580C', bg: '#FFF7ED' },
        { label: 'Sin Stock', value: outStock.length, icon: ShoppingBag, color: '#DC2626', bg: '#FEF2F2' },
    ];

    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-5 flex items-center gap-2">
                <BarChart2 size={24} strokeWidth={1.8} className="text-pink-600" />
                Dashboard
            </h1>

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {kpis.map(({ label, value, icon: Icon, color, bg }) => (
                    <div key={label} className="fashion-card p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{ background: bg }}>
                                <Icon size={20} style={{ color }} />
                            </div>
                        </div>
                        <p className="text-2xl font-black" style={{ color }}>{value}</p>
                        <p className="text-xs text-pink-500 font-medium mt-1">{label}</p>
                    </div>
                ))}
            </div>

            <div className="fashion-card p-5 mb-6">
                <h2 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                    <BarChart2 size={17} className="text-pink-600" />
                    Tendencia de Ventas (Últimos 6 Meses)
                </h2>
                <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={last6Months} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#fce7f3" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9B7A8D', fontWeight: 'bold' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#9B7A8D' }} />
                        <Tooltip 
                            formatter={(value, name) => {
                                const labels = { total: 'Ingresos Totales', expenses: 'Gastos Totales', net: 'Utilidad Neta' };
                                return [`${currency}${value.toFixed(2)}`, labels[name] || name];
                            }}
                            contentStyle={{ borderRadius: 12, border: '1px solid #fce7f3', fontSize: 12 }} 
                        />
                        <Legend verticalAlign="top" height={36}/>
                        <Bar name="Ingresos" dataKey="total" fill="#BFDBFE" radius={[6, 6, 0, 0]} />
                        <Bar name="Utilidad Neta" dataKey="net" fill="url(#historyGrad)" radius={[6, 6, 0, 0]} />
                        <defs>
                            <linearGradient id="historyGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#16A34A" />
                                <stop offset="100%" stopColor="#22C55E" />
                            </linearGradient>
                        </defs>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {/* ── Ventas 7 días ── */}
                <div className="lg:col-span-2 fashion-card p-5">
                    <h2 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                        <TrendingUp size={17} className="text-pink-600" />
                        Ventas — Últimos 7 días
                    </h2>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={last7} barSize={28}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#fce7f3" />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9B7A8D' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#9B7A8D' }} />
                            <Tooltip
                                formatter={(v) => [`${currency}${v.toFixed(2)}`, 'Ventas']}
                                contentStyle={{ borderRadius: 12, border: '1px solid #fce7f3', fontSize: 12 }} />
                            <Bar dataKey="total" fill="url(#rosaGrad)" radius={[6, 6, 0, 0]} />
                            <defs>
                                <linearGradient id="rosaGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#D946A8" />
                                    <stop offset="100%" stopColor="#A3308A" />
                                </linearGradient>
                            </defs>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* ── Métodos de pago ── */}
                <div className="fashion-card p-5">
                    <h2 className="font-bold text-pink-900 mb-4">Pagos del Mes</h2>
                    {payByMethod.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-pink-300 text-sm">Sin datos</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie data={payByMethod} cx="50%" cy="50%" outerRadius={70}
                                    dataKey="value" nameKey="name" label={({ name }) => name}>
                                    {payByMethod.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(v) => `${currency}${v.toFixed(2)}`} />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* ── Top Productos ── */}
            {topProducts.length > 0 && (
                <div className="fashion-card p-5">
                    <h2 className="font-bold text-pink-900 mb-4 flex items-center gap-2">
                        <Award size={17} className="text-pink-600" />
                        Productos Más Vendidos
                    </h2>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={topProducts} layout="vertical" barSize={18}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#fce7f3" />
                            <XAxis type="number" tick={{ fontSize: 11, fill: '#9B7A8D' }} />
                            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#9B7A8D' }} />
                            <Tooltip
                                formatter={(v) => [v, 'Unidades vendidas']}
                                contentStyle={{ borderRadius: 12, border: '1px solid #fce7f3', fontSize: 12 }} />
                            <Bar dataKey="qty" fill="#D946A8" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ── Alertas de stock ── */}
            {(lowStockProds.length > 0 || outStock.length > 0) && (
                <div className="fashion-card p-5 mt-4">
                    <h2 className="font-bold text-pink-900 mb-3 flex items-center gap-2">
                        <AlertTriangle size={17} className="text-orange-500" />
                        Alertas de Inventario
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {outStock.map(p => (
                            <div key={p.id} className="flex items-center justify-between bg-red-50
                                                       border border-red-100 rounded-xl px-4 py-2.5">
                                <span className="text-sm font-medium text-red-800">{p.name}</span>
                                <span className="badge-red">Sin stock</span>
                            </div>
                        ))}
                        {lowStockProds.map(p => (
                            <div key={p.id} className="flex items-center justify-between bg-orange-50
                                                       border border-orange-100 rounded-xl px-4 py-2.5">
                                <span className="text-sm font-medium text-orange-800">{p.name}</span>
                                <span className="badge-red">Solo {p.stock} u.</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
