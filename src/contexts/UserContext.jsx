import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import useSessionTimeout from '../hooks/useSessionTimeout';

const SESSION_KEY = 'ropa_user';
const UserContext = createContext(null);

export function UserProvider({ children }) {
    const [user, setUser] = useState(null);

    useEffect(() => {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
            try {
                setUser(JSON.parse(stored));
            } catch {
                sessionStorage.removeItem(SESSION_KEY);
            }
        }
    }, []);

    const login = useCallback((u) => {
        setUser(u);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        sessionStorage.removeItem(SESSION_KEY);
    }, []);

    useSessionTimeout(logout);

    return (
        <UserContext.Provider value={{ user, login, logout }}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const ctx = useContext(UserContext);
    if (!ctx) throw new Error('useUser debe usarse dentro de <UserProvider>');
    return ctx;
}
