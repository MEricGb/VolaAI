import React from 'react';
import { Plane } from 'lucide-react';
import '../App.css';

const Footer = () => (
  <footer className="footer">
    <div className="container">
      <div className="footer-brand">
        <Plane size={20} color="#ffc52a" />
        Vola<span style={{ color: '#ffc52a' }}>.ai</span>
      </div>
      <p className="footer-tagline">Travel by text. No apps. No nonsense.</p>

      <div className="footer-links">
        <a href="#">About</a>
        <a href="#">How it Works</a>
        <a href="#">Privacy Policy</a>
        <a href="#">Terms of Service</a>
      </div>

      <p className="footer-copy">
        &copy; {new Date().getFullYear()} Vola.ai — Not affiliated with Vola.ro.
      </p>
    </div>
  </footer>
);

export default Footer;
