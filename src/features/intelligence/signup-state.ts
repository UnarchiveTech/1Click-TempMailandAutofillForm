/** Metadata only: passwords and verification tokens never cross this protocol. */
export interface SignupAttemptRef {
  id: string;
  credentialId: string;
  domain: string;
  email: string;
  submitted: boolean;
  expiresAt: number;
}

export interface SignupPageEvidence {
  accountCreated: boolean;
  emailVerification: 'unknown' | 'pending' | 'confirmed';
  failed: boolean;
}

export type SignupProgress =
  | 'submitted'
  | 'created'
  | 'verification_pending'
  | 'email_confirmed'
  | 'failed';
