/**
 * 도메인 타입.
 *
 * 갈래(lane)는 사람 이름이 아니라 의미로 저장한다. 화면에 보이는 "혜인 / 민우 / 업무"는
 * `lane` 과 `ownerId` 를 **보는 사람 기준으로** 옮긴 결과다.
 *
 *   내 갈래   = lane 'personal' + ownerId === 나
 *   상대 갈래 = lane 'personal' + ownerId === 상대
 *   업무      = lane 'work'     + ownerId === 나   (업무는 남에게 보이지 않는다)
 *
 * 덕분에 누가 로그인하든 같은 코드가 그대로 동작하고, 상대에게는 늘 자기 갈래가 왼쪽에 온다.
 */

export type Lane = 'personal' | 'work';

/** 화면에 그려지는 세 칸. 서버가 보는 사람 기준으로 계산해 내려준다. */
export type Bucket = 'mine' | 'partner' | 'work';

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
  partner: number;
  work: number;
  /** 그날 항목이 하나라도 있는데 전부 끝났으면 true → 회색 막대 */
  allDone: boolean;
};

export type SessionPayload = {
  userId: number;
  issuedAt: number;
};
