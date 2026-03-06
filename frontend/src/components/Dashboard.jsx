/* src/components/Dashboard.jsx
   Restored original Dashboard content (as previously provided).
*/
import React, { useEffect, useState } from "react";
import SubmissionForm from "../SubmissionForm";
import SubmissionsList from "../SubmissionsList";
import ReportsAnalytics from "./ReportsAnalytics"; // <-- shows AI feedback & analytics
import "./Dashboard.css";

/**
 * Final Dashboard.jsx (updated)
 * - For admin-like roles the "All Department Submissions" action is placed before "AI Insights Dashboard"
 * - Keeps "My Submissions" for HOD, department-locked view for HOD, and admin actions intact
 */

function StatCard({ title, value, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-row">
        <div className="stat-icon">{icon}</div>
        <div>
          <div className="stat-title">{title}</div>
          <div className="stat-value">{value}</div>
        </div>
      </div>
    </div>
  );
}

// --- helper functions ---
function findAuthToken() {
  const keys = ["token", "access", "access_token", "auth_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  try {
    const u = localStorage.getItem("user");
    if (u) {
      const parsed = JSON.parse(u);
      if (parsed?.token) return parsed.token;
      if (parsed?.access_token) return parsed.access_token;
    }
  } catch {
    return null;
  }
  return null;
}

function getUserId(user) {
  return user?._id || user?.id || user?.email || null;
}

export default function Dashboard({ apiBase = "http://127.0.0.1:8000", user }) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [view, setView] = useState("dashboard");
  const [stats, setStats] = useState({ total: 0, avgScore: "—", pending: 0, approved: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");

  // Build headers for backend
  function buildHeaders() {
    const token = findAuthToken();
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  async function loadStats() {
    setLoadingStats(true);
    setStatsError("");
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/submissions/stats`, {
        headers: buildHeaders(),
        credentials: "include",
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        console.error("Stats fetch error:", res.status, data);
        if (res.status === 401 || res.status === 403) {
          setStatsError("Unauthorized. Please log in again.");
        } else {
          setStatsError(`Failed to load stats (${res.status}).`);
        }
        return;
      }

      setStats({
        total: data.total_submissions ?? 0,
        avgScore: data.avg_score ? `${data.avg_score} / 100` : "—",
        pending: data.pending_reviews ?? 0,
        approved: data.approved ?? 0,
      });
    } catch (err) {
      console.error("loadStats error:", err);
      setStatsError("Error fetching statistics. See console for details.");
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    if (user) loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // normalize role (lowercase)
  const role = (user?.role || "faculty").toString().toLowerCase();

  // Higher-level role flags
  const IS_HOD = role === "hod";
  const IS_FACULTY = role === "faculty";
  const IS_ADMIN_LIKE = ["registrar", "admin", "director", "office_head"].includes(role);

  // --- actions / buttons
  // For admin-like: put "All Department Submissions" before "AI Insights Dashboard"
  const actions = IS_FACULTY
    ? [
        { label: "New Form", view: "new-form", style: "mix" },
        { label: "My Submissions", view: "my-submissions", style: "green" },
        { label: "Upload Proofs", view: "upload-proofs", style: "mix" },
        { label: "AI Feedback", view: "ai-feedback", style: "green" },
      ]
    : IS_HOD
    ? [
        { label: "New Form", view: "new-form", style: "mix" },
        { label: "My Submissions", view: "my-submissions", style: "green" }, // HOD should see own submissions
        { label: "Department Submissions", view: "department-submissions", style: "mix" },
        { label: "Department AI Analysis", view: "department-ai", style: "green" },
      ]
    : // admin-like: moved "All Department Submissions" first
      [
        { label: "All Department Submissions", view: "all-department-submissions", style: "mix" },
        { label: "AI Insights Dashboard", view: "ai-insights", style: "green" },
        { label: "Reports & Analytics", view: "reports", style: "mix" },
        { label: "User Management", view: "user-management", style: "green" },
      ];

  const buttonClass = (s) =>
    s === "green"
      ? "action-btn btn-gradient-green"
      : s === "mix"
      ? "action-btn btn-gradient-mix"
      : "action-btn btn-gradient-blue";

  const userId = getUserId(user);

  // --- UI ---
  return (
    <div className="dashboard-root">
      <div className="dashboard-header">
        <div className="greeting">
          <h1>
            {IS_FACULTY
              ? `Welcome, ${user?.name ?? "Faculty"}`
              : IS_HOD
              ? `${user?.department ?? "Department"} • HOD Dashboard`
              : "Admin Dashboard"}
          </h1>
          <p className="subtitle">
            {IS_FACULTY
              ? `Academic Year ${user?.academic_year ?? ""}`
              : IS_HOD
              ? `HOD: ${user?.name ?? ""}`
              : `Registrar / Admin: ${user?.name ?? ""}`}
          </p>
        </div>
      </div>

      <div className="stats-row">
        <StatCard title="Total Submissions" value={loadingStats ? "…" : stats.total} icon={<span className="dot blue" />} />
        <StatCard title="Average AI Score" value={loadingStats ? "…" : stats.avgScore} icon={<span className="dot teal" />} />
        <StatCard title="Pending Reviews" value={loadingStats ? "…" : stats.pending} icon={<span className="dot amber" />} />
        <StatCard title="Approved" value={loadingStats ? "…" : stats.approved} icon={<span className="dot green" />} />
      </div>

      {statsError && <div className="form-msg err">{statsError}</div>}

      {/* Quick Action Buttons */}
      <div className="quick-actions-large">
        {actions.map((a) => (
          <button
            key={a.view}
            className={buttonClass(a.style)}
            onClick={() => (a.view === "new-form" ? setShowNewForm(true) : setView(a.view))}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Main Panel */}
      <div className="panel">
        {/* My Submissions (faculty or HOD) */}
        {view === "my-submissions" && (
          <div className="panel-content">
            <div className="panel-title">My Submissions</div>
            <SubmissionsList apiBase={apiBase} user={user} mineOnly />
          </div>
        )}

        {/* Department Submissions: HOD locked to their department */}
        {view === "department-submissions" && (
          <div className="panel-content">
            <div className="panel-title">Department Submissions</div>
            <SubmissionsList apiBase={apiBase} user={user} fixedDepartment={user?.department ?? ""} />
          </div>
        )}

        {/* Admin/Registrar: show department selector so they can choose any department */}
        {view === "all-department-submissions" && (
          <div className="panel-content">
            <div className="panel-title">All Department Submissions</div>
            <SubmissionsList apiBase={apiBase} user={user} showDeptSelect />
          </div>
        )}

        {view === "upload-proofs" && (
          <div className="panel-content">
            <div className="panel-title">Upload Proofs</div>
            <div className="placeholder">Upload proof interface coming soon.</div>
          </div>
        )}

        {/* AI Feedback Tab */}
        {view === "ai-feedback" && (
          <div className="panel-content">
            <div className="panel-title">AI Feedback</div>
            {userId ? <ReportsAnalytics apiBase={apiBase} userId={userId} /> : <div className="placeholder">Sign in to view AI feedback and analytics.</div>}
          </div>
        )}

        {view === "department-ai" && (
          <div className="panel-content">
            <div className="panel-title">Department AI Analysis</div>
            <div className="placeholder">Department analytics will appear here.</div>
          </div>
        )}

        {view === "ai-insights" && (
          <div className="panel-content">
            <div className="panel-title">AI Insights Dashboard</div>
            <div className="placeholder">Institution-level AI insights coming soon.</div>
          </div>
        )}

        {view === "reports" && (
          <div className="panel-content">
            <div className="panel-title">Reports & Analytics</div>
            {userId ? <ReportsAnalytics apiBase={apiBase} userId={userId} /> : <div className="placeholder">Sign in to view analytics reports.</div>}
          </div>
        )}

        {view === "user-management" && (
          <div className="panel-content">
            <div className="panel-title">User Management</div>
            <div className="placeholder">Manage faculty/HOD accounts here.</div>
          </div>
        )}
      </div>

      {/* Show KPI Submission Form */}
      {showNewForm && (
        <SubmissionForm
          apiBase={apiBase}
          onSubmitted={() => {
            setShowNewForm(false);
            setView("my-submissions");
            loadStats();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
