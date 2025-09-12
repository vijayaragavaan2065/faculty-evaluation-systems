// src/components/Header.jsx
import React, { useState } from "react";
import "./Header.css";
import logo from "../assets/college-logo.png";

export default function Header({ user = {}, onNavigate = () => {}, onLogout = () => {} }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const role = (user?.role || "faculty").toString().toLowerCase();

  const title =
    role === "registrar" || role === "admin"
      ? "University KPI Portal"
      : role === "hod"
      ? "Department KPI Portal"
      : "AI Faculty Eval";

  const academicYear = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const start = month >= 6 ? year : year - 1;
    return `${start}-${start + 1}`;
  })();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="hamburger" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}>
          <span className="hb-line" />
          <span className="hb-line" />
          <span className="hb-line" />
        </button>

        <div className="brand" onClick={() => onNavigate("dashboard")} role="button">
          <img src={logo} alt="logo" className="brand-logo" />
          <div className="brand-text">
            <div className="brand-title">{title}</div>
            <div className="brand-sub">Academic Year {academicYear}</div>
          </div>
        </div>
      </div>

      <div className="topbar-right">
        <div className="user-info">
          <div className="user-name">{user?.name ?? user?.username ?? "Guest"}</div>
          <div className="user-role">{(user?.role || "").toString().toUpperCase()}</div>
        </div>

        <nav className={`top-actions ${menuOpen ? "open" : ""}`}>
          <button className="btn btn-ghost" onClick={() => onNavigate("dashboard")}>Dashboard</button>
          <button className="btn btn-ghost" onClick={() => onNavigate("profile")}>Profile</button>
          <button className="btn btn-primary" onClick={() => onLogout()}>Logout</button>
        </nav>
      </div>
    </header>
  );
}
