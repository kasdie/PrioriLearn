import { useState } from 'react'
import { ArrowRight, CircleAlert, Eye, EyeOff, Focus, ShieldCheck, Sparkles } from 'lucide-react'
import focusImage from './assets/study-focus.png'
import { ApiClientError, prioriApi, type ApiSession } from './lib/api'
import './AuthScreen.css'

type Locale = 'vi' | 'en'
type AuthMode = 'login' | 'register'

type AuthScreenProps = {
  locale: Locale
  notice?: string
  onLocaleChange: (locale: Locale) => void
  onAuthenticated: (session: ApiSession) => Promise<void>
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
  }
  return messages[error.code]?.[locale] ?? error.message
}

export function AuthScreen({ locale, notice, onLocaleChange, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = authCopy[locale]

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError(null)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
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
          <div className="auth-segments" aria-label={locale === 'vi' ? 'Chọn hình thức truy cập' : 'Choose access mode'}>
            <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => selectMode('login')}>{t.login}</button>
            <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => selectMode('register')}>{t.register}</button>
          </div>

          <div className="auth-heading">
            <h1>{mode === 'login' ? t.loginTitle : t.registerTitle}</h1>
            <p>{mode === 'login' ? t.loginIntro : t.registerIntro}</p>
          </div>

          {(notice || error) && (
            <div className={error ? 'auth-message error' : 'auth-message'} role={error ? 'alert' : 'status'}>
              <CircleAlert size={17} />
              <span>{error ?? notice}</span>
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
            <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy}>
              <span>{busy ? (mode === 'login' ? t.signingIn : t.creating) : (mode === 'login' ? t.continueLogin : t.continueRegister)}</span>
              <ArrowRight size={17} />
            </button>
          </form>

          <div className="auth-divider"><span>{locale === 'vi' ? 'hoặc' : 'or'}</span></div>
          <button className="auth-demo" type="button" disabled={busy} onClick={() => void enterDemo()}>
            <Sparkles size={17} />
            <span>{t.demo}</span>
          </button>
          <p className="auth-demo-note">{t.demoNote}</p>

          <div className="auth-privacy"><ShieldCheck size={17} /><span>{t.privacy}</span></div>
        </div>
      </section>
    </main>
  )
}
