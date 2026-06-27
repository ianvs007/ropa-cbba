import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, calculateMonthlySummary } from '../../db';
import { 
    Calendar, TrendingUp, Receipt, DollarSign, 
    ArrowLeft, Printer, ShoppingBag, PieChart as PieIcon,
    ChevronLeft, ChevronRight, FileText, Package, Wallet
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
    ResponsiveContainer, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { printMonthlyReportGlobal } from '../../utils';

const COLORS = ['#D946A8', '#A3308A', '#F472B6', '#FBCFE8', '#BE185D'];

const formatCurrency = (val, curr = 'Bs.') => `${curr}${parseFloat(val || 0).toFixed(2)}`;

export default function MonthlyReport() {

    const today = new Date();
    const [monthKey, setMonthKey] = useState(today.toISOString().slice(0, 7)); // YYYY-MM
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(true);

    const settings = useLiveQuery(() => db.settings.toArray(), []);
    const currency = settings?.find(s => s.key === 'currency')?.value || 'Bs.';
    const navigate = useNavigate();

    useEffect(() => {
        async function load() {
            try {
                const data = await calculateMonthlySummary(monthKey);
                setReportData(data);
            } catch (err) {
                console.error("Error al cargar reporte mensual:", err);
                setReportData({
                    totalSales: 0, salesDirect: 0, resPayments: 0,
                    totalExpenses: 0, expensesByCategory: [],
                    netProfit: 0, salesCount: 0, resCount: 0,
                    itemsSold: 0, closuresCount: 0, dailyDetails: []
                });
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [monthKey]);

    const handlePrevMonth = () => {
        const [y, m] = monthKey.split('-').map(Number);
        const prev = new Date(y, m - 2, 1);
        setMonthKey(prev.toISOString().slice(0, 7));
    };

    const handleNextMonth = () => {
        const [y, m] = monthKey.split('-').map(Number);
        const next = new Date(y, m, 1);
        if (next > new Date()) return;
        setMonthKey(next.toISOString().slice(0, 7));
    };

    if (loading || !reportData) return <div className="p-10 text-center text-pink-500 font-bold">Cargando reporte...</div>;

    const monthName = new Date(monthKey + '-01T12:00:00')
        .toLocaleDateString('es', { month: 'long', year: 'numeric' }).toUpperCase();

    return (
        <div className="max-w-6xl mx-auto fade-in pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-pink-500 text-sm font-bold hover:underline mb-1">
                        <ArrowLeft size={16} /> Volver al Dashboard
                    </button>
                    <h1 className="text-3xl font-black text-pink-900 flex items-center gap-3">
                        <Calendar size={28} className="text-pink-600" />
                        Reporte Mensual
                    </h1>
                </div>

                <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-pink-100">
                    <button onClick={handlePrevMonth} className="p-2 hover:bg-pink-50 rounded-xl text-pink-600 transition-colors">
                        <ChevronLeft size={20} />
                    </button>
                    <div className="px-4 text-center">
                        <p className="text-[10px] font-black text-pink-400 uppercase leading-none">Periodo Seleccionado</p>
                        <p className="text-sm font-bold text-pink-800">{monthName}</p>
                    </div>
                    <button onClick={handleNextMonth} 
                        disabled={monthKey === today.toISOString().slice(0, 7)}
                        className="p-2 hover:bg-pink-50 rounded-xl text-pink-600 disabled:opacity-20 transition-colors">
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            {/* KPIs Principales */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                <div className="fashion-card p-5 border-l-4 border-l-blue-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                            <TrendingUp size={20} />
                        </div>
                        <p className="text-[11px] font-black text-blue-400 uppercase">Ingresos Totales</p>
                    </div>
                    <p className="text-2xl font-black text-blue-900">{formatCurrency(reportData.totalSales, currency)}</p>
                    <p className="text-[10px] text-blue-500 italic mt-1">{reportData.salesCount} ventas + {reportData.resCount} abonos</p>
                </div>

                <div className="fashion-card p-5 border-l-4 border-l-orange-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center text-orange-600">
                            <Package size={20} />
                        </div>
                        <p className="text-[11px] font-black text-orange-400 uppercase">Costo Mercadería</p>
                    </div>
                    <p className="text-2xl font-black text-orange-900">{formatCurrency(reportData.totalCost, currency)}</p>
                    <p className="text-[10px] text-orange-500 italic mt-1">Costo de lo vendido</p>
                </div>

                <div className="fashion-card p-5 border-l-4 border-l-emerald-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                            <Wallet size={20} />
                        </div>
                        <p className="text-[11px] font-black text-emerald-400 uppercase">Utilidad Productos</p>
                    </div>
                    <p className="text-2xl font-black text-emerald-700">{formatCurrency(reportData.productProfit, currency)}</p>
                    <p className="text-[10px] text-emerald-600 font-bold mt-1">
                        {((reportData.productProfit / (reportData.salesDirect || 1)) * 100).toFixed(1)}% Margen bruto
                    </p>
                </div>

                <div className="fashion-card p-5 border-l-4 border-l-red-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
                            <Receipt size={20} />
                        </div>
                        <p className="text-[11px] font-black text-red-400 uppercase">Gastos Totales</p>
                    </div>
                    <p className="text-2xl font-black text-red-900">{formatCurrency(reportData.totalExpenses, currency)}</p>
                    <p className="text-[10px] text-red-500 italic mt-1">Registrados en el mes</p>
                </div>

                <div className="fashion-card p-5 border-l-4 border-l-green-600">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600">
                            <DollarSign size={20} />
                        </div>
                        <p className="text-[11px] font-black text-green-500 uppercase">Utilidad Neta</p>
                    </div>
                    <p className="text-2xl font-black text-green-700">{formatCurrency(reportData.netProfit, currency)}</p>
                    <p className="text-[10px] text-green-600 font-bold mt-1">
                        Utilidad productos − gastos
                    </p>
                </div>

                <div className="fashion-card p-5 border-l-4 border-l-pink-500">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600">
                            <ShoppingBag size={20} />
                        </div>
                        <p className="text-[11px] font-black text-pink-400 uppercase">Volumen Ventas</p>
                    </div>
                    <p className="text-2xl font-black text-pink-900">{reportData.itemsSold}</p>
                    <p className="text-[10px] text-pink-500 italic mt-1">Prendas vendidas en {reportData.closuresCount} días</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Gráfico Gastos por Categoría */}
                <div className="fashion-card p-6">
                    <h2 className="text-lg font-black text-pink-900 mb-6 flex items-center gap-2">
                        <PieIcon size={20} className="text-pink-600" />
                        Distribución de Gastos
                    </h2>
                    {reportData.expensesByCategory.length === 0 ? (
                        <div className="h-60 flex flex-col items-center justify-center text-pink-300 italic">
                            <Receipt size={40} className="mb-2 opacity-20" />
                            No hay gastos registrados este mes.
                        </div>
                    ) : (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={reportData.expensesByCategory} cx="50%" cy="50%" 
                                        innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" nameKey="name">
                                        {reportData.expensesByCategory.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(v) => formatCurrency(v, currency)} />
                                    <Legend verticalAlign="bottom" height={36}/>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* Resumen Operativo */}
                <div className="fashion-card p-6 flex flex-col">
                    <h2 className="text-lg font-black text-pink-900 mb-4 flex items-center gap-2">
                        <FileText size={20} className="text-pink-600" />
                        Resumen Operativo
                    </h2>
                    <div className="space-y-4 flex-1">
                        <div className="p-4 bg-pink-50 rounded-2xl flex justify-between items-center">
                            <div>
                                <p className="text-xs font-black text-pink-400 uppercase">Días con Cierre</p>
                                <p className="text-lg font-bold text-pink-700">{reportData.closuresCount} días registrados</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-black text-pink-400 uppercase">Promedio Diario</p>
                                <p className="text-lg font-bold text-pink-700">
                                    {formatCurrency(reportData.totalSales / (reportData.closuresCount || 1), currency)}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="p-4 border border-pink-100 rounded-2xl">
                                <p className="text-[10px] font-black text-pink-400 uppercase">Ventas Directas</p>
                                <p className="text-xl font-black text-pink-900">{formatCurrency(reportData.salesDirect, currency)}</p>
                            </div>
                            <div className="p-4 border border-pink-100 rounded-2xl">
                                <p className="text-[10px] font-black text-pink-400 uppercase">Abonos Reservas</p>
                                <p className="text-xl font-black text-pink-900">{formatCurrency(reportData.resPayments, currency)}</p>
                            </div>
                        </div>

                        <button onClick={() => printMonthlyReportGlobal(reportData, currency)}
                            className="mt-auto w-full btn-fashion h-14 bg-pink-600 hover:bg-pink-700 text-white flex items-center justify-center gap-3 shadow-lg shadow-pink-200">
                            <Printer size={20} />
                            Imprimir Reporte Ejecutivo
                        </button>
                    </div>
                </div>
            </div>

            {/* Listado de Cierres Diarios */}
            <div className="fashion-card overflow-hidden">
                <div className="p-5 border-b border-pink-50 bg-pink-50/30">
                    <h2 className="text-lg font-black text-pink-900 flex items-center gap-2">
                        <Calendar size={20} className="text-pink-600" />
                        Detalle de Cierres Diarios
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-white border-b border-pink-100">
                                <th className="px-6 py-4 font-black text-pink-500 uppercase text-[10px]">Fecha</th>
                                <th className="px-6 py-4 font-black text-pink-500 uppercase text-[10px]">Ventas</th>
                                <th className="px-6 py-4 font-black text-pink-500 uppercase text-[10px]">Gastos</th>
                                <th className="px-6 py-4 font-black text-pink-500 uppercase text-[10px]">Utilidad Bruta</th>
                                <th className="px-6 py-4 font-black text-pink-500 uppercase text-[10px] text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-pink-50">
                            {reportData.dailyDetails.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-10 text-center text-pink-300 italic">No hay cierres registrados en este mes.</td>
                                </tr>
                            ) : (
                                reportData.dailyDetails.map(c => (
                                    <tr key={c.id} className="hover:bg-pink-50/30 transition-colors">
                                        <td className="px-6 py-4 font-bold text-pink-900">
                                            {new Date(c.date + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', weekday: 'short' })}
                                        </td>
                                        <td className="px-6 py-4 text-blue-600 font-bold">{formatCurrency(c.totalSales, currency)}</td>
                                        <td className="px-6 py-4 text-red-500 font-medium">{formatCurrency(c.totalExpenses, currency)}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-lg text-[11px] font-black uppercase ${c.netIncome >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {formatCurrency(c.netIncome, currency)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button onClick={() => navigate('/cash')} className="text-pink-400 hover:text-pink-600 transition-colors">
                                                <ArrowNav size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// Icono extra no importado explícitamente pero usado en el listado
function ArrowNav({ size }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    );
}
