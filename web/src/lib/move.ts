import * as d from './dates.ts';

/**
 * 할 일을 다른 날로 옮기기.
 *
 * 옮기는 길이 둘이라 규칙을 한 곳에 모은다 — 메뉴의 날짜 고르기, 그리고 달력으로 끌어놓기.
 * 여러 날짜리 항목은 기간을 유지한 채 통째로 민다. 시작만 옮기면 끝보다 뒤로 가버린다.
 */

/** 끌어놓기로 오가는 값. 달력 쪽에서는 항목을 다시 찾을 수 없으므로 기간도 같이 싣는다. */
export const DRAG_TYPE = 'application/x-haru-todo';

export type DragPayload = { id: number; span: number };

/** 시작·끝 날짜를 며칠 벌려 두었는지. 하루짜리면 0. */
export function spanOf(date: string | null, endDate: string | null): number {
  if (!date || !endDate) return 0;
  return Math.max(0, d.daysBetween(date, endDate));
}

/** api.update 에 넘길 날짜 항목. null 이면 '언젠가'로 내린다. */
export function moveFields(
  next: string | null,
  span: number,
): { date: string | null; endDate: string | null } {
  if (next === null) return { date: null, endDate: null };
  return { date: next, endDate: span > 0 ? d.addDays(next, span) : null };
}
