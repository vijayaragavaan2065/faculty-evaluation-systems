// src/components/Sidebar.jsx
import React from "react";
import "./Dashboard.css";

export default function Sidebar({ onNavigate }) {
  return (
    <aside className="sidebar" style={{ width: 260, minWidth: 260 }}>
      <div className="sidebar-inner" style={{ padding: 18 }}>
        <div style={{ marginBottom: 12 }}>
          <strong style={{ color: "#205067", fontSize: 16 }}>AI Faculty Eval</strong>
          <div style={{ color: "#617882", fontSize: 12 }}>Academic tools</div>
        </div>

        <div className="nav-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => onNavigate("dashboard")} className="nav-item">Dashboard</button>
          <button onClick={() => onNavigate("new")} className="nav-item">+ New Submission</button>
          <button onClick={() => onNavigate("submissions")} className="nav-item">My Submissions</button>
          <button onClick={() => onNavigate("feedback")} className="nav-item disabled">AI Feedback</button>
        </div>

        <div style={{ marginTop: 18, color: "#9aaab3", fontSize: 12 }}>
          © {new Date().getFullYear()} AI Faculty Eval
        </div>
      </div>
    </aside>
  );
}
