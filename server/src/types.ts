/**
 * 도메인 타입.
 *
 * 갈래는 두 축으로 이루어진다.
 *
 *   누구의 것인가 : 나 / 상대   ← `ownerId` 를 보는 사람과 비교해 정한다
 *   어떤 일인가   : 개인 / 업무 ← `lane`
 *
 * 그래서 화면에는 네 칸이 나온다. 사람 이름("혜인", "민우")은 저장하지 않는다 —
 * 누가 로그인하든 같은 코드가 돌고, 각자에게 자기 갈래가 먼저 온다.
 */

export type Lane = 'personal' | 'work';

/** 화면에 그려지는 네 칸. 서버가 보는 사람 기준으로 계산해 내려준다. */
export type Bucket = 'mine' | 'mineWork' | 'partner' | 'partnerWork';

/** 어디서나 이 순서로 놓는다 — 내 것 먼저, 각자 개인 다음 업무. */
export const BUCKET_ORDER: Bucket[] = ['mine', 'mineWork', 'partner', 'partnerWork'];

export type PublicUser = {
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
  /** 보는 사람 기준으로 계산된 칸 */
  bucket: Bucket;
  title: string;
  note: string | null;
  /** 'YYYY-MM-DD' — null 이면 "언젠가" 서랍 */
  date: string | null;
  /** 여러 날 항목의 마지막 날 */
  endDate: string | null;
  position: number;
  /** 둘 다 체크할 수 있는 일 */
  together: boolean;
  done: boolean;
  doneAt: string | null;
  doneBy: number | null;
  /** 이월된 항목이면 원래 날짜 */
  carriedFrom: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
  /** 보는 사람이 이 항목을 체크할 수 있는가 */
  canCheck: boolean;
  /** 보는 사람이 이 항목을 고치거나 지울 수 있는가 */
  canEdit: boolean;
  /** 보는 사람의 "남은 개수"에 포함되는가 — 상대 갈래는 세지 않는다 */
  countable: boolean;
};

/** 달력 칸에 그릴 하루치 밀도 */
export type DayLoad = {
  date: string;
  mine: number;
  mineWork: number;
  partner: number;
  partnerWork: number;
  /** 그날 항목이 하나라도 있는데 전부 끝났으면 true → 회색 막대 */
  allDone: boolean;
};

export type SessionPayload = {
  userId: number;
  issuedAt: number;
};
