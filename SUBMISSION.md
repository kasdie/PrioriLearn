# Devpost Submission Notes

## Category

Education

## One-line description

PrioriLearn AI is an explainable, approval-gated study coach that tells a student what to do now and shows the academic cost of waiting.

## Project description draft

Students do not usually procrastinate because they lack a to-do list. They procrastinate because a semester is a pile of assignments, grade impact, fatigue, and calendar conflicts with no credible answer to what deserves attention first.

PrioriLearn converts syllabus, tasks, availability, and optional LMS/calendar context into a transparent priority assessment. It shows Cost of Delay, proposes a realistic first block, and adapts when the student gets stuck. Every plan and replacement remains a proposal until the student explicitly approves its current version.

The local demo mode is runnable without a school account or API key. The production app uses verified Google Sign-In; judges can then upload the included syllabus and ICS files. With an OpenAI key, the provider contract uses GPT-5.6 file input and structured output. Scoring, scheduling, permissions, tenant isolation, and approval state transitions remain deterministic.

The architecture supports personal tenants today and a privacy-safe institution path later. V1 has no institution endpoint for individual progress, inferred risk, plans, or learner profiles. Only activity created after research opt-in is eligible for future aggregates; revocation clears prior eligibility, and every cohort must contain at least 10 members.

## Codex and GPT-5.6 narrative

Codex was used to turn the product concept into the working React/TypeScript experience, Node API, multi-tenant contracts, deterministic score/scheduler, OpenAI provider boundary, PostgreSQL migration, tests, extension package, sample data, and product/design/submission documentation.

GPT-5.6 is integrated through the OpenAI Responses API for source-grounded PDF, image, and text extraction plus structured coaching proposals. PNG/JPEG screenshots use private image inputs; Zod schemas constrain output. The model never approves or mutates a plan; API version checks and explicit user actions control those transitions. A deterministic provider preserves the full demo when credentials are unavailable and makes that state visible through `/api/health`.

## Three-minute video path

1. Upload `sample-data/demo-syllabus.txt`; show the review gate.
2. Confirm, return to Today, and point out the score, evidence, and highlighted Cost of Delay.
3. Start the 45-minute focus block.
4. Approve the proposed day, report “Mình đang bị kẹt,” then approve the 20-minute recovery plan.
5. Close on the provider boundary, tests, privacy model, and read-only Canvas extension.

## Published URLs

- Repository: https://github.com/kasdie/PrioriLearn
- Production app: https://priori-learn-kasdies-projects.vercel.app
- API health: https://priorilearn-api.onrender.com/api/health

## Final checklist

- [x] Local web/API run with no credentials.
- [x] Lint, 116 unit/API/component tests, 14 PostgreSQL integration tests, 5 browser E2E tests, and the production build pass.
- [x] README, sample data, product spec, design doc, build plan, and Vietnamese deck are included.
- [x] Deploy the web/API to public URLs.
- [x] Point `extension/popup.js` at the stable production URL.
- [ ] Record and publish the video under three minutes.
- [ ] Add the video URL and required Codex session evidence to Devpost.
- [x] Verify repository visibility and final judging access.
