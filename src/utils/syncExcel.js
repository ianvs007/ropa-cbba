/**
 * 🔄 SINCRONIZACIÓN CON TIENDA VIRTUAL — Lógica pura, testeable.
 *
 * Ritual diario al cierre de caja, en dos sentidos:
 *  1. EXPORTAR: el POS genera un Excel de stock (codigo | nombre | talla |
 *     color | stock | precio) que se sube en el admin web → Sincronizar. El
 *     cruce en la nube es products.codigo = shortCode del POS + talla/color.
 *  2. IMPORTAR: la nube devuelve un Excel de ventas en línea (codigo | nombre
 *     | talla | color | cantidad | precio_unit | estado | pedido | fecha) y el
 *     POS descuenta ese stock localmente (sin crear ventas en caja).
 *
 * Estas funciones NO tocan Dexie ni XLSX: reciben y devuelven datos planos.
 */

/** Normaliza un encabezado de Excel: minúsculas, sin tildes, sin símbolos */
function normalizarEncabezado(header) {
    return String(header ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // quita tildes/diacríticos
        .replace(/[^a-z0-9]/g, '');        // quita espacios, guiones, etc.
}

// Alias aceptados por columna (ya normalizados) → campo canónico.
// La nube exporta encabezados exactos, pero se toleran variantes comunes.
const ALIAS_COLUMNAS = {
    codigo: 'codigo', code: 'codigo', cod: 'codigo',
    nombre: 'nombre', producto: 'nombre',
    talla: 'talla', size: 'talla',
    color: 'color',
    cantidad: 'cantidad', qty: 'cantidad', cant: 'cantidad',
    preciounit: 'precioUnit', precio: 'precioUnit', preciounitario: 'precioUnit',
    estado: 'estado',
    pedido: 'pedido', referencia: 'pedido', ref: 'pedido',
    fecha: 'fecha',
};

/**
 * Filas del Excel de stock a exportar a la tienda virtual.
 * Solo productos activos (active !== false) y con shortCode; el stock se
 * sanea a entero ≥ 0 y el precio a número ≥ 0.
 *
 * @param {Array} products - Productos de la tabla `products`
 * @returns {{ filas: Array<{codigo, nombre, talla, color, stock, precio, globalId}>, sinCodigo: Array }}
 *          `sinCodigo` trae los productos activos omitidos por falta de
 *          shortCode, para advertir al usuario.
 */
export function filasStockParaExportar(products = []) {
    const filas = [];
    const sinCodigo = [];

    for (const p of products || []) {
        if (p?.active === false) continue;
        const codigo = String(p?.shortCode ?? '').trim();
        if (!codigo) {
            sinCodigo.push(p);
            continue;
        }
        const precio = Number(p.price);
        filas.push({
            codigo,
            nombre: p.name ?? '',
            talla: p.size ?? '',
            color: p.color ?? '',
            stock: Math.max(0, Math.floor(Number(p.stock) || 0)),
            precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
            globalId: String(p.globalId ?? '').trim(),
        });
    }

    return { filas, sinCodigo };
}

/**
 * Detecta códigos cortos repetidos en las filas de stock a exportar/sincronizar.
 * Si un código aparece 2+ veces, la tienda virtual cruzaría la información de
 * prendas distintas (products.codigo = shortCode), así que el envío/exportación
 * debe BLOQUEARSE hasta reparar los duplicados (fixDuplicateProductShortCodes).
 *
 * @param {Array<{codigo, nombre, talla, color, stock, precio}>} filas - Salida de filasStockParaExportar
 * @returns {Array<{ codigo: string, filas: Array }>} Un grupo por código repetido, ordenado por código
 */
export function codigosDuplicadosEnFilas(filas = []) {
    const porCodigo = new Map();

    for (const f of filas || []) {
        const codigo = String(f?.codigo ?? '').trim();
        if (!codigo) continue;
        if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
        porCodigo.get(codigo).push(f);
    }

    return [...porCodigo.entries()]
        .filter(([, lista]) => lista.length > 1)
        .map(([codigo, lista]) => ({ codigo, filas: lista }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/**
 * Normaliza las filas crudas de XLSX.utils.sheet_to_json del Excel de ventas
 * en línea. Tolera encabezados con tildes, mayúsculas y alias comunes.
 *
 * Validaciones por fila (las inválidas van a `errores` y NO bloquean el resto):
 *  - codigo no vacío
 *  - cantidad entera > 0
 *
 * @param {Array<Object>} jsonRows
 * @returns {{ ventas: Array<{codigo, nombre, talla, color, cantidad, precioUnit, estado, pedido, fecha}>, errores: Array<string> }}
 */
export function parsearVentasEnLinea(jsonRows = []) {
    const ventas = [];
    const errores = [];

    (jsonRows || []).forEach((row, idx) => {
        const numFila = idx + 2; // fila real en Excel (1 = encabezados)

        // Mapear columnas crudas → campos canónicos (gana la primera coincidencia)
        const campos = {};
        for (const [key, value] of Object.entries(row || {})) {
            const campo = ALIAS_COLUMNAS[normalizarEncabezado(key)];
            if (campo && campos[campo] === undefined) campos[campo] = value;
        }

        const globalId = String(campos.globalId ?? '').trim();
        const codigo = String(campos.codigo ?? '').trim();
        if (!globalId && !codigo) {
            errores.push(`Fila ${numFila}: código vacío`);
            return;
        }

        const cantidad = Number(campos.cantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            errores.push(`Fila ${numFila}: cantidad inválida (${campos.cantidad ?? 'vacía'})`);
            return;
        }

        ventas.push({
            globalId: globalId || null,
            codigo,
            nombre: String(campos.nombre ?? '').trim(),
            talla: String(campos.talla ?? '').trim(),
            color: String(campos.color ?? '').trim(),
            cantidad,
            precioUnit: Number(campos.precioUnit) || 0,
            estado: String(campos.estado ?? '').trim().toLowerCase(),
            pedido: String(campos.pedido ?? '').trim(),
            fecha: String(campos.fecha ?? '').trim(),
        });
    });

    return { ventas, errores };
}

/**
 * Normaliza las ventas que devuelve la API de la tienda virtual
 * (POST /api/sync o GET /api/sync/ventas) al MISMO shape que produce
 * parsearVentasEnLinea, para que el cruce y el descuento de stock usen
 * exactamente el mismo código que la importación por Excel.
 *
 * Campos de entrada de la API: { codigo, nombre, talla, color, cantidad,
 * precio_unit, estado, pedido, fecha }.
 *
 * Validaciones equivalentes a parsearVentasEnLinea (las inválidas van a
 * `errores` y NO bloquean el resto):
 *  - codigo no vacío
 *  - cantidad entera > 0
 *
 * @param {Array<Object>} ventasApi - Array `ventas` de la respuesta de la API
 * @returns {{ ventas: Array<{codigo, nombre, talla, color, cantidad, precioUnit, estado, pedido, fecha}>, errores: Array<string> }}
 */
export function ventasDesdeApi(ventasApi = []) {
    const ventas = [];
    const errores = [];

    (ventasApi || []).forEach((item, idx) => {
        const numVenta = idx + 1; // posición en el array de la API

        const codigo = String(item?.codigo ?? '').trim();
        if (!codigo) {
            errores.push(`Venta ${numVenta}: código vacío`);
            return;
        }

        const cantidad = Number(item?.cantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            errores.push(`Venta ${numVenta}: cantidad inválida (${item?.cantidad ?? 'vacía'})`);
            return;
        }

        ventas.push({
            codigo,
            nombre: String(item?.nombre ?? '').trim(),
            talla: String(item?.talla ?? '').trim(),
            color: String(item?.color ?? '').trim(),
            cantidad,
            precioUnit: Number(item?.precio_unit) || 0,
            estado: String(item?.estado ?? '').trim().toLowerCase(),
            pedido: String(item?.pedido ?? '').trim(),
            fecha: String(item?.fecha ?? '').trim(),
        });
    });

    return { ventas, errores };
}

/**
 * Cruza las ventas en línea contra los productos locales (por shortCode) y
 * prepara la vista previa del descuento de stock.
 *
 * Reglas por fila (en este orden):
 *  1. fecha <= ultimaImportacion (comparación de strings "YYYY-MM-DD HH:MM:SS")
 *     → aviso 'Ya importada anteriormente', aDescontar 0.
 *  2. Código sin producto local → aviso 'Código no encontrado…', aDescontar 0.
 *  3. stockActual < cantidad → descuenta solo lo que hay, con aviso.
 *  4. Caso feliz → aDescontar = cantidad, aviso null.
 *
 * @param {Array} ventas - Salida de parsearVentasEnLinea
 * @param {Array} products - Productos locales
 * @param {string|null} ultimaImportacion - settings.ultimaImportacionVentas
 * @returns {Array} Filas de vista previa {…venta, productId, nombreLocal, stockActual, aDescontar, aviso}
 */
export function cruzarVentas(ventas = [], products = [], ultimaImportacion = null) {
    const porGlobalId = new Map();
    const porCodigo = new Map();
    for (const p of products || []) {
        const globalId = String(p?.globalId ?? '').trim();
        if (globalId && !porGlobalId.has(globalId)) porGlobalId.set(globalId, p);
        const codigo = String(p?.shortCode ?? '').trim();
        if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, p);
    }

    return (ventas || []).map(venta => {
        // Buscar primero por globalId, luego por codigo (fallback)
        const producto = (venta.globalId && porGlobalId.get(venta.globalId)) || porCodigo.get(venta.codigo) || null;
        const stockActual = producto
            ? Math.max(0, Math.floor(Number(producto.stock) || 0))
            : null;

        const base = {
            ...venta,
            productId: producto?.id ?? null,
            nombreLocal: producto?.name ?? null,
            stockActual,
        };

        if (ultimaImportacion && venta.fecha && venta.fecha <= ultimaImportacion) {
            return { ...base, aDescontar: 0, aviso: 'Ya importada anteriormente' };
        }
        if (!producto) {
            return { ...base, aDescontar: 0, aviso: 'Código no encontrado en el sistema local' };
        }
        if (stockActual < venta.cantidad) {
            return {
                ...base,
                aDescontar: stockActual,
                aviso: `Stock insuficiente: se descuenta ${stockActual} de ${venta.cantidad}`,
            };
        }
        return { ...base, aDescontar: venta.cantidad, aviso: null };
    });
}
