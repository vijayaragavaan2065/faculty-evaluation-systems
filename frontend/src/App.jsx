// src/App.jsx
import { useEffect, useState } from "react";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import Login from "./Login";
import Register from "./Register";
import "./index.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function App() {
  const [view, setView] = useState("login"); // "login" | "register" | "dashboard"
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("token") || localStorage.getItem("access");
    if (!token) return;
    fetchProfile();
    // eslint-disable-next-line
  }, []);

  async function fetchProfile() {
    const token = localStorage.getItem("token") || localStorage.getItem("access");
    if (!token) return setUser(null);
    try {
      const res = await fetch(`${API_BASE}/api/users/me`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) {
        localStorage.removeItem("token");
        localStorage.removeItem("access");
        setUser(null);
        setView("login");
        return;
      }
      const data = await res.json();
      // normalize role to lowercase string for easy comparison
      if (data && data.role) data.role = String(data.role).toLowerCase();
      setUser(data);
      setView("dashboard");
    } catch (e) {
      console.error("Profile fetch failed", e);
      setUser(null);
      setView("login");
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("access");
    setUser(null);
    setView("login");
  }

  return (
    <div className="app-root">
      <Header
        user={user}
        onNavigate={(v) => {
          if (v === "dashboard") setView("dashboard");
        }}
        onLogout={() => {
          handleLogout();
        }}
      />

      <main className="app-main">
        {view === "login" && (
          <Login
            apiBase={API_BASE}
            onLoginSuccess={() => {
              fetchProfile();
              setView("dashboard");
            }}
            onSwitchToRegister={() => setView("register")}
          />
        )}
        {view === "register" && (
          <Register
            apiBase={API_BASE}
            onRegistered={() => {
              setView("login");
            }}
            onSwitchToLogin={() => setView("login")}
          />
        )}
        {view === "dashboard" && <Dashboard apiBase={API_BASE} user={user} />}
      </main>

      <footer className="app-footer" />
    </div>
  );
}
