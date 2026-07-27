ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_subject_unique
  ON users (google_subject)
  WHERE google_subject IS NOT NULL;

DROP POLICY IF EXISTS auth_google_subject_bootstrap ON users;
CREATE POLICY auth_google_subject_bootstrap ON users FOR SELECT TO priorilearn_api
  USING (
    NULLIF(current_setting('app.auth_google_subject', true), '') IS NOT NULL
    AND google_subject = current_setting('app.auth_google_subject', true)
    AND deleted_at IS NULL
  );
