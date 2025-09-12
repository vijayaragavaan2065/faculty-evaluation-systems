// src/components/NewSubmission.jsx
import { useState } from "react";
import "./NewSubmission.css";

/**
 * NewSubmission: simplified PADS-like form (no file uploads).
 */
export default function NewSubmission({ apiBase = "http://127.0.0.1:8000", onSaved }) {
  const [facultyRank, setFacultyRank] = useState("AP I");
  const [academicYear, setAcademicYear] = useState("2024-2025");
  const [passPercent, setPassPercent] = useState(85);
  const [studentFeedback, setStudentFeedback] = useState(4.0);
  const [publications, setPublications] = useState(0);
  const [citations, setCitations] = useState(0);
  const [trainingDays, setTrainingDays] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const token = localStorage.getItem("token");
    if (!token) {
      setMsg("Login required.");
      setSaving(false);
      return;
    }

    const fd = new FormData();
    fd.append("faculty_rank", facultyRank);
    fd.append("academic_year", academicYear);
    fd.append("pass_percent", Number(passPercent));
    fd.append("student_feedback", Number(studentFeedback));
    fd.append("publications", Number(publications));
    fd.append("citations", Number(citations));
    fd.append("training_days", Number(trainingDays));

    try {
      const res = await fetch(`${apiBase}/api/submissions/`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      setMsg("Saved. Submission id: " + data.submission_id);
      if (onSaved) onSaved();
    } catch (err) {
      setMsg("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="newsubmission-card">
      <h2>New Submission (PADS)</h2>
      <p className="muted">Fill the main KPI fields below.</p>

      <form onSubmit={submit} className="newsubmission-form">
        <div className="row">
          <label>Faculty Rank</label>
          <select value={facultyRank} onChange={(e) => setFacultyRank(e.target.value)}>
            <option>AP I</option>
            <option>AP II</option>
            <option>AP III</option>
            <option>AsP/Prof</option>
          </select>

          <label>Academic Year</label>
          <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
        </div>

        <div className="grid">
          <div className="field">
            <label>% Pass (ESE)</label>
            <input type="number" min="0" max="100" value={passPercent} onChange={(e)=>setPassPercent(e.target.value)} />
          </div>

          <div className="field">
            <label>Student Feedback (avg)</label>
            <input type="number" min="0" max="5" step="0.1" value={studentFeedback} onChange={(e)=>setStudentFeedback(e.target.value)} />
          </div>

          <div className="field">
            <label>Publications (count)</label>
            <input type="number" min="0" value={publications} onChange={(e)=>setPublications(e.target.value)} />
          </div>

          <div className="field">
            <label>Citations (count)</label>
            <input type="number" min="0" value={citations} onChange={(e)=>setCitations(e.target.value)} />
          </div>

          <div className="field">
            <label>Training days</label>
            <input type="number" min="0" value={trainingDays} onChange={(e)=>setTrainingDays(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Submission"}</button>
          <button type="button" className="btn ghost" onClick={() => { if (onSaved) onSaved(); }}>Cancel</button>
          <div style={{ marginLeft: "auto", color: "#205067", fontWeight:700 }}>{msg}</div>
        </div>
      </form>
    </div>
  );
}
