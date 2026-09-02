import { useState, type ReactNode } from "react";
import { Button } from "./beautiful-ui/atoms/button.js";

export interface WorkGoalView {
  id: string;
  objective: string;
  status: string;
  progressPercent?: number | null;
  progressNote?: string | null;
}

export interface WorkTaskView {
  id: string;
  summary?: string | null;
  status: string;
  progressPercent?: number | null;
  progressNote?: string | null;
}

export interface BackgroundJobView {
  id: string;
  childAgentId: string;
  objective: string;
  status: string;
  updatedAt: string;
  result?: unknown;
  error?: string | null;
  transcriptMessageIds: string[];
  artifacts: Array<{ id: string; name?: string | null; uri?: string | null }>;
}

export interface WorkOverviewProps {
  goals: WorkGoalView[];
  tasks: WorkTaskView[];
  jobs: BackgroundJobView[];
  loading?: boolean;
  onSteer: (jobId: string, instruction: string) => void;
  onStop: (jobId: string) => void;
  onResume: (jobId: string, instruction?: string) => void;
}

/** Owner-facing summary of durable goals, tasks, and delegated child work. */
export function WorkOverview({
  goals,
  tasks,
  jobs,
  loading = false,
  onSteer,
  onStop,
  onResume,
}: WorkOverviewProps) {
  const [selectedJobId, setSelectedJobId] = useState("");
  const [instruction, setInstruction] = useState("");
  const selected = jobs.find((job) => job.id === selectedJobId);
  const activeGoal = goals.find((goal) => goal.status === "active") ?? goals[0];
  const needsYou = tasks.filter((task) =>
    ["input-required", "auth-required"].includes(task.status),
  );
  const activeJobs = jobs.filter((job) =>
    ["queued", "running", "paused", "input-required"].includes(job.status),
  );
  const recentJobs = jobs.filter((job) => ["completed", "failed", "stopped"].includes(job.status));

  if (loading && !goals.length && !tasks.length && !jobs.length)
    return <p className="work-empty">Loading durable work…</p>;

  if (selected)
    return (
      <section className="work-job-detail">
        <button className="work-back" onClick={() => setSelectedJobId("")} type="button">
          ← Back to work
        </button>
        <header>
          <div>
            <strong>{selected.childAgentId}</strong>
            <p>{selected.objective}</p>
          </div>
          <span className={`work-status ${selected.status}`}>{statusLabel(selected.status)}</span>
        </header>
        {selected.error ? <p className="work-error">{selected.error}</p> : null}
        {selected.result !== undefined && selected.result !== null ? (
          <pre>{JSON.stringify(selected.result, null, 2)}</pre>
        ) : null}
        {selected.artifacts.length ? (
          <section>
            <h4>Artifacts</h4>
            <ul>
              {selected.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  {artifact.uri ? (
                    <a href={artifact.uri} rel="noreferrer" target="_blank">
                      {artifact.name || artifact.id}
                    </a>
                  ) : (
                    artifact.name || artifact.id
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {selected.transcriptMessageIds.length ? (
          <p className="work-muted">{selected.transcriptMessageIds.length} transcript messages</p>
        ) : null}
        {selected.status === "running" || selected.status === "queued" ? (
          <div className="work-steer">
            <label htmlFor={`steer-${selected.id}`}>Add instruction</label>
            <textarea
              id={`steer-${selected.id}`}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Clarify or redirect this background task"
              value={instruction}
            />
            <div>
              <Button
                disabled={!instruction.trim()}
                onClick={() => {
                  onSteer(selected.id, instruction.trim());
                  setInstruction("");
                }}
                size="sm"
              >
                Send instruction
              </Button>
              <Button onClick={() => onStop(selected.id)} size="sm" variant="quiet">
                Stop
              </Button>
            </div>
          </div>
        ) : selected.status === "paused" || selected.status === "input-required" ? (
          <Button onClick={() => onResume(selected.id, instruction.trim() || undefined)} size="sm">
            Resume
          </Button>
        ) : null}
      </section>
    );

  return (
    <section className="work-overview">
      {activeGoal ? (
        <article className="work-goal">
          <header>
            <span>Current outcome</span>
            <strong>{activeGoal.progressPercent ?? 0}%</strong>
          </header>
          <h3>{activeGoal.objective}</h3>
          <progress max={100} value={activeGoal.progressPercent ?? 0} />
          {activeGoal.progressNote ? <p>{activeGoal.progressNote}</p> : null}
        </article>
      ) : null}

      {needsYou.length ? (
        <WorkSection title="Needs you">
          {needsYou.map((task) => (
            <WorkTaskRow key={task.id} task={task} />
          ))}
        </WorkSection>
      ) : null}

      {tasks.length ? (
        <WorkSection title="Tasks">
          {tasks.map((task) => (
            <WorkTaskRow key={task.id} task={task} />
          ))}
        </WorkSection>
      ) : null}

      {activeJobs.length ? (
        <WorkSection title="In background">
          {activeJobs.map((job) => (
            <JobRow job={job} key={job.id} onOpen={setSelectedJobId} />
          ))}
        </WorkSection>
      ) : null}

      {recentJobs.length ? (
        <WorkSection title="Recent">
          {recentJobs.map((job) => (
            <JobRow job={job} key={job.id} onOpen={setSelectedJobId} />
          ))}
        </WorkSection>
      ) : null}

      {!activeGoal && !tasks.length && !jobs.length ? (
        <p className="work-empty">No durable work is active in this conversation.</p>
      ) : null}
    </section>
  );
}

function WorkSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="work-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function WorkTaskRow({ task }: { task: WorkTaskView }) {
  return (
    <article className="work-row">
      <span className={`work-task-mark ${task.status}`} aria-hidden="true" />
      <div>
        <strong>{task.summary || "Task"}</strong>
        <small>{task.progressNote || statusLabel(task.status)}</small>
      </div>
      {task.progressPercent !== undefined && task.progressPercent !== null ? (
        <span>{task.progressPercent}%</span>
      ) : null}
    </article>
  );
}

function JobRow({ job, onOpen }: { job: BackgroundJobView; onOpen: (id: string) => void }) {
  return (
    <button className="work-row work-job-row" onClick={() => onOpen(job.id)} type="button">
      <span className={`work-task-mark ${job.status}`} aria-hidden="true" />
      <span>
        <strong>{job.childAgentId}</strong>
        <small>{job.objective}</small>
      </span>
      <span>{statusLabel(job.status)}</span>
    </button>
  );
}

function statusLabel(status: string): string {
  return status.replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase());
}
