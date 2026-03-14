import React from 'react';
import { Zap, Headphones, CheckCircle2 } from 'lucide-react';
import '../App.css';

const Features = () => {
  return (
    <section className="features" id="features">
      <div className="features-header">
        <h2>Why book with Vola.ai?</h2>
        <p>The fastest and most convenient way to organize your travels.</p>
      </div>
      
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">
            <Zap size={32} />
          </div>
          <h3>Instant AI Planning</h3>
          <p>Describe your dream vacation in plain English. Our AI analyzes millions of flights and hotels in seconds to find the perfect match.</p>
        </div>
        
        <div className="feature-card">
          <div className="feature-icon">
            <CheckCircle2 size={32} />
          </div>
          <h3>Secure Direct Booking</h3>
          <p>Book directly through our secure WhatsApp integration. No need to visit sketchy third-party sites or enter your credit card repeatedly.</p>
        </div>
        
        <div className="feature-card">
          <div className="feature-icon">
            <Headphones size={32} />
          </div>
          <h3>24/7 Support in Chat</h3>
          <p>Flight delayed? Need to change a reservation? Just text the same WhatsApp number anytime for instant, zero-wait-time assistance.</p>
        </div>
      </div>
    </section>
  );
};

export default Features;
