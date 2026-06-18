export type CourseId = "big_data" | "special_course" | string;

export type TaskStatus = "todo" | "done" | "question" | "later";

export type ResourceKind = "paper" | "book" | "slides" | "exercise" | "guide" | "dataset" | "web" | "other";

export type TrackerView = "roadmap" | "resources" | "exams";

export type Skill = {
  id: string;
  name: string;
  dayIds: string[];
  covered: boolean;
};

export type Resource = {
  id: string;
  title: string;
  kind: ResourceKind;
  sourcePath?: string;
  dayIds: string[];
  progress: number;
  hasQuestion: boolean;
};

export type Task = {
  id: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  resourceIds: string[];
  skillIds: string[];
};

export type StudyDay = {
  id: string;
  number: number;
  title: string;
  date: string;
  purpose: string;
  progress: number;
  closed: boolean;
  tasks: Task[];
};

export type ExamQuestion = {
  id: string;
  label: string;
  topic: string;
  status: TaskStatus;
};

export type ExamSet = {
  id: string;
  title: string;
  sourcePath: string;
  questions: ExamQuestion[];
};

export type Course = {
  id: CourseId;
  title: string;
  shortCode: string;
  accent: string;
  days: StudyDay[];
  resources: Resource[];
  skills: Skill[];
  exams: ExamSet[];
};
