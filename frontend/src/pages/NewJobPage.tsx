import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type IntakeDecision } from "../api";

export default function NewJobPage() {
  const nav = useNavigate();
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [decision, setDecision] = useState<IntakeDecision | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.createJob(description);
      setJobId(r.job_id);
      setDecision(r.decision);
      if (r.decision.action === "finalize") nav(`/jobs/${r.job_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const reply = async () => {
    if (jobId === null) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.answerIntake(jobId, answer);
      setDecision(r.decision);
      setAnswer("");
      if (r.decision.action === "finalize") nav(`/jobs/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Describe the role</h1>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {jobId === null ? (
        <>
          <textarea
            className="w-full rounded border p-2"
            rows={4}
            placeholder="e.g. I need a part-time barista, weekends, must be able to open the shop alone"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button onClick={start} disabled={busy || !description.trim()}
                  className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {busy ? "Thinking…" : "Start"}
          </button>
        </>
      ) : (
        decision?.action === "ask" && (
          <div className="space-y-3 rounded border p-4">
            <p className="font-medium">{decision.question}</p>
            <input className="w-full rounded border p-2" value={answer}
                   onChange={(e) => setAnswer(e.target.value)} />
            <button onClick={reply} disabled={busy || !answer.trim()}
                    className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
              {busy ? "Thinking…" : "Answer"}
            </button>
          </div>
        )
      )}
    </div>
  );
}
