ALTER TABLE users
  ADD COLUMN onboarding_guide_seen_version integer NOT NULL DEFAULT 0,
  ADD COLUMN onboarding_guide_seen_at timestamptz;

ALTER TABLE users
  ADD CONSTRAINT users_onboarding_guide_seen_version_check
  CHECK (onboarding_guide_seen_version >= 0);

COMMENT ON COLUMN users.onboarding_guide_seen_version IS
  'Highest first-use guide version dismissed or completed by this account.';

COMMENT ON COLUMN users.onboarding_guide_seen_at IS
  'Time the account most recently advanced its seen guide version.';
