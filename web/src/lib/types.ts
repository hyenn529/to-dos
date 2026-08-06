export type Lane = 'personal' | 'work';
export type Bucket = 'mine' | 'partner' | 'work';

export type User = {
  id: number;
  email: string;
  name: string;
  initial: string;
};

export type Space = {
  id: number;
  name: string;
  inviteCode: string;
};

export type Me = {
  user: User;
  space: Space;
  partner: User | null;
};

export type Subtask = {
  id: number;
  todoId: number;
  title: string;
  done: boolean;
  position: number;
};

export type Todo = {
  id: number;
  spaceId: number;
  ownerId: number;
  lane: Lane;
  bucket: Bucket;
  title: string;
  note: string | null;
  date: string | null;
  endDate: string | null;
  position: number;
  together: boolean;
  done: boolean;
  doneAt: string | null;
  doneBy: number | null;
  carriedFrom: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
  canCheck: boolean;
  canEdit: boolean;
  countable: boolean;
};

export type DayLoad = {
  date: string;
  mine: number;
  partner: number;
  work: number;
  allDone: boolean;
};

export type ViewMode = 'day' | 'week' | 'someday';
