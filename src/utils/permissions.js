// Llaves de permiso restringibles por usuario admin secundario
export const PERMISSIONS = {
    BACKUP: 'backup',
    DELETE_PRODUCT: 'deleteProduct',
    MANAGE_USERS: 'manageUsers',
    SETTINGS: 'settings',
    EDIT_PRODUCTS: 'editProducts',
};

// Etiquetas legibles para las casillas
export const PERMISSION_LABELS = {
    backup: 'Backup / Restaurar sistema',
    deleteProduct: 'Eliminar / Salida de productos',
    manageUsers: 'Gestión de usuarios',
    settings: 'Configuración del sistema',
    editProducts: 'Editar / crear productos e inventario',
};

// ¿este usuario puede hacer X?
// - El admin principal (username 'admin') SIEMPRE puede todo.
// - Un usuario que NO sea admin no usa este sistema (false aquí).
// - Un admin secundario solo puede lo que tenga tildado en permissions.
// Acceso MÍNIMO por defecto: si no está tildado, no puede.
export function hasPermission(user, perm) {
    if (!user) return false;
    if (user.username === 'admin') return true;     // admin principal: acceso total
    if (user.role !== 'admin') return false;        // sellers no usan este sistema
    const perms = user.permissions || {};
    return perms[perm] === true;
}
