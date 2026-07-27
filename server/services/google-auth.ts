import { OAuth2Client } from 'google-auth-library'

export type GoogleIdentity = {
  subject: string
  email: string
  name: string
  emailVerified: boolean
}

export type GoogleTokenVerifier = (credential: string, clientId: string) => Promise<GoogleIdentity>

export class InvalidGoogleIdentityError extends Error {}

export const verifyGoogleIdToken: GoogleTokenVerifier = async (credential, clientId) => {
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId })
    const payload = ticket.getPayload()
    const subject = payload?.sub
    const email = payload?.email?.trim().toLowerCase()
    if (!subject || !email || payload.email_verified !== true) {
      throw new InvalidGoogleIdentityError('Google did not return a verified account identity.')
    }
    return {
      subject,
      email,
      name: payload.name?.trim().slice(0, 100) || email.split('@')[0] || 'Google user',
      emailVerified: true,
    }
  } catch (error) {
    if (error instanceof InvalidGoogleIdentityError) throw error
    throw new InvalidGoogleIdentityError('Google credential verification failed.')
  }
}
