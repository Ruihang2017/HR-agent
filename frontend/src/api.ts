const json = (r: Response) => {
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
};
const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(json);

export type IntakeDecision = { action: "ask" | "finalize"; question: string | null };
export type JobSummary = { id: number; title: string | null; status: string };
export type JobDetail = JobSummary & {
  jd_markdown: string | null;
  lint_results: { implemented: boolean; flags: unknown[] } | null;
  rubric: { name: string; type: string; weight: number; evidence_guidance: string }[] | null;
};
export type ApplicationRow = {
  id: number;
  candidate_name: string;
  status: string;
  overall: number | null;
  meets_all_must_haves: boolean | null;
  rationale: string | null;
};
export type KitQuestion = {
  text: string;
  category: string;
  listen_for: string;
  criterion_name: string;
};
export type ApplicationDetail = {
  id: number;
  job_id: number;
  candidate_name: string;
  status: string;
  raw_text: string | null;
  redacted_text: string | null;
  parsed: unknown;
  report: {
    results: { criterion_name: string; type: string; met: boolean | null; score: number | null; evidence: string }[];
    overall: number;
    meets_all_must_haves: boolean;
    rationale: string;
  } | null;
  kit: { questions: KitQuestion[] } | null;
  decisions: { action: string; note: string | null; created_at: string }[];
};

export const api = {
  createJob: (description: string) =>
    post("/api/jobs", { description }) as Promise<{ job_id: number; decision: IntakeDecision }>,
  answerIntake: (jobId: number, answer: string) =>
    post(`/api/jobs/${jobId}/intake`, { answer }) as Promise<{
      job_id: number; decision: IntakeDecision; status: string;
    }>,
  listJobs: () => fetch("/api/jobs").then(json) as Promise<JobSummary[]>,
  getJob: (id: number) => fetch(`/api/jobs/${id}`).then(json) as Promise<JobDetail>,
  seed: (id: number, count = 50) => post(`/api/jobs/${id}/seed`, { count }),
  screen: (id: number) => post(`/api/jobs/${id}/screen`),
  listApplications: (id: number) =>
    fetch(`/api/jobs/${id}/applications`).then(json) as Promise<ApplicationRow[]>,
  getApplication: (id: number) =>
    fetch(`/api/applications/${id}`).then(json) as Promise<ApplicationDetail>,
  decide: (id: number, action: "shortlist" | "hold" | "reject", note?: string) =>
    post(`/api/applications/${id}/decision`, { action, note }),
  createKit: (id: number) => post(`/api/applications/${id}/kit`),
};
