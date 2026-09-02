import { z } from "zod";

export const WorkGoalStatusSchema = z.enum(["active", "completed", "failed", "canceled"]);
export const WorkTaskStatusSchema = z.enum([
  "submitted",
  "working",
  "input-required",
  "completed",
  "canceled",
  "failed",
  "rejected",
  "auth-required",
  "unknown",
]);
export const BackgroundJobStatusSchema = z.enum([
  "queued",
  "running",
  "input-required",
  "paused",
  "completed",
  "failed",
  "stopped",
]);

export const WorkGoalSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: WorkGoalStatusSchema,
  progress_percent: z.number().optional().nullable(),
  progress_note: z.string().optional().nullable(),
  status_reason: z.string().optional().nullable(),
  updated_at: z.string(),
});

export const WorkTaskSchema = z.object({
  id: z.string(),
  goal_id: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  plan: z.string().optional().nullable(),
  status: WorkTaskStatusSchema,
  progress_percent: z.number().optional().nullable(),
  progress_note: z.string().optional().nullable(),
  status_reason: z.string().optional().nullable(),
  dependency_task_ids: z.array(z.string()).optional().default([]),
  updated_at: z.string(),
});

const BackgroundArtifactSchema = z.object({
  id: z.string(),
  name: z.string().optional().nullable(),
  media_type: z.string().optional().nullable(),
  uri: z.string().optional().nullable(),
});

export const BackgroundJobSchema = z.object({
  id: z.string(),
  child_agent_id: z.string(),
  child_session_id: z.string().optional().nullable(),
  objective: z.string(),
  status: BackgroundJobStatusSchema,
  result: z.unknown().optional().nullable(),
  error: z.string().optional().nullable(),
  transcript_message_ids: z.array(z.string()).optional().default([]),
  artifacts: z.array(BackgroundArtifactSchema).optional().default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_page_token: z.string().optional().nullable() });

export const WorkGoalPageSchema = page(WorkGoalSchema);
export const WorkTaskPageSchema = page(WorkTaskSchema);
export const BackgroundJobPageSchema = page(BackgroundJobSchema);

export type WorkGoal = z.infer<typeof WorkGoalSchema>;
export type WorkTask = z.infer<typeof WorkTaskSchema>;
export type BackgroundJob = z.infer<typeof BackgroundJobSchema>;

export interface WorkSnapshot {
  goals: WorkGoal[];
  tasks: WorkTask[];
  jobs: BackgroundJob[];
}
