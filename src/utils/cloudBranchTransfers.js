import { normalizarCodigoSucursal } from './branchTransferIn';

export const CLAVE_SUCURSAL_LOCAL = 'branchSync.localBranch';
export const SUCURSAL_LOCAL_DEFAULT = 'TIENDA PRINCIPAL';

/**
 * Normaliza el nombre de una sucursal (trim + mayúsculas).
 */
export function normalizarNombreSucursal(raw) {
    return String(raw ?? '').trim().toUpperCase();
}

/**
 * Genera un identificador único estable para un paquete de traslado entre sucursales.
 */
export function generarTransferUid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Construye el paquete estándar de traslado saliente para enviarlo al buzón en la nube
 * o exportarlo como archivo `.traslado.json`.
 */
export function crearPaqueteTraslado({
    originBranch = SUCURSAL_LOCAL_DEFAULT,
    destinationBranch,
    notes = '',
    user = null,
    product,
    unit,
    transferUid = generarTransferUid(),
    createdAt = new Date().toISOString(),
}) {
    const origen = normalizarNombreSucursal(originBranch) || SUCURSAL_LOCAL_DEFAULT;
    const destino = normalizarNombreSucursal(destinationBranch);
    if (!destino) {
        throw new Error('La sucursal destino es obligatoria');
    }
    if (!product || !unit) {
        throw new Error('Se requiere el producto y la unidad física para armar el paquete');
    }

    const shortCode = normalizarCodigoSucursal(unit.shortCode) || String(unit.shortCode || '').trim();
    if (!shortCode) {
        throw new Error('La unidad no tiene código corto válido');
    }

    return {
        version: 1,
        transferUid,
        originBranch: origen,
        destinationBranch: destino,
        status: 'en_transito',
        notes: String(notes ?? '').trim().toUpperCase(),
        sentBy: user?.name || user?.username || 'Sistema',
        sentByUserId: user?.id ?? null,
        createdAt,
        items: [
            {
                shortCode,
                barcode: String(unit.barcode || '').trim(),
                globalId: String(product.globalId || '').trim(),
                name: String(product.name || '').trim().toUpperCase(),
                category: String(product.category || '').trim(),
                brand: String(product.brand || '').trim(),
                size: String(product.size || '').trim(),
                color: String(product.color || '').trim(),
                cost: Number(product.cost) || 0,
                price: Number(product.price) || 0,
                qty: 1,
            },
        ],
    };
}

/**
 * Valida y normaliza un paquete de traslado recibido desde la nube o desde un archivo JSON.
 * @returns {{ valido: boolean, error?: string, paquete?: object }}
 */
export function validarPaqueteTraslado(raw) {
    if (!raw || typeof raw !== 'object') {
        return { valido: false, error: 'El paquete de traslado está vacío o es inválido.' };
    }

    const transferUid = String(raw.transferUid || '').trim();
    const originBranch = normalizarNombreSucursal(raw.originBranch);
    const destinationBranch = normalizarNombreSucursal(raw.destinationBranch);
    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];

    if (!transferUid) {
        return { valido: false, error: 'El paquete no contiene transferUid.' };
    }
    if (!originBranch) {
        return { valido: false, error: 'El paquete no indica sucursal de origen.' };
    }
    if (!destinationBranch) {
        return { valido: false, error: 'El paquete no indica sucursal destino.' };
    }
    if (itemsRaw.length === 0) {
        return { valido: false, error: 'El paquete no contiene prendas.' };
    }

    const items = [];
    for (const item of itemsRaw) {
        const shortCode = normalizarCodigoSucursal(item?.shortCode);
        if (!shortCode) {
            return {
                valido: false,
                error: `Código corto inválido en el paquete: "${item?.shortCode ?? ''}".`,
            };
        }
        items.push({
            shortCode,
            barcode: String(item?.barcode || '').trim(),
            globalId: String(item?.globalId || '').trim(),
            name: String(item?.name || 'PRENDA DE SUCURSAL').trim().toUpperCase(),
            category: String(item?.category || 'Otros').trim(),
            brand: String(item?.brand || '').trim(),
            size: String(item?.size || '').trim(),
            color: String(item?.color || '').trim(),
            cost: Number(item?.cost) || 0,
            price: Number(item?.price) || 0,
            qty: Math.max(1, Math.floor(Number(item?.qty) || 1)),
        });
    }

    return {
        valido: true,
        paquete: {
            version: Number(raw.version) || 1,
            transferUid,
            originBranch,
            destinationBranch,
            status: String(raw.status || 'en_transito'),
            notes: String(raw.notes || '').trim(),
            sentBy: String(raw.sentBy || 'Sucursal').trim(),
            createdAt: raw.createdAt || new Date().toISOString(),
            items,
        },
    };
}

/**
 * Filtra los traslados entrantes dirigidos a esta tienda física que aún no han sido recibidos localmente.
 */
export function filtrarBandejaEntrante(traslados = [], localBranch = SUCURSAL_LOCAL_DEFAULT, recibidosUids = new Set()) {
    const localNorm = normalizarNombreSucursal(localBranch);
    const recibidos = recibidosUids instanceof Set ? recibidosUids : new Set(recibidosUids || []);
    const resultado = [];

    for (const raw of traslados || []) {
        const check = validarPaqueteTraslado(raw);
        if (!check.valido) continue;
        const pkg = check.paquete;
        if (recibidos.has(pkg.transferUid)) continue;
        if (pkg.status === 'recibido') continue;
        if (localNorm && pkg.destinationBranch !== localNorm) continue;
        resultado.push(pkg);
    }

    return resultado.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Busca si ya existe un producto compatible en el catálogo local de esta tienda:
 * 1. Coincidencia exacta por `globalId`.
 * 2. Coincidencia normalizada por `name + size + color` en productos activos.
 */
export function buscarProductoCompatibleLocal(item, products = []) {
    if (!item || !Array.isArray(products)) return null;
    const activos = products.filter(p => p && p.active !== false);

    if (item.globalId) {
        const byGlobal = activos.find(p => p.globalId && p.globalId === item.globalId);
        if (byGlobal) return byGlobal;
    }

    const norm = (v) => String(v ?? '').trim().toUpperCase();
    const targetName = norm(item.name);
    const targetSize = norm(item.size);
    const targetColor = norm(item.color);

    if (!targetName) return null;

    return (
        activos.find(
            p =>
                norm(p.name) === targetName &&
                norm(p.size) === targetSize &&
                norm(p.color) === targetColor
        ) || null
    );
}
