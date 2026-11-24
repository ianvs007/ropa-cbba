import { describe, it, expect } from 'vitest';
import {
    evaluarAccesoLocalDb,
    esDireccionLoopback,
    hostEsLocal,
    hostSinPuerto,
    tokensIguales,
    extraerToken,
    agregarTokenAUrl,
    normalizarTokenIngresado,
    TOKEN_HEADER,
} from '../utils/localDiskDbAuth';

const TOKEN = 'a'.repeat(48);

const peticion = (extra = {}) => ({
    headers: { host: '192.168.1.20:3001', ...(extra.headers || {}) },
    searchParams: new URLSearchParams(extra.query || ''),
    remoteAddress: extra.remoteAddress ?? '192.168.1.55',
    token: extra.token ?? TOKEN,
    confiarLoopback: extra.confiarLoopback,
});

describe('esDireccionLoopback / hostEsLocal', () => {
    it('reconoce direcciones de la propia máquina', () => {
        expect(esDireccionLoopback('127.0.0.1')).toBe(true);
        expect(esDireccionLoopback('::1')).toBe(true);
        expect(esDireccionLoopback('::ffff:127.0.0.1')).toBe(true);
    });

    it('no confunde IPs de la red local ni valores inválidos', () => {
        expect(esDireccionLoopback('192.168.1.5')).toBe(false);
        expect(esDireccionLoopback('10.0.0.1')).toBe(false);
        expect(esDireccionLoopback(undefined)).toBe(false);
        expect(esDireccionLoopback('')).toBe(false);
    });

    it('hostEsLocal acepta localhost/127.x/[::1] con o sin puerto', () => {
        expect(hostEsLocal('localhost:3001')).toBe(true);
        expect(hostEsLocal('127.0.0.1:3001')).toBe(true);
        expect(hostEsLocal('[::1]:3001')).toBe(true);
        expect(hostEsLocal('LOCALHOST')).toBe(true);
    });

    it('hostEsLocal rechaza dominios externos y la IP de red (anti DNS rebinding)', () => {
        expect(hostEsLocal('evil.example.com:3001')).toBe(false);
        expect(hostEsLocal('localhost.evil.com')).toBe(false);
        expect(hostEsLocal('192.168.1.20:3001')).toBe(false);
        expect(hostEsLocal(undefined)).toBe(false);
    });

    it('hostSinPuerto extrae el nombre', () => {
        expect(hostSinPuerto('Tienda:3001')).toBe('tienda');
        expect(hostSinPuerto('[::1]:3001')).toBe('[::1]');
    });
});

describe('tokensIguales / extraerToken', () => {
    it('compara tokens exactos', () => {
        expect(tokensIguales(TOKEN, TOKEN)).toBe(true);
        expect(tokensIguales(TOKEN, TOKEN.slice(0, -1) + 'b')).toBe(false);
        expect(tokensIguales(TOKEN, TOKEN + 'a')).toBe(false);
        expect(tokensIguales(undefined, TOKEN)).toBe(false);
    });

    it('lee el token de la cabecera, de Authorization Bearer o de ?token=', () => {
        expect(extraerToken({ headers: { [TOKEN_HEADER]: ' abc ' } })).toBe('abc');
        expect(extraerToken({ headers: { authorization: 'Bearer xyz' } })).toBe('xyz');
        expect(extraerToken({ headers: {}, searchParams: new URLSearchParams('token=qq') })).toBe('qq');
        expect(extraerToken({ headers: {} })).toBeNull();
    });
});

describe('evaluarAccesoLocalDb', () => {
    it('falla cerrado si el servidor no tiene token configurado', () => {
        const r = evaluarAccesoLocalDb(peticion({ token: '' }));
        expect(r).toMatchObject({ permitido: false, status: 503 });
        const corto = evaluarAccesoLocalDb(peticion({ token: 'corto' }));
        expect(corto.permitido).toBe(false);
    });

    it('niega una petición de la red sin token (401)', () => {
        expect(evaluarAccesoLocalDb(peticion())).toMatchObject({
            permitido: false,
            status: 401,
            codigo: 'token_requerido',
        });
    });

    it('niega una petición de la red con token incorrecto (401)', () => {
        const r = evaluarAccesoLocalDb(peticion({ headers: { [TOKEN_HEADER]: 'b'.repeat(48) } }));
        expect(r).toMatchObject({ permitido: false, status: 401, codigo: 'token_invalido' });
    });

    it('permite a la red con el token correcto (cabecera, Bearer o query)', () => {
        expect(evaluarAccesoLocalDb(peticion({ headers: { [TOKEN_HEADER]: TOKEN } }))).toEqual({ permitido: true, via: 'token' });
        expect(evaluarAccesoLocalDb(peticion({ headers: { authorization: `Bearer ${TOKEN}` } })).permitido).toBe(true);
        expect(evaluarAccesoLocalDb(peticion({ query: `token=${TOKEN}` })).permitido).toBe(true);
    });

    it('permite la propia máquina sin token (flujo de la central)', () => {
        const r = evaluarAccesoLocalDb(peticion({ remoteAddress: '127.0.0.1', headers: { host: 'localhost:3001' } }));
        expect(r).toEqual({ permitido: true, via: 'loopback' });
    });

    it('si se desactiva la confianza en loopback, también la central necesita token', () => {
        const r = evaluarAccesoLocalDb(peticion({
            remoteAddress: '::1',
            headers: { host: 'localhost:3001' },
            confiarLoopback: false,
        }));
        expect(r).toMatchObject({ permitido: false, status: 401 });
    });

    it('no confía en loopback si el Host no es local (DNS rebinding)', () => {
        const r = evaluarAccesoLocalDb(peticion({ remoteAddress: '127.0.0.1', headers: { host: 'evil.example.com:3001' } }));
        expect(r).toMatchObject({ permitido: false, status: 401 });
    });

    it('bloquea peticiones cross-origin aunque vengan de loopback (CSRF desde otra web)', () => {
        const r = evaluarAccesoLocalDb(peticion({
            remoteAddress: '127.0.0.1',
            headers: { host: 'localhost:3001', origin: 'https://sitio-malicioso.com' },
        }));
        expect(r).toMatchObject({ permitido: false, status: 403, codigo: 'origen_no_permitido' });
    });

    it('bloquea cross-origin incluso con token válido y Origin "null"', () => {
        const r = evaluarAccesoLocalDb(peticion({
            headers: { [TOKEN_HEADER]: TOKEN, origin: 'null' },
        }));
        expect(r.status).toBe(403);
    });

    it('acepta Origin del mismo host (la propia app)', () => {
        const r = evaluarAccesoLocalDb(peticion({
            remoteAddress: '127.0.0.1',
            headers: { host: 'localhost:3001', origin: 'http://localhost:3001' },
        }));
        expect(r.permitido).toBe(true);
    });
});

describe('agregarTokenAUrl / normalizarTokenIngresado', () => {
    it('agrega ?token= o &token= codificado', () => {
        expect(agregarTokenAUrl('/__local_db/stream', 'a b')).toBe('/__local_db/stream?token=a%20b');
        expect(agregarTokenAUrl('/x?y=1', 't')).toBe('/x?y=1&token=t');
    });

    it('sin token deja la URL intacta', () => {
        expect(agregarTokenAUrl('/__local_db/stream', '')).toBe('/__local_db/stream');
        expect(agregarTokenAUrl('/__local_db/stream', null)).toBe('/__local_db/stream');
    });

    it('normaliza espacios y saltos de línea pegados', () => {
        expect(normalizarTokenIngresado('  abc\n def  ')).toBe('abcdef');
        expect(normalizarTokenIngresado(undefined)).toBe('');
    });
});
