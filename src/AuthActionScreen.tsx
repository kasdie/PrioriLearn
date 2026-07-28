import { useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, Focus, KeyRound, MailCheck, ShieldCheck } from 'lucide-react'
import focusImage from './assets/study-focus.png'
import { ApiClientError, prioriApi, type ApiSession } from './lib/api'
import './AuthScreen.css'

export type AuthAction = {
  kind: 'verify-email' | 'reset-password'
  token: string
}

type AuthActionScreenProps = {
  action: AuthAction
  locale: 'vi' | 'en'
  onLocaleChange: (locale: 'vi' | 'en') => void
  onCancel: () => void
  onAuthenticated: (session: ApiSession) => Promise<void> | void
}

function actionError(error: unknown, locale: 'vi' | 'en'): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INVALID_OR_EXPIRED_TOKEN') {
      return locale === 'vi'
        ? 'Liên kết này không hợp lệ, đã hết hạn hoặc đã được sử dụng.'
        : 'This link is invalid, expired, or has already been used.'
    }
    if (error.code === 'AUTH_RATE_LIMITED') {
      return locale === 'vi'
        ? 'Bạn đã thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.'
        : 'Too many attempts. Wait a moment before trying again.'
    }
    if (error.code === 'VALIDATION_ERROR') {
      return locale === 'vi'
        ? 'Mật khẩu phải có từ 8 đến 128 ký tự.'
        : 'The password must be between 8 and 128 characters.'
    }
    return error.message
  }
  return locale === 'vi'
    ? 'Không thể kết nối tới PrioriLearn. Vui lòng thử lại.'
    : 'Could not connect to PrioriLearn. Please try again.'
}

export function AuthActionScreen({
  action,
  locale,
  onLocaleChange,
  onCancel,
  onAuthenticated,
}: AuthActionScreenProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const tokenLooksValid = action.token.length >= 32 && action.token.length <= 512
  const [error, setError] = useState<string | null>(() => tokenLooksValid
    ? null
    : locale === 'vi'
      ? 'Liên kết này không hợp lệ hoặc đã bị cắt ngắn.'
      : 'This link is invalid or incomplete.')
  const verification = action.kind === 'verify-email'
  const title = verification
    ? (locale === 'vi' ? 'Xác minh email của bạn' : 'Verify your email')
    : (locale === 'vi' ? 'Chọn mật khẩu mới' : 'Choose a new password')
  const intro = verification
    ? (locale === 'vi'
      ? 'Xác nhận địa chỉ email để bảo vệ tài khoản và nhận các thông báo bạn chủ động bật.'
      : 'Confirm your email address to protect your account and receive notifications you enable.')
    : (locale === 'vi'
      ? 'Mật khẩu mới sẽ thay thế mật khẩu cũ và đăng xuất mọi phiên đang mở.'
      : 'Your new password will replace the old one and sign out every existing session.')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    if (!tokenLooksValid) return
    if (!verification && password !== confirmation) {
      setError(locale === 'vi' ? 'Hai mật khẩu chưa khớp.' : 'The passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = verification
        ? await prioriApi.confirmEmailVerification(action.token)
        : await prioriApi.confirmPasswordReset(action.token, password)
      await onAuthenticated(session)
    } catch (submitError) {
      setError(actionError(submitError, locale))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-label={title}>
        <img src={focusImage} alt={locale === 'vi' ? 'Sinh viên xem lại kế hoạch học tập bên máy tính' : 'Student reviewing a study plan beside a laptop'} />
        <div className="auth-visual-shade" />
        <div className="auth-visual-copy">
          <span>{locale === 'vi' ? 'Bảo vệ không gian học' : 'Protect your workspace'}</span>
          <h2>{locale === 'vi' ? 'Dữ liệu học tập của bạn luôn thuộc về bạn.' : 'Your study data stays yours.'}</h2>
          <p>{locale === 'vi' ? 'Một bước ngắn để giữ tài khoản an toàn.' : 'One short step to keep your account secure.'}</p>
        </div>
      </section>

      <section className="auth-panel">
        <header className="auth-header">
          <div className="brand" aria-label="PrioriLearn">
            <span className="brand-mark"><Focus size={19} strokeWidth={2.6} /></span>
            <span>priori<span>learn</span></span>
          </div>
          <div className="language-switch" aria-label={locale === 'vi' ? 'Ngôn ngữ' : 'Language'}>
            <button className={locale === 'vi' ? 'selected' : ''} onClick={() => onLocaleChange('vi')} type="button">VI</button>
            <button className={locale === 'en' ? 'selected' : ''} onClick={() => onLocaleChange('en')} type="button">EN</button>
          </div>
        </header>

        <div className="auth-form-wrap auth-action-wrap">
          <button className="auth-back" type="button" onClick={onCancel}>
            <ArrowLeft size={16} />
            <span>{locale === 'vi' ? 'Quay lại' : 'Go back'}</span>
          </button>
          <div className="auth-action-icon" aria-hidden="true">
            {verification ? <MailCheck size={23} /> : <KeyRound size={23} />}
          </div>
          <div className="auth-heading">
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>

          {error && (
            <div className="auth-message error" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {!verification && (
              <>
                <label>
                  <span>{locale === 'vi' ? 'Mật khẩu mới' : 'New password'}</span>
                  <div className="password-field">
                    <input
                      required
                      autoFocus
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      title={showPassword ? (locale === 'vi' ? 'Ẩn mật khẩu' : 'Hide password') : (locale === 'vi' ? 'Hiện mật khẩu' : 'Show password')}
                      aria-label={showPassword ? (locale === 'vi' ? 'Ẩn mật khẩu' : 'Hide password') : (locale === 'vi' ? 'Hiện mật khẩu' : 'Show password')}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
                <label>
                  <span>{locale === 'vi' ? 'Nhập lại mật khẩu' : 'Confirm password'}</span>
                  <input
                    required
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    type={showPassword ? 'text' : 'password'}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            )}
            <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy}>
              <span>
                {busy
                  ? (locale === 'vi' ? 'Đang xác nhận...' : 'Confirming...')
                  : verification
                    ? (locale === 'vi' ? 'Xác minh email' : 'Verify email')
                    : (locale === 'vi' ? 'Đặt mật khẩu mới' : 'Set new password')}
              </span>
              <ArrowRight size={17} />
            </button>
          </form>

          <div className="auth-privacy">
            <ShieldCheck size={17} />
            <span>{locale === 'vi' ? 'Liên kết chỉ dùng được một lần.' : 'This link can only be used once.'}</span>
          </div>
        </div>
      </section>
    </main>
  )
}
