import { jsPDF } from 'jspdf';
import { db } from './db';

/**
 * Función global para imprimir un ticket de venta
 * Utilizada tanto en el Punto de Venta (POS) como en el Historial de Ventas
 */
export const printTicketGlobal = async (saleId, cart, total, payment, receivedVal, changeAmount, user, discount = 0) => {
    // Obtener configuración desde Dexie
    const settingsArr = await db.settings.toArray();
    const settings = {};
    settingsArr.forEach(s => settings[s.key] = s.value);

    const currency = settings.currency || 'Bs.';
    const storeName = settings.storeName || 'Tienda de Ropa';
    const storePhone = settings.storePhone || '';
    const storeLogo = settings.storeLogo || '';
    const ticketMsg = settings.ticketMessage || '¡Gracias por su compra!';
    const returnMessage = settings.returnMessage || 'Cambios y devoluciones válidos hasta 15 días desde la fecha de compra, presentando este comprobante. Pasado este plazo, no se aceptarán devoluciones.';
    const printEnabled = settings.printTicket !== 'false';

    // Formato Medio Carta (8.5 x 5.5 pulgadas) = 215.9 x 139.7 mm Horizontal
    const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: [215.9, 139.7] });
    let y = 14;
    const pageWidth = 215.9;
    const center = pageWidth / 2;

    // Logo si está configurado
    if (storeLogo) {
        try {
            const logoH = 18;
            const logoW = 40;
            doc.addImage(storeLogo, 'PNG', center - logoW / 2, y, logoW, logoH);
            y += logoH + 8; // Más espacio entre el logo y el nombre de la tienda
        } catch (e) { /* Ignorar errores de logo */ }
    }
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(storeName, center, y, { align: 'center' }); y += 7;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (storePhone) { doc.text(`Tel: ${storePhone}`, center, y, { align: 'center' }); y += 7; }

    doc.setFontSize(9);
    doc.text('NOTA DE VENTA', center, y, { align: 'center' }); y += 6;
    doc.text(`Fecha: ${new Date().toLocaleString()}`, 10, y);
    doc.text(`Venta #${saleId}`, pageWidth - 10, y, { align: 'right' }); y += 5;
    doc.text(`Vendedor: ${user?.name || user?.username || 'N/A'}`, 10, y); y += 6;
    
    doc.line(10, y, pageWidth - 10, y); y += 5;
    
    // Cabeceras de tabla
    doc.setFont('helvetica', 'bold');
    doc.text('Cant', 10, y);
    doc.text('Descripción', 25, y);
    doc.text('Precio', pageWidth - 40, y);
    doc.text('Total', pageWidth - 10, y, { align: 'right' });
    y += 4;
    doc.line(10, y, pageWidth - 10, y); y += 5;
    
    // Ítems
    doc.setFont('helvetica', 'normal');
    cart.forEach(item => {
        doc.text(`${item.qty}`, 10, y);
        const desc = `${item.name} ${item.size ? `(T:${item.size}) ` : ''}${item.color ? `[${item.color}]` : ''}`;
        const splitDesc = doc.splitTextToSize(desc, 140);
        doc.text(splitDesc, 25, y);
        
        doc.text(`${currency}${item.price.toFixed(2)}`, pageWidth - 40, y);
        doc.text(`${currency}${(item.qty * item.price).toFixed(2)}`, pageWidth - 10, y, { align: 'right' });
        
        // Si hay descuento, mostrarlo debajo
        if (item.originalPrice && item.price < item.originalPrice) {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'italic');
            const saving = item.originalPrice - item.price;
            doc.text(`(Ahorro: -${currency}${saving.toFixed(2)} c/u)`, 25, y + 4);
            doc.setFont('helvetica', 'normal');
            y += 4;
        }

        y += (splitDesc.length * 4) + 1;

        // Códigos de las unidades vendidas (código corto y EAN)
        if (item.unitCodes && item.unitCodes.length > 0) {
            const shortCodes = item.unitCodes.map(u => u.shortCode).filter(Boolean);
            const eans      = item.unitCodes.map(u => u.barcode).filter(Boolean);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
            if (shortCodes.length > 0) {
                const scLine = `  Cód: ${shortCodes.join(', ')}`;
                doc.text(scLine, 25, y); y += 3.5;
            }
            if (eans.length > 0) {
                const eanLine = `  EAN: ${eans.join(', ')}`;
                doc.text(eanLine, 25, y); y += 3.5;
            }
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
        }

        y += 2;
    });
    
    doc.line(10, y, pageWidth - 10, y); y += 6;
    
    // Totales
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    // Si hubo descuento, mostrar subtotal original y el ahorro
    const hasDiscount = discount > 0;
    if (hasDiscount) {
        const originalTotal = total + discount;
        doc.text(`Subtotal:`, pageWidth - 60, y);
        doc.text(`${currency}${originalTotal.toFixed(2)}`, pageWidth - 10, y, { align: 'right' }); y += 5;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(`Descuento aplicado:`, pageWidth - 60, y);
        doc.text(`-${currency}${discount.toFixed(2)}`, pageWidth - 10, y, { align: 'right' }); y += 5;
        doc.setTextColor(0, 0, 0);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`TOTAL: ${currency}${total.toFixed(2)}`, pageWidth - 10, y, { align: 'right' }); y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Pago: ${payment.toUpperCase()}`, pageWidth - 10, y, { align: 'right' }); y += 5;
    if (payment === 'efectivo' && receivedVal) {
        doc.text(`Recibido: ${currency}${receivedVal.toFixed(2)}`, pageWidth - 10, y, { align: 'right' }); y += 5;
        doc.text(`Cambio: ${currency}${Math.max(0, changeAmount).toFixed(2)}`, pageWidth - 10, y, { align: 'right' }); y += 5;
    }

    doc.setFontSize(9);
    const splitMsg = doc.splitTextToSize(ticketMsg, 160);
    doc.text(splitMsg, center, y, { align: 'center' });
    y += (splitMsg.length * 4) + 3;

    // Aviso de devolución y vigencia
    if (returnMessage) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        const splitReturn = doc.splitTextToSize(returnMessage, 170);
        doc.text(splitReturn, center, y, { align: 'center' });
    }
    if (printEnabled) {
        doc.autoPrint();
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
    }
};

/**
 * Formatea un monto con la moneda configurada.
 * @param {number} amount - El monto a formatear.
 * @param {string} currency - Símbolo de moneda (ej: 'Bs.').
 * @returns {string} Texto formateado (ej: 'Bs. 100.00').
 */
export const formatCurrency = (amount, currency = 'Bs.') => {
    const val = parseFloat(amount || 0);
    return `${currency}${val.toFixed(2)}`;
};

/**
 * Dibuja el encabezado estándar para reportes PDF de la tienda.
 * Centraliza la lógica de logo, nombre, teléfono y título del reporte.
 * 
 * @param {Object} doc - Instancia de jsPDF.
 * @param {Object} settings - Mapa de configuraciones.
 * @param {string} title - Título del reporte.
 * @param {number} startY - Posición Y inicial.
 * @returns {number} Nueva posición Y después del encabezado.
 */
export const drawPDFHeader = (doc, settings, title, startY = 15) => {
    const pageWidth = doc.internal.pageSize.width;
    const center = pageWidth / 2;
    let y = startY;

    const storeName = settings.storeName || 'Tienda de Ropa';
    const storePhone = settings.storePhone || '';
    const storeLogo = settings.storeLogo || '';

    // Logo
    if (storeLogo) {
        try {
            const logoH = 15;
            const logoW = 34;
            doc.addImage(storeLogo, 'PNG', center - logoW / 2, y, logoW, logoH);
            y += logoH + 10;
        } catch (e) { /* Ignorar */ }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(storeName.toUpperCase(), center, y, { align: 'center' }); y += 8;

    doc.setFontSize(12);
    doc.text(title.toUpperCase(), center, y, { align: 'center' }); y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Fecha: ${new Date().toLocaleString()}`, center, y, { align: 'center' });
    if (storePhone) {
        y += 5;
        doc.text(`Tel: ${storePhone}`, center, y, { align: 'center' });
    }
    y += 8;

    return y;
};

/**
 * Imprime un reporte de cierre de caja detallado.
 */
export const printCashCloseGlobal = async (data, currency = 'Bs.') => {
    const settingsArr = await db.settings.toArray();
    const settings = {};
    settingsArr.forEach(s => settings[s.key] = s.value);

    // Formato Carta
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter' });
    let y = drawPDFHeader(doc, settings, 'Reporte de Cierre de Caja');
    const pageWidth = doc.internal.pageSize.width;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Fecha del Cierre: ${data.date}`, 20, y); y += 10;

    // Resumen Financiero
    doc.setDrawColor(0, 0, 0);
    doc.line(20, y, pageWidth - 20, y);

    doc.setFontSize(9);
    doc.text('RESUMEN GENERAL', 25, y + 6);
    doc.setFont('helvetica', 'normal');

    const stats = [
        { l: 'Efectivo Inicial:', v: formatCurrency(data.cashStart, currency) },
        { l: 'Ventas Totales:', v: formatCurrency(data.totalSales, currency) },
        { l: 'Gastos Totales:', v: formatCurrency(data.totalExpenses, currency) },
        { l: 'Ingreso Neto:', v: formatCurrency(data.netIncome, currency) },
    ];

    let rowY = y + 13;
    stats.forEach(s => {
        doc.text(s.l, 30, rowY);
        doc.text(s.v, pageWidth - 30, rowY, { align: 'right' });
        rowY += 6;
    });

    y = rowY + 2;
    doc.line(20, y, pageWidth - 20, y);
    y += 8;

    // ── DESGLOSE DETALLADO DE INGRESOS ──
    const all = data.all || [];
    const directSales = all.filter(v => v.tipo === 'VENTA');
    const resPayments = all.filter(v => v.tipo === 'RESERVA');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('DESGLOSE DE INGRESOS', 20, y); y += 8;

    // Ventas Directas
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`VENTAS DIRECTAS (${directSales.length} OPERACIONES)`, 25, y); y += 6;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');

    if (directSales.length === 0) {
        doc.setFontSize(9);
        doc.text('No hubo ventas directas en esta fecha.', 30, y); y += 6;
    } else {
        // Agrupar por método
        const grouped = directSales.reduce((acc, v) => {
            const m = v.method || 'efectivo';
            acc[m] = (acc[m] || 0) + v.amount;
            return acc;
        }, {});
        
        Object.entries(grouped).forEach(([method, amount]) => {
            const label = method === 'efectivo' ? '• Efectivo' : `• ${method.toUpperCase()}`;
            doc.text(label, 30, y);
            doc.text(formatCurrency(amount, currency), pageWidth - 30, y, { align: 'right' });
            y += 5;
        });
    }
    y += 4;

    // Abonos Reservas
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`ABONOS DE RESERVAS (${resPayments.length} PAGOS)`, 25, y); y += 6;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');

    if (resPayments.length === 0) {
        doc.setFontSize(9);
        doc.text('No hubo abonos de reserva en esta fecha.', 30, y); y += 6;
    } else {
        const grouped = resPayments.reduce((acc, v) => {
            const m = v.method || 'efectivo';
            acc[m] = (acc[m] || 0) + v.amount;
            return acc;
        }, {});
        
        Object.entries(grouped).forEach(([method, amount]) => {
            const label = method === 'efectivo' ? '• Efectivo' : `• ${method.toUpperCase()}`;
            doc.text(label, 30, y);
            doc.text(formatCurrency(amount, currency), pageWidth - 30, y, { align: 'right' });
            y += 5;
        });
    }
    y += 10;

    // Métricas de Operación
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('DETALLE DE OPERACIONES', 20, y); y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    const details = [
        { l: 'Cantidad de Ventas:', v: data.salesCount },
        { l: 'Cantidad de Gastos:', v: data.expensesCount },
        { l: 'Prendas Vendidas:', v: data.itemsSold },
        { l: 'Efectivo en Caja (Arqueo):', v: formatCurrency(data.cashOnHand, currency) }
    ];

    details.forEach(d => {
        doc.text(d.l, 25, y);
        doc.text(d.v.toString(), pageWidth - 30, y, { align: 'right' });
        y += 6;
    });

    y += 10;

    // Notas
    if (data.notes) {
        doc.setFont('helvetica', 'bold');
        doc.text('OBSERVACIONES:', 20, y); y += 6;
        doc.setFont('helvetica', 'normal');
        const splitNotes = doc.splitTextToSize(data.notes, pageWidth - 40);
        doc.text(splitNotes, 20, y);
        y += (splitNotes.length * 5) + 10;
    }

    // Pie de página
    doc.setFontSize(9);
    doc.text(`Cerrado por: ${data.closedBy || 'N/A'}`, 20, y);
    doc.text(`Hora de impresión: ${new Date().toLocaleTimeString()}`, pageWidth - 20, y, { align: 'right' });

    doc.autoPrint();
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');
};
/**
 * Imprime un reporte mensual detallado.
 */
export const printMonthlyReportGlobal = async (data, currency = 'Bs.') => {
    const settingsArr = await db.settings.toArray();
    const settings = {};
    settingsArr.forEach(s => settings[s.key] = s.value);

    // Formato Carta
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter' });
    const monthName = new Date(data.monthKey + '-01T12:00:00')
        .toLocaleDateString('es', { month: 'long', year: 'numeric' }).toUpperCase();
    
    let y = drawPDFHeader(doc, settings, `Reporte Mensual - ${monthName}`);
    const pageWidth = doc.internal.pageSize.width;

    // Resumen Financiero
    doc.setDrawColor(0, 0, 0);
    doc.line(20, y, pageWidth - 20, y);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN FINANCIERO DEL MES', 25, y + 6);
    doc.setFont('helvetica', 'normal');

    const stats = [
        { l: 'Ingresos Totales (Ventas + Abonos):', v: formatCurrency(data.totalSales, currency) },
        { l: 'Costo de Mercadería Vendida:', v: formatCurrency(data.totalCost, currency) },
        { l: 'Utilidad de Productos (Ventas - Costo):', v: formatCurrency(data.productProfit, currency) },
        { l: 'Gastos Totales del Mes:', v: formatCurrency(data.totalExpenses, currency) },
        { l: 'UTILIDAD NETA:', v: formatCurrency(data.netProfit, currency) },
    ];

    let rowY = y + 13;
    stats.forEach(s => {
        if (s.l.includes('UTILIDAD')) doc.setFont('helvetica', 'bold');
        doc.text(s.l, 30, rowY);
        doc.text(s.v, pageWidth - 30, rowY, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        rowY += 6;
    });

    y = rowY + 2;
    doc.line(20, y, pageWidth - 20, y);
    y += 8;

    // Métricas Operativas
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('MÉTRICAS OPERATIVAS', 20, y); y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    const details = [
        { l: 'Cantidad de Ventas Directas:', v: data.salesCount },
        { l: 'Cantidad de Abonos de Reserva:', v: data.resCount },
        { l: 'Total Prendas Vendidas:', v: data.itemsSold },
        { l: 'Días con Actividad Registrada:', v: data.closuresCount }
    ];

    details.forEach(d => {
        doc.text(d.l, 25, y);
        doc.text(d.v.toString(), pageWidth - 30, y, { align: 'right' });
        y += 6;
    });

    y += 10;

    // Desglose de Gastos
    if (data.expensesByCategory.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('DESGLOSE DE GASTOS POR CATEGORÍA', 20, y); y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        data.expensesByCategory.forEach(cat => {
            doc.text(`• ${cat.name}`, 30, y);
            doc.text(formatCurrency(cat.value, currency), pageWidth - 30, y, { align: 'right' });
            y += 5;
        });
        y += 10;
    }

    // Pie de página
    const bottomY = doc.internal.pageSize.height - 20;
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Este reporte es una síntesis de las operaciones registradas en el mes de ${monthName}.`, 20, bottomY);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, pageWidth - 20, bottomY, { align: 'right' });

    doc.autoPrint();
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');
};
