/**
 * Validaciones centralizadas para formularios
 * Cada función retorna string con el error, o null si es válido.
 */

export function validateRequired(value, fieldName = 'Campo') {
    if (!value || (typeof value === 'string' && !value.trim())) {
        return `${fieldName} es obligatorio`;
    }
    return null;
}

export function validateMinLength(value, min, fieldName = 'Campo') {
    if (typeof value === 'string' && value.trim().length < min) {
        return `${fieldName} debe tener al menos ${min} caracteres`;
    }
    return null;
}

export function validatePositiveNumber(value, fieldName = 'Valor') {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
        return `${fieldName} debe ser mayor a 0`;
    }
    return null;
}

export function validateNonNegativeNumber(value, fieldName = 'Valor') {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
        return `${fieldName} no puede ser negativo`;
    }
    return null;
}

export function validateMaxValue(value, max, fieldName = 'Valor') {
    const num = parseFloat(value);
    if (!isNaN(num) && num > max) {
        return `${fieldName} no puede superar ${max}`;
    }
    return null;
}

export function validateFileType(file, allowedPrefix = 'image/', message) {
    if (file && !file.type.startsWith(allowedPrefix)) {
        return message || 'Tipo de archivo no válido';
    }
    return null;
}

export function validateFileSize(file, maxBytes, message) {
    if (file && file.size > maxBytes) {
        return message || `El archivo no debe superar ${Math.round(maxBytes / 1024)}KB`;
    }
    return null;
}

/**
 * Ejecuta múltiples validaciones en secuencia.
 * Retorna el primer error encontrado, o null si todas pasan.
 */
export function validateAll(...validations) {
    for (const error of validations) {
        if (error) return error;
    }
    return null;
}

/**
 * Helpers de normalización
 */
export function normalizeText(value) {
    return (value || '').trim().toUpperCase();
}

export function normalizeUsername(value) {
    return (value || '').trim().toLowerCase();
}

export function safeParseFloat(value, fallback = 0) {
    const num = parseFloat(value);
    return isNaN(num) ? fallback : num;
}

export function safeParseInt(value, fallback = 0) {
    const num = parseInt(value, 10);
    return isNaN(num) ? fallback : num;
}
