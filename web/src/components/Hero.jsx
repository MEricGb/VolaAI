import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, MessageCircle } from 'lucide-react';
import '../App.css';

const waLink = (number, text) =>
  `https://wa.me/${number.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;

const withTrigger = (trigger, text) =>
  (trigger ? `${trigger} ${text}` : text).trim();

const Hero = ({ whatsAppNumber, aiTrigger }) => {
  const [messages, setMessages] = useState([
    { text: "Hi! Where would you like to travel today?", user: false },
  ]);
  const [typing, setTyping] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const innerTimeouts = useRef([]);

  useEffect(() => {
    const sequence = [
      { text: "I want to go to Rome next weekend 🍕", user: true, delay: 1500 },
      { text: "Finding the best flights & hotels for Rome...", user: false, delay: 3500, typing: true },
      { text: "Direct flight via Wizz Air + 3 nights Hotel Quirinale. Total: €340.", user: false, delay: 5500 },
      { text: "Book it! 🔥", user: true, delay: 7500 },
      { text: "Done! Boarding passes sent to your WhatsApp.", user: false, delay: 9500, typing: true, isLast: true },
    ];

    const outerTimeouts = sequence.map((msg) =>
      setTimeout(() => {
        if (msg.user) {
          setMessages(prev => [...prev, { text: msg.text, user: true }]);
        } else if (msg.typing) {
          setTyping(true);
          const t = setTimeout(() => {
            setTyping(false);
            setMessages(prev => [...prev, { text: msg.text, user: false }]);
            if (msg.isLast) {
              setTimeout(() => setShowSuccess(true), 500);
            }
          }, 1000);
          innerTimeouts.current.push(t);
        } else {
          setMessages(prev => [...prev, { text: msg.text, user: false }]);
        }
      }, msg.delay)
    );

    return () => {
      outerTimeouts.forEach(clearTimeout);
      innerTimeouts.current.forEach(clearTimeout);
    };
  }, []);

  return (
    <section className="hero">
      {/* Travel route illustration in background */}
      <svg className="hero-travel-routes" viewBox="0 0 1400 500" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
        <defs>
          {/* Realistic plane silhouette */}
          <g id="plane-icon">
            <path d="M12 0 L10 -1.5 L6 -1.5 L2 -7 L0 -7 L2.5 -1.5 L-2 -1.5 L-3.5 -3.5 L-5 -3.5 L-3.5 -0.5 L-5 0 L-3.5 0.5 L-5 3.5 L-3.5 3.5 L-2 1.5 L2.5 1.5 L0 7 L2 7 L6 1.5 L10 1.5 Z" fill="rgba(255,255,255,0.75)" />
          </g>
        </defs>

        {/* Route 1: sweeps from top-left across to top-right */}
        <path id="route1" className="route-line route-line-1" d="M30 80 C200 30, 350 180, 550 120 C750 60, 900 160, 1100 80 C1200 50, 1300 90, 1380 60" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="8 6" fill="none" />

        {/* Route 2: middle — left to right with big curves */}
        <path id="route2" className="route-line route-line-2" d="M0 320 C150 250, 250 380, 450 300 C650 220, 700 350, 900 280 C1050 230, 1150 310, 1350 250" stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeDasharray="8 6" fill="none" />

        {/* Route 3: bottom curve spanning full width */}
        <path id="route3" className="route-line route-line-3" d="M80 460 C250 400, 400 480, 600 430 C800 380, 950 460, 1150 410 C1280 380, 1350 430, 1400 420" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeDasharray="8 6" fill="none" />

        {/* Destination pins along routes */}
        <g className="route-pin pin-1"><circle cx="30" cy="80" r="6" fill="rgba(255,255,255,0.3)" /><circle cx="30" cy="80" r="3" fill="white" /></g>
        <g className="route-pin pin-2"><circle cx="550" cy="120" r="6" fill="rgba(255,255,255,0.3)" /><circle cx="550" cy="120" r="3" fill="white" /></g>
        <g className="route-pin pin-3"><circle cx="1100" cy="80" r="6" fill="rgba(255,255,255,0.3)" /><circle cx="1100" cy="80" r="3" fill="white" /></g>
        <g className="route-pin pin-4"><circle cx="450" cy="300" r="6" fill="rgba(255,255,255,0.25)" /><circle cx="450" cy="300" r="3" fill="white" /></g>
        <g className="route-pin pin-5"><circle cx="900" cy="280" r="6" fill="rgba(255,255,255,0.25)" /><circle cx="900" cy="280" r="3" fill="white" /></g>
        <g className="route-pin pin-6"><circle cx="1350" cy="250" r="6" fill="rgba(255,255,255,0.25)" /><circle cx="1350" cy="250" r="3" fill="white" /></g>
        <g className="route-pin pin-7"><circle cx="600" cy="430" r="6" fill="rgba(255,255,255,0.2)" /><circle cx="600" cy="430" r="3" fill="white" /></g>
        <g className="route-pin pin-8"><circle cx="1150" cy="410" r="6" fill="rgba(255,255,255,0.2)" /><circle cx="1150" cy="410" r="3" fill="white" /></g>

        {/* Plane 1 — travels along route 1 */}
        <g transform="scale(1.6)">
          <use href="#plane-icon">
            <animateMotion dur="12s" repeatCount="indefinite" rotate="auto">
              <mpath href="#route1" />
            </animateMotion>
          </use>
        </g>

        {/* Plane 2 — travels along route 2 */}
        <g opacity="0.85" transform="scale(1.4)">
          <use href="#plane-icon">
            <animateMotion dur="15s" repeatCount="indefinite" rotate="auto" begin="3s">
              <mpath href="#route2" />
            </animateMotion>
          </use>
        </g>

        {/* Plane 3 — travels along route 3 */}
        <g opacity="0.7" transform="scale(1.2)">
          <use href="#plane-icon">
            <animateMotion dur="18s" repeatCount="indefinite" rotate="auto" begin="5s">
              <mpath href="#route3" />
            </animateMotion>
          </use>
        </g>
      </svg>

      {/* Left: headline + CTA card */}
      <div className="hero-content animate-fade-up">
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-dot" />
          3,200+ trips booked
        </div>

        <h1>
          One message.<br />
          Your trip, <span>sorted.</span>
        </h1>

        <p>
          Tell us where you want to go on WhatsApp.
          We handle flights, hotels and everything in between — in seconds.
        </p>

        <div className="cta-box">
          <a
            href={
              whatsAppNumber
                ? waLink(
                    whatsAppNumber,
                    withTrigger(aiTrigger, "Hi! I'd like to plan a trip."),
                  )
                : '#'
            }
            target="_blank"
            rel="noreferrer"
            className="btn-whatsapp"
            aria-disabled={!whatsAppNumber}
            onClick={(event) => {
              if (!whatsAppNumber) {
                event.preventDefault();
              }
            }}
          >
            <MessageCircle size={20} />
            Start planning on WhatsApp
          </a>

          <a href="#faq" className="btn-instructions">
            INSTRUCTIONS FIRST!
          </a>

          <div className="suggested-prompts">
            <p>Try saying:</p>
            <div className="prompts-grid">
              {[
                'Fly me to Rome next Friday',
                'Cheap flights to Dubai under €150',
                'Weekend in Paris, 2 people',
              ].map((prompt, idx) => (
                <a
                  key={prompt}
                  href={
                    whatsAppNumber
                      ? waLink(whatsAppNumber, withTrigger(aiTrigger, prompt))
                      : '#'
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="prompt-pill"
                  aria-disabled={!whatsAppNumber}
                  onClick={(event) => {
                    if (!whatsAppNumber) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span className="prompt-index" aria-hidden="true">
                    {idx + 1}
                  </span>
                  <span className="prompt-text">"{prompt}"</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="hero-social-proof">
          <span className="hero-stars">★★★★★</span>
          <span>Rated 4.9 by early users</span>
        </div>
      </div>

      {/* Right: animated phone */}
      <div className="hero-visual animate-fade-up" style={{ animationDelay: '0.15s' }}>
        {/* Success bubble moved outside mockup for cleaner layering */}
        {/* Comic bubble — outside phone-mockup to avoid overflow clip */}
        {showSuccess && (
          <div className="comic-bubble">
            <div className="comic-bubble-inner">
              <div className="comic-bubble-icon">✓</div>
              <div className="comic-bubble-text">
                <strong>Order Confirmed!</strong>
                <span>Rome • 2 Adults • €340</span>
              </div>
            </div>
            <div className="comic-tail-dot-1" />
            <div className="comic-tail-dot-2" />
          </div>
        )}

        <div className="phone-mockup">
          <div className="phone-header">
            <Bot size={26} />
            <div className="phone-header-info">
              <span className="phone-header-name">Vola AI Assistant</span>
              <span className="phone-header-status">online</span>
            </div>
          </div>
          <div className="phone-body">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.user ? 'msg-sent' : 'msg-recv'}`}>
                {msg.text}
              </div>
            ))}
            {typing && (
              <div className="msg-typing">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            )}
          </div>
          <div className="phone-input">
            <div className="phone-input-bar">Message</div>
            <div style={{ background: '#00a884', borderRadius: '50%', padding: '0.5rem', color: 'white', display: 'flex' }}>
              <Send size={16} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
