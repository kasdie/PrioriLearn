import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Eye, EyeOff, Focus, ShieldCheck, Sparkles } from 'lucide-react'
import focusImage from './assets/study-focus.png'
import { ApiClientError, prioriApi, type ApiSession } from './lib/api'
import { loadGoogleIdentity } from './lib/google-identity'
import './AuthScreen.css'

type Locale = 'vi' | 'en'
type AuthMode = 'login' | 'register' | 'forgot'

type AuthScreenProps = {
  locale: Locale
  notice?: string
  onLocaleChange: (locale: Locale) => void
  onAuthenticated: (session: ApiSession) => Promise<void> | void
}

const authCopy = {
  vi: {
    login: 'Đăng nhập',
    register: 'Tạo tài khoản',
    loginTitle: 'Tiếp tục kế hoạch học của bạn',
    registerTitle: 'Tạo không gian học riêng',
    loginIntro: 'Quay lại với các ưu tiên, deadline và kế hoạch bạn đã xác nhận.',
    registerIntro: 'Dữ liệu và kế hoạch của bạn được tách biệt trong một tài khoản riêng.',
    name: 'Tên của bạn',
    email: 'Email',
    password: 'Mật khẩu',
    namePlaceholder: 'Nguyễn An',
    emailPlaceholder: 'ban@example.com',
    passwordHint: 'Tối thiểu 8 ký tự',
    signingIn: 'Đang đăng nhập...',
    creating: 'Đang tạo tài khoản...',
    continueLogin: 'Đăng nhập',
    continueRegister: 'Tạo tài khoản',
    demo: 'Dùng workspace demo',
    demoNote: 'Workspace demo dùng dữ liệu mẫu chung và có thể được đặt lại.',
    privacy: 'Mỗi tài khoản thật có workspace và dữ liệu riêng.',
    imageKicker: 'Ưu tiên rõ ràng',
    imageTitle: 'Một việc đúng lúc tốt hơn một danh sách dài.',
    imageBody: 'Bắt đầu từ điều quan trọng nhất hôm nay.',
    showPassword: 'Hiện mật khẩu',
    hidePassword: 'Ẩn mật khẩu',
    forgotPassword: 'Quên mật khẩu?',
    forgotTitle: 'Đặt lại mật khẩu',
    forgotIntro: 'Nhập email của bạn. Nếu tài khoản tồn tại, PrioriLearn sẽ gửi một liên kết đặt lại mật khẩu.',
    sendReset: 'Gửi liên kết',
    sendingReset: 'Đang gửi...',
    resetSent: 'Nếu email này có tài khoản, liên kết đặt lại mật khẩu đã được gửi.',
    backToLogin: 'Quay lại đăng nhập',
  },
  en: {
    login: 'Sign in',
    register: 'Create account',
    loginTitle: 'Continue your study plan',
    registerTitle: 'Create your private workspace',
    loginIntro: 'Return to the priorities, deadlines, and plans you have confirmed.',
    registerIntro: 'Your study data and plans stay separated in your own account.',
    name: 'Your name',
    email: 'Email',
    password: 'Password',
    namePlaceholder: 'Alex Nguyen',
    emailPlaceholder: 'you@example.com',
    passwordHint: 'At least 8 characters',
    signingIn: 'Signing in...',
    creating: 'Creating account...',
    continueLogin: 'Sign in',
    continueRegister: 'Create account',
    demo: 'Use demo workspace',
    demoNote: 'The demo uses shared sample data and may be reset.',
    privacy: 'Every real account has its own workspace and data.',
    imageKicker: 'A clear priority',
    imageTitle: 'One timely task beats a long list.',
    imageBody: 'Start with what matters most today.',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    forgotPassword: 'Forgot password?',
    forgotTitle: 'Reset your password',
    forgotIntro: 'Enter your email. If an account exists, PrioriLearn will send a password reset link.',
    sendReset: 'Send reset link',
    sendingReset: 'Sending...',
    resetSent: 'If an account exists for this email, a password reset link has been sent.',
    backToLogin: 'Back to sign in',
  },
}

function readableAuthError(error: unknown, locale: Locale): string {
  if (!(error instanceof ApiClientError)) {
    return locale === 'vi' ? 'Không thể kết nối tới PrioriLearn. Vui lòng thử lại.' : 'Could not connect to PrioriLearn. Please try again.'
  }

  const messages: Record<string, { vi: string; en: string }> = {
    EMAIL_EXISTS: {
      vi: 'Email này đã có tài khoản. Hãy chuyển sang đăng nhập.',
      en: 'An account already exists for this email. Try signing in.',
    },
    INVALID_CREDENTIALS: {
      vi: 'Email hoặc mật khẩu chưa đúng.',
      en: 'Email or password is incorrect.',
    },
    AUTH_RATE_LIMITED: {
      vi: 'Bạn đã thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.',
      en: 'Too many attempts. Wait a moment before trying again.',
    },
    VALIDATION_ERROR: {
      vi: 'Hãy kiểm tra lại các trường thông tin.',
      en: 'Check the form fields and try again.',
    },
    INVALID_GOOGLE_CREDENTIAL: {
      vi: 'Google khong the xac minh lan dang nhap nay. Vui long thu lai.',
      en: 'Google could not verify this sign-in. Please try again.',
    },
    GOOGLE_ACCOUNT_CONFLICT: {
      vi: 'Tai khoan Google nay dang duoc lien ket voi mot tai khoan khac.',
      en: 'This Google account is already linked to another account.',
    },
    GOOGLE_SIGN_IN_NOT_CONFIGURED: {
      vi: 'Dang nhap Google chua duoc cau hinh cho moi truong nay.',
      en: 'Google Sign-In is not configured for this environment.',
    },
    EMAIL_DELIVERY_NOT_CONFIGURED: {
      vi: 'Hệ thống gửi email chưa được cấu hình. Vui lòng thử lại sau.',
      en: 'Email delivery is not configured yet. Please try again later.',
    },
    EMAIL_DELIVERY_FAILED: {
      vi: 'Không thể gửi email lúc này. Vui lòng thử lại sau.',
      en: 'The email could not be sent. Please try again shortly.',
    },
  }
  return messages[error.code]?.[locale] ?? error.message
}

export function AuthScreen({ locale, notice, onLocaleChange, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const t = authCopy[locale]

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError(null)
    setSuccess(null)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (mode === 'forgot') {
        await prioriApi.requestPasswordReset(form.email.trim())
        setSuccess(t.resetSent)
        return
      }
      const session = mode === 'login'
        ? await prioriApi.login({ email: form.email.trim(), password: form.password })
        : await prioriApi.register({
          email: form.email.trim(),
          password: form.password,
          name: form.name.trim(),
          locale,
        })
      await onAuthenticated(session)
      if (mode === 'register') void prioriApi.track('onboarding_completed').catch(() => undefined)
    } catch (submitError) {
      setError(readableAuthError(submitError, locale))
    } finally {
      setBusy(false)
    }
  }

  const enterDemo = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onAuthenticated(await prioriApi.enterDemo())
    } catch (demoError) {
      setError(readableAuthError(demoError, locale))
    } finally {
      setBusy(false)
    }
  }

  const signInWithGoogle = useCallback(async (credential: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onAuthenticated(await prioriApi.googleLogin({ credential, locale }))
    } catch (signInError) {
      setError(readableAuthError(signInError, locale))
    } finally {
      setBusy(false)
    }
  }, [busy, locale, onAuthenticated])

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return
    let active = true
    const button = googleButtonRef.current
    button.replaceChildren()
    void loadGoogleIdentity()
      .then((google) => {
        if (!active) return
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => void signInWithGoogle(credential),
          context: mode === 'login' ? 'signin' : 'signup',
        })
        google.accounts.id.renderButton(button, {
          theme: 'outline',
          size: 'large',
          text: mode === 'login' ? 'signin_with' : 'signup_with',
          locale: locale === 'vi' ? 'vi' : 'en',
          width: 430,
        })
      })
      .catch(() => {
        if (active) setError(locale === 'vi' ? 'Khong the tai nut dang nhap Google. Vui long thu lai.' : 'Could not load Google Sign-In. Please try again.')
      })
    return () => {
      active = false
    }
  }, [googleClientId, locale, mode, signInWithGoogle])

  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-label={t.imageTitle}>
        <img src={focusImage} alt="Student reviewing a study plan beside a laptop" />
        <div className="auth-visual-shade" />
        <div className="auth-visual-copy">
          <span>{t.imageKicker}</span>
          <h2>{t.imageTitle}</h2>
          <p>{t.imageBody}</p>
        </div>
      </section>

      <section className="auth-panel">
        <header className="auth-header">
          <div className="brand" aria-label="PrioriLearn">
            <span className="brand-mark"><Focus size={19} strokeWidth={2.6} /></span>
            <span>priori<span>learn</span></span>
          </div>
          <div className="language-switch" aria-label="Language">
            <button className={locale === 'vi' ? 'selected' : ''} onClick={() => onLocaleChange('vi')} type="button">VI</button>
            <button className={locale === 'en' ? 'selected' : ''} onClick={() => onLocaleChange('en')} type="button">EN</button>
          </div>
        </header>

        <div className="auth-form-wrap">
          {mode === 'forgot' ? (
            <button className="auth-back" type="button" onClick={() => selectMode('login')}>
              <ArrowLeft size={16} />
              <span>{t.backToLogin}</span>
            </button>
          ) : (
            <div className="auth-segments" aria-label={locale === 'vi' ? 'Chọn hình thức truy cập' : 'Choose access mode'}>
              <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => selectMode('login')}>{t.login}</button>
              <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => selectMode('register')}>{t.register}</button>
            </div>
          )}

          <div className="auth-heading">
            <h1>{mode === 'login' ? t.loginTitle : mode === 'register' ? t.registerTitle : t.forgotTitle}</h1>
            <p>{mode === 'login' ? t.loginIntro : mode === 'register' ? t.registerIntro : t.forgotIntro}</p>
          </div>

          {(notice || error || success) && (
            <div className={error ? 'auth-message error' : success ? 'auth-message success' : 'auth-message'} role={error ? 'alert' : 'status'}>
              {success ? <CircleCheck size={17} /> : <CircleAlert size={17} />}
              <span>{error ?? success ?? notice}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'register' && (
              <label>
                <span>{t.name}</span>
                <input
                  required
                  autoComplete="name"
                  minLength={2}
                  maxLength={100}
                  placeholder={t.namePlaceholder}
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
            )}
            <label>
              <span>{t.email}</span>
              <input
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                type="email"
                placeholder={t.emailPlaceholder}
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            {mode !== 'forgot' && (
              <label>
                <span>{t.password}</span>
                <div className="password-field">
                  <input
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'register' ? 8 : 1}
                    maxLength={128}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'register' ? t.passwordHint : '••••••••'}
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <button
                    type="button"
                    title={showPassword ? t.hidePassword : t.showPassword}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            )}
            {mode === 'login' && (
              <button className="auth-forgot" type="button" onClick={() => selectMode('forgot')}>
                {t.forgotPassword}
              </button>
            )}
            <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy}>
              <span>
                {busy
                  ? (mode === 'login' ? t.signingIn : mode === 'register' ? t.creating : t.sendingReset)
                  : (mode === 'login' ? t.continueLogin : mode === 'register' ? t.continueRegister : t.sendReset)}
              </span>
              <ArrowRight size={17} />
            </button>
          </form>

          {mode !== 'forgot' && (
            <>
              <div className="auth-divider"><span>{locale === 'vi' ? 'hoặc' : 'or'}</span></div>
              {googleClientId && <div className="google-signin" ref={googleButtonRef} aria-label={locale === 'vi' ? 'Dang nhap voi Google' : 'Sign in with Google'} />}
              <button className="auth-demo" type="button" disabled={busy} onClick={() => void enterDemo()}>
                <Sparkles size={17} />
                <span>{t.demo}</span>
              </button>
              <p className="auth-demo-note">{t.demoNote}</p>
            </>
          )}

          <div className="auth-privacy"><ShieldCheck size={17} /><span>{t.privacy}</span></div>
        </div>
      </section>
    </main>
  )
}
