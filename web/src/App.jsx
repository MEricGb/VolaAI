import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Public Landing Page Components
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TrustBar from './components/TrustBar';
import Features from './components/Features';
import FAQ from './components/FAQ';
import Footer from './components/Footer';

// Admin Dashboard Components
import AdminLayout from './components/admin/AdminLayout';
import AdminLogin from './components/admin/AdminLogin';
import Dashboard from './components/admin/Dashboard';
import { getPublicConfig } from './lib/api';

const LandingPage = () => {
  const [whatsAppNumber, setWhatsAppNumber] = useState(null);
  const [aiTrigger, setAiTrigger] = useState('@vola');

  useEffect(() => {
    let cancelled = false;

    getPublicConfig()
      .then((config) => {
        if (!cancelled) {
          setWhatsAppNumber(config.whatsappNumber);
          setAiTrigger(config.aiTrigger || '@vola');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWhatsAppNumber(null);
          setAiTrigger('@vola');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-wrapper">
      <Navbar whatsAppNumber={whatsAppNumber} aiTrigger={aiTrigger} />
      <main>
        <Hero whatsAppNumber={whatsAppNumber} aiTrigger={aiTrigger} />
        <TrustBar />
        <Features />
        <FAQ aiTrigger={aiTrigger} />
      </main>
      <Footer />
    </div>
  );
};


// Placeholder components for other admin routes
const AdminPlaceholder = ({ title }) => (
  <div className="admin-card">
    <h2>{title} module coming soon</h2>
    <p>This is a placeholder for the {title} view.</p>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Route */}
        <Route path="/" element={<LandingPage />} />
        
        {/* Admin Login */}
        <Route path="/admin/login" element={<AdminLogin />} />

        {/* Protected Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<AdminPlaceholder title="Users & Conversations" />} />
          <Route path="payments" element={<AdminPlaceholder title="Payments" />} />
          <Route path="settings" element={<AdminPlaceholder title="Settings" />} />
        </Route>
        
        {/* Catch-all redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
