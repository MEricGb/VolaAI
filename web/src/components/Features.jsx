import React from 'react';
import { Zap, Headphones, CheckCircle2 } from 'lucide-react';
import '../App.css';

const Features = () => {
  return (
    <section className="features" id="features">
      <div className="features-header">
        <h2>Built different.</h2>
        <p>No apps to download. No accounts to create. Just WhatsApp.</p>
      </div>
      
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">
            <Zap size={28} />
          </div>
          <h3>Describe it, done.</h3>
          <p>Say "weekend in Barcelona under €400" and get real options. Our AI parses natural language — no dropdowns, no filters.</p>
        </div>
        
        <div className="feature-card">
          <div className="feature-icon">
            <CheckCircle2 size={28} />
          </div>
          <h3>Book in one reply.</h3>
          <p>Tap confirm. That's it. No card re-entry, no sketchy redirects. Your booking is confirmed in the same chat thread.</p>
        </div>
        
        <div className="feature-card">
          <div className="feature-icon">
            <Headphones size={28} />
          </div>
          <h3>Always there.</h3>
          <p>Flight delayed at 2am? Gate changed? Text us. Same number, same chat — instant response, any time zone.</p>
        </div>
      </div>
    </section>
  );
};

export default Features;
