import React from 'react';
import { ShieldCheck } from 'lucide-react';
import '../App.css';

const TrustBar = () => {
  return (
    <section className="trust-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <ShieldCheck color="#00a884" size={20} />
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Trusted by 10,000+ travelers on WhatsApp</span>
      </div>
      <div className="trust-logos">
        <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>Wizz Air</span>
        <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>RYANAIR</span>
        <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>Booking.com</span>
        <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>Expedia</span>
      </div>
    </section>
  );
};

export default TrustBar;
