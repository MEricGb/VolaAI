import React from 'react';
import { Plane, Menu } from 'lucide-react';
import '../App.css';

const Navbar = () => {
  return (
    <nav className="navbar">
      <div className="nav-brand">
        <Plane className="text-primary" size={28} />
        <span>Vola<span style={{color: '#ffb700'}}>.ai</span></span>
      </div>
      
      <div className="nav-links">
        <a href="#how" className="nav-link">How it works</a>
        <a href="#features" className="nav-link">Features</a>
        <a href="#faq" className="nav-link">FAQ</a>
        <button className="btn btn-primary">Try it Free</button>
      </div>

      <div className="mobile-menu" style={{ display: 'none' }}>
        <Menu size={24} />
      </div>
    </nav>
  );
};

export default Navbar;
