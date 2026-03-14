import React, { useState, useEffect } from 'react';
import { Plane, Menu, X } from 'lucide-react';
import '../App.css';

const waLink = (number) => `https://wa.me/${number.replace(/^\+/, '')}`;

const Navbar = ({ whatsAppNumber }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const close = () => setMenuOpen(false);

  return (
    <nav className={`navbar ${scrolled ? 'navbar-scrolled' : ''}`}>
      <div className="nav-brand">
        <Plane size={20} />
        Vola<span className="nav-brand-dot">.ai</span>
      </div>

      <div className="nav-links">
        <a href="#features" className="nav-link">Features</a>
        <a href="#faq" className="nav-link">FAQ</a>
        <a
          href={whatsAppNumber ? waLink(whatsAppNumber) : '#'}
          target="_blank"
          rel="noreferrer"
          className="btn btn-cta"
          style={{ fontSize: '0.85rem', padding: '0.55rem 1.25rem' }}
          aria-disabled={!whatsAppNumber}
          onClick={(event) => {
            if (!whatsAppNumber) {
              event.preventDefault();
            }
          }}
        >
          Try it Free
        </a>
      </div>

      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen(o => !o)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {menuOpen && (
        <div className="mobile-nav-dropdown">
          <a href="#features" className="nav-link" onClick={close}>Features</a>
          <a href="#faq" className="nav-link" onClick={close}>FAQ</a>
          <a
            href={whatsAppNumber ? waLink(whatsAppNumber) : '#'}
            target="_blank"
            rel="noreferrer"
            className="btn btn-cta"
            style={{ fontSize: '0.9rem', padding: '0.65rem 1.5rem', width: 'fit-content' }}
            aria-disabled={!whatsAppNumber}
            onClick={(event) => {
              if (!whatsAppNumber) {
                event.preventDefault();
              }
              close();
            }}
          >
            Try it Free
          </a>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
