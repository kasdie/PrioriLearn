type CredentialResponse = { credential: string }

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (configuration: {
        client_id: string
        callback: (response: CredentialResponse) => void
        context?: 'signin' | 'signup' | 'use'
      }) => void
      renderButton: (
        parent: HTMLElement,
        options: {
          theme: 'outline' | 'filled_blue' | 'filled_black'
          size: 'large' | 'medium' | 'small'
          text: 'signin_with' | 'signup_with' | 'continue_with'
          locale?: string
          width?: number
        },
      ) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityApi
  }
}

let googleIdentityLoader: Promise<GoogleIdentityApi> | undefined

export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (window.google?.accounts.id) return Promise.resolve(window.google)
  if (googleIdentityLoader) return googleIdentityLoader

  googleIdentityLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-priorilearn-google-identity]')
    const script = existing ?? document.createElement('script')
    const complete = () => {
      if (window.google?.accounts.id) resolve(window.google)
      else reject(new Error('Google Identity Services did not load.'))
    }

    script.addEventListener('load', complete, { once: true })
    script.addEventListener('error', () => reject(new Error('Google Identity Services could not load.')), { once: true })
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.priorilearnGoogleIdentity = 'true'
      document.head.append(script)
    }
  })

  return googleIdentityLoader
}
