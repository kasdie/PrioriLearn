import { useCallback, useState } from 'react'
import { ApiClientError, prioriApi, userFacingError, type ApiPlan } from '../../lib/api'

type PlanApi = Pick<typeof prioriApi, 'generatePlan' | 'approvePlan'>
type PlanStatus = 'idle' | 'generating' | 'proposed' | 'approving' | 'approved' | 'error'

export function usePlanFlow(api: PlanApi = prioriApi, locale: 'vi' | 'en' = 'en') {
  const [plan, setPlan] = useState<ApiPlan | null>(null)
  const [status, setStatus] = useState<PlanStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const generate = useCallback(async (replacePending = false) => {
    if (status === 'generating' || status === 'approving') return undefined
    setStatus('generating')
    setError(null)
    setErrorCode(null)
    try {
      const proposal = await api.generatePlan(locale, replacePending)
      setPlan(proposal)
      setStatus(proposal.status === 'approved' ? 'approved' : 'proposed')
      return proposal
    } catch (cause) {
      setStatus('error')
      setErrorCode(cause instanceof ApiClientError ? cause.code : null)
      setError(userFacingError(cause, locale, locale === 'vi' ? 'Chưa tạo được đề xuất. Dữ liệu đã xác nhận không thay đổi.' : 'No proposal was created. Your confirmed data is unchanged.'))
      return undefined
    }
  }, [api, locale, status])

  const approve = useCallback(async () => {
    if (!plan || plan.status !== 'proposed' || status === 'approving') return undefined
    setStatus('approving')
    setError(null)
    setErrorCode(null)
    try {
      const approved = await api.approvePlan(plan)
      setPlan(approved)
      setStatus('approved')
      return approved
    } catch (cause) {
      setStatus('error')
      setErrorCode(cause instanceof ApiClientError ? cause.code : null)
      setError(userFacingError(cause, locale, locale === 'vi' ? 'Chưa có gì được duyệt. Đề xuất vẫn còn để bạn xem lại.' : 'Nothing was approved. The proposal remains available for review.'))
      return undefined
    }
  }, [api, locale, plan, status])

  const replacePlan = useCallback((nextPlan: ApiPlan | null) => {
    setPlan(nextPlan)
    setStatus(nextPlan?.status === 'approved' ? 'approved' : nextPlan ? 'proposed' : 'idle')
    setError(null)
    setErrorCode(null)
  }, [])

  return {
    plan,
    status,
    error,
    errorCode,
    busy: status === 'generating' || status === 'approving',
    approved: plan?.status === 'approved',
    generate,
    approve,
    replacePlan,
  }
}
