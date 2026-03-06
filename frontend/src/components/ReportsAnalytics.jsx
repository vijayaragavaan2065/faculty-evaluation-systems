/* src/components/ReportsAnalytics.jsx
   Restored original version + KPI report download buttons added
*/
import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
} from "recharts";

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
  } catch {}
  return null;
}

export default function ReportsAnalytics({ apiBase = "http://127.0.0.1:8000", userId, user }) {

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState({ time_series: [], kpi_breakdown: [], overall: {} });
  const [recommendations, setRecommendations] = useState([]);

  const token = findAuthToken();

  /* ---------------- DOWNLOAD FUNCTIONS ---------------- */

  const downloadDepartmentReport = async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/reports/department/${user.department}/pdf`,
        { headers: { Authorization: "Bearer " + token } }
      );

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "department_kpi_report.pdf";
      a.click();
    } catch (err) {
      console.error("Department report download error", err);
    }
  };

  const downloadCollegeExcel = async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/reports/college/excel`,
        { headers: { Authorization: "Bearer " + token } }
      );

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "college_kpi_report.xlsx";
      a.click();
    } catch (err) {
      console.error("Excel report download error", err);
    }
  };

  /* ---------------------------------------------------- */

  useEffect(() => {
    async function fetchReports() {
      setLoading(true);
      setError("");

      try {
        const url = `${apiBase}/api/reports/user/${userId}`;

        const res = await fetch(url, {
          headers: { Authorization: "Bearer " + token },
        });

        const json = await res.json();

        setData(json);

        const sorted = (json.kpi_breakdown || []).slice().sort((a, b) => a.score - b.score);
        const recs = sorted.slice(0, 3).map((x) => ({
          kpi: x.kpi,
          score: x.score,
          suggestion: suggestionForKPI(x.kpi),
        }));

        setRecommendations(recs);

      } catch (err) {
        setError(err.message);
      }

      setLoading(false);
    }

    fetchReports();
  }, [apiBase, userId]);

  function suggestionForKPI(kpi) {
    const ideas = {
      Teaching: "Attend pedagogy workshops and introduce active learning.",
      Research: "Increase publications and collaborate with research groups.",
      Mentoring: "Schedule regular mentoring hours.",
      "Industry Collaboration": "Invite industry experts and pursue projects.",
      "Community Service": "Plan outreach activities aligned with SDGs.",
    };

    return ideas[kpi] || "Improve performance through structured planning.";
  }

  if (loading) return <div>Loading analytics...</div>;

  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">

      <h2 className="text-2xl font-bold mb-4">Reports & Analytics</h2>

      {/* DOWNLOAD REPORT BUTTONS */}

      <div style={{ marginBottom: 20, display: "flex", gap: 12 }}>

        {user?.role === "hod" && (
          <button onClick={downloadDepartmentReport}>
            Download Department KPI Report (PDF)
          </button>
        )}

        {user?.role === "registrar" && (
          <button onClick={downloadCollegeExcel}>
            Download College KPI Report (Excel)
          </button>
        )}

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div>
          <h4>AI Score Over Time</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.time_series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h4>KPI Breakdown</h4>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={data.kpi_breakdown}>
              <PolarGrid />
              <PolarAngleAxis dataKey="kpi" />
              <PolarRadiusAxis />
              <Radar dataKey="score" stroke="#16a34a" fill="#16a34a" fillOpacity={0.4} />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* RECOMMENDATIONS */}

      <div style={{ marginTop: 30 }}>
        <h4>Where to Improve</h4>

        {recommendations.map((r) => (
          <div key={r.kpi}>
            <strong>{r.kpi}</strong> ({r.score}%)
            <p>{r.suggestion}</p>
          </div>
        ))}

      </div>
    </div>
  );
}