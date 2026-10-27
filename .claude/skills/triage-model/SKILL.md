---
name: triage-model
description: Score a GitHub issue's complexity and label it with the Claude model to solve it (model:haiku, model:sonnet, model:opus-plan, model:opus or needs-decision). Use when filing a new issue, when the user asks which model to use for an issue, or to triage backlog issues that have no model label yet.
---

# Model triage

Every open issue (except epics) carries exactly one of these labels, so the user can pick the model before starting a session and spend usage where it pays off.

| Label | Run it with | For |
|---|---|---|
| `model:haiku` | Haiku | Mechanical, fully specified, easy to check: version bumps, config edits, a check against live data with a known answer |
| `model:sonnet` | Sonnet | The default. Clear goal, a few files, normal feature or bug work |
| `model:opus-plan` | Opus in plan mode, then switch to Sonnet to build | Big or cross-cutting work where the design is the hard part and the typing is not |
| `model:opus` | Opus throughout | Judgement all the way down: evaluations, quality comparisons, debugging with no known cause |
| `needs-decision` | Nothing yet | The user hasn't decided what they want, or it's blocked on something only they can supply. Don't spend tokens on it |

## Scoring

Score each axis 0, 1 or 2 from the issue body and a quick look at the code it names. Don't read the whole codebase to triage; the issue plus the named files is enough.

| Axis | 0 | 1 | 2 |
|---|---|---|---|
| **Spread** | One file | One area (`pipeline/`, `site/` or `worker/`) | Crosses areas, or changes a shared type or the build cadence |
| **Ambiguity** | Says exactly what done looks like | Goal clear, some choices left | Open design question |
| **Judgement** | Mechanical | Some taste (visuals, wording) | Editorial or LLM-output quality, or architecture |
| **Risk** | Easy to verify locally | Needs live data or a real bulletin to check | Can break matchday coverage, live programmes or the Gemini/Workers AI quota |
| **Unknowns** | Cause and fix known | Some digging (logs, sources, a scrape) | Needs investigation or experiments first |

Total out of 10:

- **0–2 → `model:haiku`**, but only if Ambiguity and Risk are both 0; otherwise Sonnet. A Haiku attempt that fails costs more than a Sonnet one that works.
- **3–6 → `model:sonnet`**
- **7–10 → `model:opus-plan`**, or **`model:opus`** when Judgement or Unknowns is 2 and there's little code to write (research, evaluations, hard bugs).
- **`needs-decision`** overrides the score when the issue says it's undecided, has no body, or waits on something from the user (images, a choice of look). Note what the build would score once decided.

An issue that is fixed and only waiting on a live check is `model:haiku`.

## Filing a new issue

Score it as part of filing and add the label with `gh issue create --label`. Don't add a comment with the breakdown; the label is the record.

## Triaging the backlog

1. Make sure the labels exist (`gh label create ... --force` is safe to rerun):
   - `model:haiku` `#C2E0C6`, `model:sonnet` `#BFD4F2`, `model:opus-plan` `#D4C5F9`, `model:opus` `#5319E7`, `needs-decision` `#FBCA04`
2. `gh issue list --state open --limit 100 --json number,title,labels,body` and take the ones with no `model:*` or `needs-decision` label. Skip epics (e.g. #42).
3. Show the user a table: issue, the five scores, total, suggested label, and a few words of why. Ask before applying.
4. Apply with `gh issue edit <n> --add-label <label>`. When re-triaging an issue whose scope changed, remove the old label in the same call.
