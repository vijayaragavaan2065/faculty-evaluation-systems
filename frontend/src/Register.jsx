// src/Register.jsx
import React, { useState } from "react";
import "./Register.css";

const ALLOWED_DEPARTMENTS = [
  "Artificial Intelligence & Data Science",
  "Biomedical Engineering",
  "Chemical Engineering",
  "Civil Engineering",
  "Computer Science and Engineering (AIML)",
  "Computer Science and Engineering (Cyber Security)",
  "Computer Science and Engineering (Business Systems)",
  "Electrical and Electronics Engineering",
  "Electronics and Communication Engineering",
  "Information Technology",
  "Mechanical Engineering",
];

export default function Register({
  apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",
  onRegistered = () => {},
  onSwitchToLogin = () => {}
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("faculty");
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [errors, setErrors] = useState({});

  function validate() {
    const e = {};
    if (!name.trim()) e.name = "Full name is required";
    if (!email.trim()) e.email = "Email is required";
    // basic email regex
    if (email && !/^\S+@\S+\.\S+$/.test(email)) e.email = "Enter a valid email";
    if (!password || password.length < 6) e.password = "Password must be ≥ 6 characters";
    if ((role === "faculty" || role === "hod") && !department) e.department = "Department is required for Faculty and HoD";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);
    if (!validate()) return;

    setLoading(true);
    try {
      const payload = { email, name, password, role };
      if (department) payload.department = department;

      const res = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.detail || data?.message || JSON.stringify(data);
        throw new Error(detail || `Registration failed (${res.status})`);
      }
      setMsg({ type: "success", text: "Registered successfully — please sign in." });
      onRegistered();
    } catch (err) {
      setMsg({ type: "error", text: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="reg-page">
      <nav className="reg-topnav">
        <div className="reg-left">
          <div className="reg-logo">
            <div className="reg-logo-mark" aria-hidden />
            <div className="reg-logo-text">AI Faculty Eval</div>
          </div>
        </div>
        <div className="reg-right">
          <a className="nav-link ghost" href="#" onClick={(e)=>{e.preventDefault(); /* guest flow */}}>Guest</a>
          <a className="nav-link" href="#" onClick={(e)=>{e.preventDefault(); /* goto dashboard*/}}>Dashboard</a>
          <a className="nav-link ghost" href="#" onClick={(e)=>{e.preventDefault(); /* profile */}}>Profile</a>
          <button className="nav-btn ghost" onClick={() => { localStorage.removeItem("token"); window.location.reload(); }}>Logout</button>
        </div>
      </nav>

      <div className="reg-viewport">
        <div className="reg-card" role="region" aria-labelledby="register-heading">
          <header className="reg-card-header">
            <div>
              <h1 id="register-heading" className="reg-title">Create your account</h1>
              <p className="reg-sub">Register to submit KPIs and receive AI-enabled feedback.</p>
            </div>
            <div className="reg-card-brand">
              <div className="brand-mark" />
              <div className="brand-text">AI Faculty Eval</div>
            </div>
          </header>

          <form className="reg-form" onSubmit={handleSubmit} noValidate>
            <label className="field-label">Full name</label>
            <input
              className={`field ${errors.name ? "field-error" : ""}`}
              placeholder="e.g., Dr. Priya Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "err-name" : undefined}
            />
            {errors.name && <div id="err-name" className="field-err-text">{errors.name}</div>}

            <label className="field-label">Email</label>
            <input
              type="email"
              className={`field ${errors.email ? "field-error" : ""}`}
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "err-email" : undefined}
            />
            {errors.email && <div id="err-email" className="field-err-text">{errors.email}</div>}

            <label className="field-label">Password</label>
            <input
              type="password"
              className={`field ${errors.password ? "field-error" : ""}`}
              placeholder="Create a secure password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "err-pass" : undefined}
            />
            {errors.password && <div id="err-pass" className="field-err-text">{errors.password}</div>}

            <div className="row-grid">
              <div>
                <label className="field-label">Role</label>
                <select className="field" value={role} onChange={(e)=>{ setRole(e.target.value); if(!(e.target.value==="faculty"||e.target.value==="hod")) setDepartment(""); }}>
                  <option value="faculty">Faculty</option>
                  <option value="hod">HoD</option>
                  <option value="director">Director</option>
                  <option value="registrar">Registrar</option>
                  <option value="office_head">Office Head</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="field-label">Department { (role==="faculty"||role==="hod") && <span className="required-tag">required</span> }</label>
                <div className={`custom-select ${errors.department ? "field-error" : ""}`}>
                  <select
                    className="field"
                    value={department}
                    onChange={(e)=>setDepartment(e.target.value)}
                    disabled={!(role==="faculty"||role==="hod")}
                    aria-invalid={!!errors.department}
                    aria-describedby={errors.department ? "err-dept" : undefined}
                  >
                    <option value="">{role==="faculty"||role==="hod" ? "Select department" : " — optional — "}</option>
                    {ALLOWED_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {errors.department && <div id="err-dept" className="field-err-text">{errors.department}</div>}
              </div>
            </div>

            <div style={{height:8}} />

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Registering…" : "Register"}
            </button>

            <div className="form-foot">
              <button type="button" className="btn-link" onClick={onSwitchToLogin}>Back to Sign In</button>
            </div>

            {msg && (
              <div className={`form-msg ${msg.type === "error" ? "err" : "ok"}`} role="status">
                {msg.text}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
