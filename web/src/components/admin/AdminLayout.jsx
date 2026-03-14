import React, { useState } from 'react';
import { Outlet, Navigate, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, CreditCard, Settings, LogOut, Ticket } from 'lucide-react';
import './admin.css';

const AdminLayout = () => {
  // Temporary auth state mock
  const [isAuthenticated, setIsAuthenticated] = useState(true);

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="admin-layout">
      {/* Sidebar Navigation */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Ticket className="text-primary" size={24} />
          <span>Vola<span style={{ color: 'var(--color-accent)' }}>.ai</span> Admin</span>
        </div>
        
        <nav className="admin-nav">
          <NavLink 
            to="/admin" 
            end 
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <LayoutDashboard size={20} /> Dashboard
          </NavLink>
          <NavLink 
            to="/admin/users" 
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <Users size={20} /> Users & Convs
          </NavLink>
          <NavLink 
            to="/admin/payments" 
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <CreditCard size={20} /> Payments
          </NavLink>
          <NavLink 
            to="/admin/settings" 
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          >
            <Settings size={20} /> Settings
          </NavLink>
        </nav>

        <div className="admin-logout">
          <button 
            className="admin-nav-item" 
            onClick={() => setIsAuthenticated(false)}
            style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <LogOut size={20} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="admin-main">
        <header className="admin-header">
          <h2>Overview</h2>
          <div className="admin-profile">
            <div className="admin-avatar">A</div>
            <span>Admin User</span>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
