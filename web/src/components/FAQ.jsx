import React, { useState } from 'react';
import '../App.css';

const FAQ = ({ aiTrigger = '@vola' }) => {
  const [openIndex, setOpenIndex] = useState(null);

  const toggle = (i) => setOpenIndex(openIndex === i ? null : i);
  const trigger = aiTrigger || '@vola';

  const faqs = [
    {
      q: "First time setup",
      a: 'Before the chatbot can reply, you must join once. Send: "join declared-daughter".',
    },
    {
      q: "How do I talk to the AI?",
      a: `Start your message with "${trigger}". Example: "${trigger} find me flights to Rome next Friday".`,
    },
    {
      q: "How do I create or join a group?",
      a: 'Send: "JOIN team-force". If the group doesn\'t exist yet, it will be created automatically. Share the code with friends so they can join.',
    },
    {
      q: "How do I leave a group?",
      a: 'Send: "LEAVE team-force" (or just "LEAVE" to leave all groups you\'re in).',
    },
    {
      q: "How does Vola.ai work?",
      a: "Simply send a WhatsApp message describing your trip — destination, dates, budget — and our AI instantly searches across airlines, hotels, and deals to find the best options for you.",
    },
    {
      q: "Is my payment information secure?",
      a: "Yes. All payments are processed through encrypted, PCI-compliant channels. We never store your card details, and you'll receive booking confirmations directly from the airline or hotel.",
    },
    {
      q: "Which airlines and hotels does Vola.ai search?",
      a: "We search across Wizz Air, Ryanair, easyJet, Booking.com, Expedia, and many more — giving you hundreds of options in a single message.",
    },
    {
      q: "What if I need to change or cancel my booking?",
      a: "Just text the same WhatsApp number. Our AI can help you modify or cancel bookings 24/7, subject to the airline or hotel's own cancellation policy.",
    },
    {
      q: "Is there a fee to use Vola.ai?",
      a: "Vola.ai is free to use. We earn a small commission from partners when you book — so you always get transparent pricing with no hidden fees on top.",
    },
  ];

  return (
    <section className="faq-section" id="faq">
      <div className="faq-inner">
        <div className="features-header">
          <h2>Frequently Asked Questions</h2>
          <p>Everything you need to know before your first booking.</p>
        </div>
        <div className="faq-list">
          {faqs.map((item, i) => (
            <div key={i} className={`faq-item ${openIndex === i ? 'faq-open' : ''}`}>
              <button className="faq-question" onClick={() => toggle(i)}>
                <span>{item.q}</span>
                <span className="faq-icon">{openIndex === i ? '−' : '+'}</span>
              </button>
              {openIndex === i && (
                <div className="faq-answer">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;
