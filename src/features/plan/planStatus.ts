import type { ApiTask } from '../../lib/api'

export function isMissedPlanItem(
  endsAt: string,
  taskStatus: ApiTask['status'] | undefined,
  now = new Date(),
): boolean {
  const endTime = Date.parse(endsAt)
  return taskStatus === 'confirmed' && Number.isFinite(endTime) && endTime < now.getTime()
}
