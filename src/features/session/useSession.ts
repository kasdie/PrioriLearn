import { useCallback, useEffect, useRef, useState } from 'react'
import { prioriApi, type ApiSession } from '../../lib/api'

type SessionApi = Pick<typeof prioriApi, 'bootstrap' | 'logout'> & Partial<Pick<typeof prioriApi, 'updateLocale'>>

type UseSessionOptions = {
  locale: 'vi' | 'en'
  onLocaleChange: (locale: 'vi' | 'en') => void
  api?: SessionApi
}

export function useSession({ locale, onLocaleChange, api = prioriApi }: UseSessionOptions) {
  const [session, setSession] = useState<ApiSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [notice, setNotice] = useState<string | undefined>()
  const localeRef = useRef(locale)

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  const authenticate = useCallback((nextSession: ApiSession) => {
    setSession(nextSession)
    onLocaleChange(nextSession.user.locale)
    setNotice(undefined)
  }, [onLocaleChange])

  useEffect(() => {
    let active = true
    void api.bootstrap()
      .then((restored) => {
        if (active && restored) authenticate(restored)
      })
      .catch(() => {
        if (!active) return
        setNotice(window.navigator.language.toLowerCase().startsWith('vi')
          ? 'API đang chưa phản hồi. Render có thể cần một lúc để khởi động.'
          : 'The API is not responding yet. Render may need a moment to wake up.')
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [api, authenticate])

  useEffect(() => {
    const handleExpiredSession = () => {
      setSession(null)
      setNotice(localeRef.current === 'vi'
        ? 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục bản nháp hiện tại.'
        : 'Your session expired. Sign in again to continue the current draft.')
    }
    window.addEventListener('priorilearn:session-expired', handleExpiredSession)
    return () => window.removeEventListener('priorilearn:session-expired', handleExpiredSession)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
      setNotice(undefined)
    } catch {
      setNotice(localeRef.current === 'vi'
        ? 'Bạn đã thoát khỏi không gian học này, nhưng máy chủ chưa xác nhận do mất kết nối.'
        : 'You left this workspace, but the server could not confirm logout because the connection failed.')
    } finally {
      setSession(null)
    }
  }, [api])

  const changeLocale = useCallback(async (nextLocale: 'vi' | 'en') => {
    onLocaleChange(nextLocale)
    if (!session || !api.updateLocale) return
    try {
      const updated = await api.updateLocale(nextLocale)
      setSession(updated)
      setNotice(undefined)
    } catch {
      onLocaleChange(session.user.locale)
      setNotice(nextLocale === 'vi'
        ? 'Chưa thể lưu ngôn ngữ. PrioriLearn đã giữ lựa chọn trước đó.'
        : 'Language could not be saved. PrioriLearn kept your previous choice.')
    }
  }, [api, onLocaleChange, session])

  return {
    session,
    checking,
    notice,
    authenticate,
    changeLocale,
    logout,
    clearNotice: () => setNotice(undefined),
  }
}
