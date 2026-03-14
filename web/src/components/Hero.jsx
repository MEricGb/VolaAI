import React, { useState, useEffect } from 'react';
import { Bot, Send, Search, MessageCircle } from 'lucide-react';
import '../App.css';

const Hero = () => {
  const [messages, setMessages] = useState([
    { text: "Hi! Where would you like to travel today?", user: false },
  ]);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const sequence = [
      { text: "I want to go to Rome next weekend 🍕", user: true, delay: 1500 },
      { text: "Finding the best flights & hotels for Rome...", user: false, delay: 3500, typing: true },
      { text: "Here's a great option: Direct flight via Wizz Air + 3 nights at Hotel Quirinale. Total: €340.", user: false, delay: 5500 },
      { text: "Book it! 🔥", user: true, delay: 7500 },
      { text: "Done! Your boarding passes and itinerary are ready.", user: false, delay: 9500, typing: true }
    ];

    let timeouts = sequence.map((msg) => {
      return setTimeout(() => {
        if (msg.user) {
          setMessages(prev => [...prev.filter(m => !m.isTyping), { text: msg.text, user: true }]);
        } else {
          if (msg.typing) {
            setTyping(true);
            setTimeout(() => {
              setTyping(false);
              setMessages(prev => [...prev, { text: msg.text, user: false }]);
            }, 1000);
          } else {
            setMessages(prev => [...prev.filter(m => !m.isTyping), { text: msg.text, user: false }]);
          }
        }
      }, msg.delay);
    });

    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <section className="hero">
      <div className="hero-content animate-fade-up">
        <span style={{ color: 'var(--color-primary)', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1rem', display: 'block' }}>
          Travel Booking, Reimagined
        </span>
        <h1>Stop searching.<br />Start <span>chatting.</span></h1>
        <p>Book flights, hotels, and entire vacations by just sending a text message on WhatsApp. Our AI hunts down the best Vola deals instantly.</p>
        
        <div className="cta-box">
          <a href="https://wa.me/1234567890?text=Hi!%20I'd%20like%20to%20plan%20a%20trip." target="_blank" rel="noreferrer" className="btn btn-whatsapp">
            <MessageCircle size={24} />
            Chat with AI on WhatsApp
          </a>
          
          <div className="suggested-prompts">
            <p>Try saying:</p>
            <div className="prompts-grid">
              <span className="prompt-pill">"Find cheap flights to Paris"</span>
              <span className="prompt-pill">"Book a hotel in Dubai"</span>
              <span className="prompt-pill">"Weekend getaways under €200"</span>
            </div>
          </div>
        </div>

      </div>

      <div className="hero-visual animate-fade-up" style={{ animationDelay: '0.2s' }}>
        <div className="phone-mockup">
          <div className="phone-header">
            <Bot size={32} />
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
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            )}
          </div>
          <div className="phone-input">
            <div className="phone-input-bar">Message</div>
            <div style={{ background: '#00a884', borderRadius: '50%', padding: '0.6rem', color: 'white', display: 'flex' }}>
              <Send size={18} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
