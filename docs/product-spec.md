# PrioriLearn AI Product Spec

## Product promise

PrioriLearn gives university students a defensible answer to “What should I do right now?” It combines academic stakes, delay risk, time available, and the student’s own goals to propose a realistic next action. It does not silently take control of the student’s calendar or academic work.

## Users and jobs

| User | Job | Current failure |
| --- | --- | --- |
| Overloaded student | Decide what deserves attention today | Deadline lists hide academic consequence and effort |
| Student who is stuck | Restart without shame or a total reset | Generic reminders do not reduce friction |
| Returning student | Maintain a plan that matches reality | Static schedules break after one interruption |
| Future institution admin | Understand program-wide friction safely | Individual student data is too sensitive to expose |

## V1 requirements

1. A student can create an email/password account, select Vietnamese or English, choose a coach mode, and later opt into Google sign-in.
2. A student can import PDF/syllabus material, ICS calendar data, or manual tasks. Calendar and Canvas connections use distinct consent flows.
3. The system extracts courses, grade weights, deadlines, and tasks into a review queue. Nothing reaches the plan until confirmed.
4. The Today view displays one highest-priority task, explanation, Cost of Delay, starter step, and focus action.
5. The plan is a proposal until the student approves it. A coach check-in can propose a replan but cannot apply it automatically.
6. The browser extension reads the active Canvas context only after the student opens it.
7. Raw uploaded files are automatically deleted after 30 days; users can delete their account and structured data.

## Priority scoring

`Priority = 0.30 academic impact + 0.25 failure risk + 0.20 cost of delay + 0.15 goal alignment + 0.10 actionability`

Every factor is normalized to 0-100 and shown with source evidence. Actionability rewards a useful next step that fits the student’s available time; it does not reward ignoring hard work. Grade/GPA forecasts are ranges with assumptions and confidence, not promises.

## Coach modes

| Mode | Behavior |
| --- | --- |
| Nhẹ | One daily suggestion, flexible blocks, minimal reminders |
| Tập trung | Check-ins around planned sessions, replan suggestions after missed work |
| Kỷ luật | Explicit time blocks, start/end prompts, proactive recovery suggestions |

Advanced settings expose each reminder and replanning boundary after onboarding.

## Pilot metrics

- Activation: confirmed import and first approved plan.
- Plan acceptance/edit rate.
- Completion of the highest-priority task.
- D7 retention and weekly focus-session count.
- Change in self-reported procrastination.
- Optional academic outcome signal, never a causal GPA claim.

## Out of scope for the demo

- Automatic calendar writes.
- Direct LMS writes, grade submissions, or institution-level student surveillance.
- Pricing, billing, and marketing automation.
- Claims that the agent predicts a final grade with certainty.

## Current build coverage

The current build implements private account onboarding, PostgreSQL/Supabase production persistence, the complete student decision loop, API-side review/approval boundaries, deterministic scoring/scheduling, sample PDF/text and ICS inputs, and the read-only extension preview. Google/Canvas OAuth callbacks, a field-level extraction editor, email verification/password reset, daily email delivery, and the institution surface remain post-demo milestones. The current build exposes no institution-facing student data.
