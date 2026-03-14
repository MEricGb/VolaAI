import React from 'react';
import { Plane } from 'lucide-react';
import '../App.css';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <div className="nav-brand" style={{ color: 'white' }}>
            <Plane size={24} color="#ffb700" />
            <span>Vola<span style={{color: '#ffb700'}}>.ai</span></span>
          </div>
        </div>
        
        <div className="footer-content">
          <a href="#">About Us</a>
          <a href="#">How it Works</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
        
        <p style={{ opacity: 0.6, fontSize: '0.875rem' }}>
          &copy; {new Date().getFullYear()} Vola.ai. All rights reserved. Not affiliated with Vola.ro.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
