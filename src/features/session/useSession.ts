import { useCallback, useEffect, useRef, useState } from 'react'
import { prioriApi, type ApiSession } from '../../lib/api'

type SessionApi = Pick<typeof prioriApi, 'bootstrap' | 'logout'>

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
          ? 'API dang chua phan hoi. Render co the can mot luc de khoi dong.'
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
        ? 'Phien dang nhap da het han. Dang nhap lai de tiep tuc ban nhap hien tai.'
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
        ? 'Ban da thoat khoi workspace nay, nhung may chu chua xac nhan do mat ket noi.'
        : 'You left this workspace, but the server could not confirm logout because the connection failed.')
    } finally {
      setSession(null)
    }
  }, [api])

  return {
    session,
    checking,
    notice,
    authenticate,
    logout,
    clearNotice: () => setNotice(undefined),
  }
}
