# Devpost Submission Notes

## Category

Education

## One-line description

PrioriLearn AI is an explainable, approval-gated study coach that tells a student what to do now and shows the academic cost of waiting.

## Project description draft

Students do not usually procrastinate because they lack a to-do list. They procrastinate because a semester is a pile of assignments, grade impact, fatigue, and calendar conflicts with no credible answer to what deserves attention first.

PrioriLearn converts syllabus, tasks, availability, and optional LMS/calendar context into a transparent priority assessment. It shows Cost of Delay, proposes a realistic first block, and adapts when the student gets stuck. Every plan and replacement remains a proposal until the student explicitly approves its current version.

The demo is runnable without a school account or API key. Judges can upload the included syllabus and ICS files; the API labels its deterministic provider in this mode. With an OpenAI key, the same provider contract uses GPT-5.6 file input and structured output. Scoring, scheduling, permissions, tenant isolation, and approval state transitions remain deterministic.

The architecture supports personal tenants today and a privacy-safe institution path later. V1 has no institution endpoint for individual progress, inferred risk, plans, or learner profiles. Future cohort output requires separate consent and at least 10 members.

## Codex and GPT-5.6 narrative

Codex was used to turn the product concept into the working React/TypeScript experience, Node API, multi-tenant contracts, deterministic score/scheduler, OpenAI provider boundary, PostgreSQL migration, tests, extension package, sample data, and product/design/submission documentation.

GPT-5.6 is integrated through the OpenAI Responses API for source-grounded document extraction and structured coaching proposals. Zod schemas constrain output. The model never approves or mutates a plan; API version checks and explicit user actions control those transitions. A deterministic provider preserves the full demo when credentials are unavailable and makes that state visible through `/api/health`.

## Three-minute video path

1. Upload `sample-data/demo-syllabus.txt`; show the review gate.
2. Confirm, return to Today, and point out the score, evidence, and highlighted Cost of Delay.
3. Start the 45-minute focus block.
4. Approve the proposed day, report “Mình đang bị kẹt,” then approve the 20-minute recovery plan.
5. Close on the provider boundary, tests, privacy model, and read-only Canvas extension.

## Final checklist

- [x] Local web/API run with no credentials.
- [x] Lint, 18 automated tests, and production build pass.
- [x] README, sample data, product spec, design doc, build plan, and Vietnamese deck are included.
- [ ] Deploy the web/API to a public URL.
- [ ] Replace the local URL in `extension/popup.js` with the deployment URL.
- [ ] Record and publish the video under three minutes.
- [ ] Add repository/demo/video URLs and required Codex session evidence to Devpost.
- [ ] Verify repository visibility and final judging access.
