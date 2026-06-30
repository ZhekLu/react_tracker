const HELPER_BASE =
  import.meta.env.VITE_TRACKER_HELPER_BASE ?? "http://127.0.0.1:8766";

export type PdfAnnotation = {
  id: string;
  sourceType: "pdf";
  sourcePath: string;
  sourceLabel: string;
  page: number;
  annotationKind: string;
  color: string;
  rgb: number[];
  quote: string;
  comment: string;
  isQuestion: boolean;
  createdAt: string;
  rect: number[];
};

export type PdfAnnotationImport = {
  path: string;
  annotations: PdfAnnotation[];
  ignored: Record<string, number>;
  ignored_count: number;
};

export type TogglStatus = {
  online: boolean;
  configured: boolean;
  running: boolean;
  error: string;
  projectName: string;
  current: {
    id: string | number;
    description: string;
    planId: string;
    dayId: string;
    start: string;
  } | null;
  totals: Record<string, number>;
  days: Record<string, Record<string, number>>;
};

type RawTogglStatus = {
  configured?: boolean;
  running?: boolean;
  error?: string;
  project_name?: string;
  current?: {
    id: string | number;
    description?: string;
    plan_id?: string;
    day_id?: string;
    start?: string;
  } | null;
  totals?: Record<string, number>;
  days?: Record<string, Record<string, number>>;
};

function togglStatus(payload: RawTogglStatus): TogglStatus {
  return {
    configured: Boolean(payload.configured),
    current: payload.current
      ? {
          dayId: payload.current.day_id ?? "",
          description: payload.current.description ?? "",
          id: payload.current.id,
          planId: payload.current.plan_id ?? "",
          start: payload.current.start ?? "",
        }
      : null,
    days: payload.days ?? {},
    error: payload.error ?? "",
    online: true,
    projectName: payload.project_name ?? "",
    running: Boolean(payload.running),
    totals: payload.totals ?? {},
  };
}

export async function fetchTogglStatus(): Promise<TogglStatus> {
  try {
    const response = await fetch(`${HELPER_BASE}/status`);
    const payload = (await response.json()) as RawTogglStatus;
    if (!response.ok) throw new Error(payload.error ?? "Toggl helper failed.");
    return togglStatus(payload);
  } catch (caught) {
    return {
      configured: false,
      current: null,
      days: {},
      error:
        caught instanceof Error
          ? caught.message
          : "The local tracker helper is not running.",
      online: false,
      projectName: "",
      running: false,
      totals: {},
    };
  }
}

async function togglCommand(
  route: "start" | "stop",
  payload: Record<string, string> = {},
): Promise<TogglStatus> {
  let response: Response;
  try {
    response = await fetch(`${HELPER_BASE}/${route}`, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new Error(
      "The local tracker helper is not running. Start it with make toggl-server.",
    );
  }
  const result = (await response.json()) as RawTogglStatus & { error?: string };
  if (!response.ok || result.error) {
    throw new Error(result.error ?? `Could not ${route} Toggl.`);
  }
  return fetchTogglStatus();
}

export function startToggl(description: string): Promise<TogglStatus> {
  return togglCommand("start", { description });
}

export function stopToggl(): Promise<TogglStatus> {
  return togglCommand("stop");
}

export async function collectPdfAnnotations(
  path: string,
): Promise<PdfAnnotationImport> {
  let response: Response;
  try {
    response = await fetch(`${HELPER_BASE}/pdf_annotations`, {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new Error(
      "The local tracker helper is not running. Start it with make toggl-server.",
    );
  }
  const payload = (await response.json()) as PdfAnnotationImport & {
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "Could not collect PDF annotations.");
  }
  return payload;
}
