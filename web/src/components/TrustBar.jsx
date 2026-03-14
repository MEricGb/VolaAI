import React from 'react';
import '../App.css';

const partners = ['Wizz Air', 'Ryanair', 'Booking.com', 'Expedia', 'easyJet'];

const TrustBar = () => (
  <section className="trust-bar">
    <p className="trust-bar-label">Searches across</p>
    <div className="trust-logos">
      {partners.map((name, i) => (
        <React.Fragment key={name}>
          <span className="trust-logo-name">{name}</span>
          {i < partners.length - 1 && <span className="trust-sep" aria-hidden="true" />}
        </React.Fragment>
      ))}
    </div>
  </section>
);

export default TrustBar;

