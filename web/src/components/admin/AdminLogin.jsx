import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket, Eye, EyeOff } from 'lucide-react';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'vola2026';

const AdminLogin = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    setTimeout(() => {
      if (username === ADMIN_USER && password === ADMIN_PASS) {
        localStorage.setItem('admin_auth', 'true');
        navigate('/admin', { replace: true });
      } else {
        setError('Invalid username or password.');
        setLoading(false);
      }
    }, 600);
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <Ticket size={28} />
          <span>Vola<span className="admin-login-dot">.ai</span></span>
        </div>
        <h1 className="admin-login-title">Admin Panel</h1>
        <p className="admin-login-subtitle">Sign in to continue</p>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <div className="admin-login-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
            />
          </div>

          <div className="admin-login-field">
            <label htmlFor="password">Password</label>
            <div className="admin-login-password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="admin-login-eye"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="admin-login-error">{error}</p>}

          <button
            type="submit"
            className="admin-login-submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
