import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider, useUser } from './contexts/UserContext';
import { hasPermission, PERMISSIONS } from './utils/permissions';

// Layout & Auth
import Layout from './components/Layout';
import Login from './components/Login';

// Módulos principales
import POS from './components/POS';
import SalesHistory from './components/SalesHistory';
import CashClose from './components/CashClose';
import Expenses from './components/Expenses';

// Inventario
import ProductList from './components/ProductList';
import Inventory from './components/Inventory';
import Kardex from './components/Kardex';

// Reportes
import Dashboard from './components/reports/Dashboard';
import MonthlyReport from './components/reports/MonthlyReport';

// Sistema
import Users from './components/Users';
import Settings from './components/Settings';
import Backup from './components/Backup';
import ProductOptions from './components/ProductOptions';
import MassLabeling from './components/MassLabeling';

// Reservas
import Reservations from './components/Reservations';

/**
 * AppRoutes — Renderiza rutas cuando el usuario está autenticado.
 * Separado de App para poder usar useUser() dentro del Provider.
 */
function AppRoutes() {
  const { user } = useUser();

  if (!user) return <Login />;

  const isAdmin = user.role === 'admin';

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          {/* Ruta raíz: admin → dashboard | vendedor → POS */}
          <Route
            path="/"
            element={isAdmin ? <Navigate to="/dashboard" replace /> : <POS />}
          />

          {/* ── Rutas por Rol ── */}
          {isAdmin ? (
            <>
              <Route path="/monthly-report" element={<MonthlyReport />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/sales" element={<SalesHistory />} />
              <Route path="/products" element={hasPermission(user, PERMISSIONS.EDIT_PRODUCTS) ? <ProductList /> : <Navigate to="/dashboard" replace />} />
              <Route path="/product-options" element={hasPermission(user, PERMISSIONS.EDIT_PRODUCTS) ? <ProductOptions /> : <Navigate to="/dashboard" replace />} />
              <Route path="/mass-labeling" element={hasPermission(user, PERMISSIONS.EDIT_PRODUCTS) ? <MassLabeling /> : <Navigate to="/dashboard" replace />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/kardex" element={<Kardex />} />
              <Route path="/users" element={hasPermission(user, PERMISSIONS.MANAGE_USERS) ? <Users /> : <Navigate to="/dashboard" replace />} />
              <Route path="/settings" element={hasPermission(user, PERMISSIONS.SETTINGS) ? <Settings /> : <Navigate to="/dashboard" replace />} />
              <Route path="/backup" element={hasPermission(user, PERMISSIONS.BACKUP) ? <Backup /> : <Navigate to="/dashboard" replace />} />
              <Route path="/expenses" element={<Expenses />} />

              {/* Rutas antiguas/no permitidas para admin → dashboard */}
              <Route path="/cash" element={<Navigate to="/dashboard" replace />} />
              <Route path="/data-integrity" element={<Navigate to="/dashboard" replace />} />
              <Route path="/pos" element={<Navigate to="/dashboard" replace />} />
              <Route path="/reservations" element={<Navigate to="/dashboard" replace />} />
            </>
          ) : (
            <>
              <Route path="/pos" element={<POS />} />
              <Route path="/cash" element={<CashClose />} />
              <Route path="/sales" element={<SalesHistory />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/reservations" element={<Reservations />} />

              {/* Rutas no permitidas para vendedor → POS */}
              <Route path="/dashboard" element={<Navigate to="/pos" replace />} />
              <Route path="/monthly-report" element={<Navigate to="/pos" replace />} />
              <Route path="/products" element={<Navigate to="/pos" replace />} />
              <Route path="/product-options" element={<Navigate to="/pos" replace />} />
              <Route path="/mass-labeling" element={<Navigate to="/pos" replace />} />
              <Route path="/inventory" element={<Navigate to="/pos" replace />} />
              <Route path="/kardex" element={<Navigate to="/pos" replace />} />
              <Route path="/users" element={<Navigate to="/pos" replace />} />
              <Route path="/settings" element={<Navigate to="/pos" replace />} />
              <Route path="/backup" element={<Navigate to="/pos" replace />} />
              <Route path="/data-integrity" element={<Navigate to="/pos" replace />} />
            </>
          )}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

/**
 * App — Componente raíz. Envuelve todo en UserProvider.
 */
function App() {
  return (
    <UserProvider>
      <AppRoutes />
    </UserProvider>
  );
}

export default App;
