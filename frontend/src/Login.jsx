// src/Login.jsx
import React, { useState } from "react";
import "./Login.css";
import collegeLogo from "./assets/college-logo.png"; // ensure the file is at src/assets/college-logo.png

export default function Login({
  apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",
  onLoginSuccess = () => {},
  onSwitchToRegister = () => {}
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);

    if (!email || !password) {
      setMsg({ type: "error", text: "Please enter both email and password." });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data?.detail || data?.message || `Sign in failed (${res.status})`;
        throw new Error(err);
      }
      const token = data.access_token || data.access || data.token || null;
      if (!token) throw new Error("No token returned from server");
      localStorage.setItem("token", token);
      setMsg({ type: "ok", text: "Signed in — redirecting…" });
      onLoginSuccess();
    } catch (err) {
      setMsg({ type: "error", text: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Left panel */}
        <aside className="left-panel" aria-hidden={false}>
          <div className="left-inner">
            <div className="logo-block">
              <img src={collegeLogo} alt="KPRIET logo" className="logo-mark" />
              <div className="logo-text">
                <div className="brand-title">AI Faculty Eval</div>
                <div className="brand-sub">AI-powered faculty evaluation</div>
              </div>
            </div>

            <h1 className="hero-title">AI-Powered<br/>Faculty Evaluation</h1>
            <p className="hero-sub">Smart evaluation • AI feedback • Role-based review</p>

            <div className="feature-cards">
              <div className="card feature-card">
                <div className="card-icon"></div>
                <div className="card-text">
                  <div className="card-title">Smart Evaluation</div>
                  <div className="card-desc">Automated scoring and fairness checks</div>
                </div>
              </div>

              <div className="card feature-card">
                <div className="card-icon"></div>
                <div className="card-text">
                  <div className="card-title">Secure Roles</div>
                  <div className="card-desc">Role-based access & audit trails</div>
                </div>
              </div>

              <div className="card feature-card optional">
                <div className="card-icon"></div>
                <div className="card-text">
                  <div className="card-title">AI Insights</div>
                  <div className="card-desc">Actionable analytics for departments</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right panel (login) */}
        <main className="right-panel" aria-label="Sign in">
          <div className="login-card" role="form" aria-labelledby="login-heading">
            <div className="login-card-top">
              <img src={collegeLogo} alt="KPRIET small" className="small-mark" />
              <h2 id="login-heading" className="login-heading">Welcome back</h2>
              <p className="login-sub muted">Sign in to access your dashboard</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                placeholder="you@institution.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />

              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              <button type="submit" className="signin-btn" disabled={loading}>
                {loading ? "Signing in…" : "Sign In"}
              </button>

              <div className="below-row">
                <button type="button" className="link-btn" onClick={onSwitchToRegister}>Register</button>
                <a className="muted small" href="#" onClick={(e)=>e.preventDefault()} aria-hidden>Forgot?</a>
              </div>

              {msg && (
                <div className={`form-msg ${msg.type === "error" ? "err" : "ok"}`} role="status">
                  {msg.text}
                </div>
              )}
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
