# Implementation Plan — Rules-First Safety Engine & Test Harness

> Detailed plan for hardening the deterministic safety layer, implementing comprehensive unit tests, adding Zod environment validation, and securing all message pathways.

---

## 1. Objectives & Scope

1. **Unify Rules-First Escalation:** Consolidate hard safety checks (KillSwitch, Blackout hours, Rate limits, URLs, Length) and pre-flight escalation rules (Contact groups, Money requests, Location queries, Word count) into a dedicated, modular `src/safety/` domain.
2. **Prevent Escalation Bypasses:** Ensure all contact modes (`IMPERSONATOR` and `TUTOR`) pass through deterministic escalation checks before any LLM API is invoked.
3. **Decouple Rule Logic for 100% Testability:** Extract rule logic into pure, zero-dependency functions that can be tested across hundreds of permutations without requiring live databases.
4. **Comprehensive Test Suite:** Install and configure Vitest; author thorough unit tests covering every single rule, boundary condition, and edge case.
5. **Runtime Schema Validation:** Implement strict Zod schema validation for all application environment variables in `src/config/env.ts`.
6. **Documentation & Standards:** Update `README.md` and `.env.example` to reflect the production-grade architecture and testing commands.

---

## 2. Design Options & Trade-Offs

### Option 1: Monolithic Safety Engine (Current Pattern Extended)
- **Description:** Keep all safety and preflight checks in a single large `safetyEngine.ts` file, adding new helper methods directly.
- **Trade-offs:** 
  - *Pros:* Quick to edit; single file.
  - *Cons:* Degrades modularity; mixes database I/O with pure business rules; makes mocking difficult; risks accidental regressions as rules expand.

### Option 2 (Recommended): Modular Functional Pipeline
- **Description:** Structure `src/safety/` into focused, pure functional modules:
  - `src/safety/rules/hardSafety.ts`: Pure functions for kill switch, blackout hours, daily limits, URL detection, and minimum length.
  - `src/safety/rules/escalation.ts`: Pure functions for contact group check, Sheng/English money request classification, location inquiries, and word count limits.
  - `src/safety/types.ts`: Clean TypeScript interfaces for safety and escalation results.
  - `src/safety/safetyEngine.ts`: The facade coordinator that fetches data (Prisma/Redis) and executes the functional pipeline.
- **Trade-offs:**
  - *Pros:* 100% pure unit testability; clean separation of concerns; zero chance of LLM bypassing escalation in any mode; strictly typed with no `any`.
  - *Cons:* Requires creating clear internal contracts and updating call sites in `whatsappClient.ts` and `personaEngine.ts`.

### Option 3: Class-Based Strategy / Middleware Pattern
- **Description:** Define an abstract `Rule` interface with classes like `BlackoutRule`, `MoneyRequestRule`, chained in an execution pipeline.
- **Trade-offs:**
  - *Pros:* Formal OOP pattern.
  - *Cons:* Unnecessary object allocation and boilerplate for a TypeScript backend; functional composition is more idiomatic and simpler to test in Node.js.

**Decision:** We choose **Option 2**. It directly fulfills the core architectural standard: *“Keep the rules/safety layer separate from the LLM layer with clear interfaces, and unit test every rule.”*

---

## 3. Step-by-Step Implementation Roadmap

### Phase 3.1: Testing Infrastructure & Config Validation
1. Install `vitest` as a dev dependency.
2. Add test scripts to `backend/package.json` (`npm test`, `npm run test:watch`).
3. Create `backend/src/config/env.ts` using `zod` to validate all runtime environment variables with clean default values.
4. Author `backend/src/config/env.test.ts` to verify schema validation and fail-fast behavior on missing configs.

### Phase 3.2: Modular Safety & Escalation Pure Rules
1. Create `backend/src/safety/types.ts`:
   - `SafetyCheckResult`: `{ shouldReply: boolean; reason: string; }`
   - `EscalationCheckResult`: `{ shouldFlag: boolean; reason?: string; }`
   - `CombinedSafetyEvaluation`: `{ passed: boolean; shouldFlag: boolean; reason: string; }`
2. Create `backend/src/safety/rules/hardSafety.ts`:
   - `isKillSwitchActive(killSwitch: boolean): boolean`
   - `isWithinBlackoutHours(now: Date, start: string, end: string): boolean`
   - `isDailyLimitExceeded(currentCount: number, limit: number): boolean`
   - `containsUrl(content: string): boolean`
   - `isMessageTooShort(content: string, minLength?: number): boolean`
3. Create `backend/src/safety/rules/escalation.ts`:
   - `shouldEscalateContactGroup(group: string): boolean`
   - `isWordCountExceeded(content: string, maxWords?: number): boolean`
   - `isMoneyRequest(content: string): { isRequest: boolean; isOffering: boolean }`
   - `isLocationInquiry(content: string): boolean`
4. Update `backend/src/safety/safetyEngine.ts`:
   - Coordinate hard safety checks and escalation evaluations.
   - Provide `checkMessageSafety(params: { contactId, group, platform, content })`.

### Phase 3.3: Wiring and Clean AI Engine Integration
1. Refactor `personaEngine.ts`:
   - Remove redundant local `preFlightCheck` and delegate to the centralized escalation rules or receive the pre-evaluated safety result from the coordinator.
   - Keep `personaEngine.ts` strictly focused on Gemini persona generation and prompt building.
2. Update `whatsappClient.ts`:
   - Ensure the unified safety evaluation runs before both `IMPERSONATOR` and `TUTOR` mode branches.
   - Verify that any flagged message (in either mode) records `wasSent: false` in `AutoReply` and halts dispatch.

### Phase 3.4: Comprehensive Unit Test Authoring
1. Author `backend/src/safety/rules/hardSafety.test.ts`:
   - Boundary tests for blackout hours (same-day and overnight).
   - Rate limit thresholds.
   - URL variations (`http`, `https`, `www`, query params, benign words like `awww`).
   - Length edge cases (spaces, emojis, unicode).
2. Author `backend/src/safety/rules/escalation.test.ts`:
   - Contact groups (`CLIENT`, `UNKNOWN` flag; `FRIENDS`, `FAMILY`, `COLLEAGUES` allow).
   - Word count boundaries (50 vs 51 words).
   - Sheng/English money keywords (`ganji`, `mpesa`, `okolea`, etc.).
   - Money offering exemptions (`nimekutumia mpesa` passes).
   - Location inquiries (`uko wapi`, `side gani`, etc.).
3. Author integration test for `safetyEngine.ts` with mocked data sources.

---

## 4. Edge Cases & Risk Analysis

| Risk / Edge Case | Consequence | Mitigation Strategy |
| :--- | :--- | :--- |
| **Overnight Blackout Times** (e.g. 23:00 to 06:00) | Clock crossing midnight could cause inversion bugs if using simple `<` comparisons. | Fully unit-test both `start <= end` and `start > end` branches at boundaries (`22:59`, `23:00`, `23:59`, `00:00`, `05:59`, `06:00`). |
| **Substrings in Benign Words** (e.g., "awww" containing "www", or "equipment" containing "mpesa") | False positive blocks or escalations. | Use strict regex patterns and word boundary checks where appropriate while maintaining high recall for Sheng slang. |
| **Money Offering vs Request Confusion** (e.g. "nimekutumia mpesa, nipe confirmation") | May escalate an incoming payment as a money demand. | Priority check for offering patterns (`nimekutumia`, `nimesend`, `pokea`, `sent you`) before classifying request keywords. |
| **Tutor Mode Bypassing Escalation** | Sensitive client/unknown inquiries answered by Tutor. | Run the centralized escalation gate prior to entering either AI engine. |
| **Redis Downtime** | If Redis is down, `getReplyCount` might reject or throw. | Safety engine must catch Redis connection errors gracefully and fail safe (e.g., escalate or reject with clear log). |

---

## 5. Verification & Definition of Done Gate

1. `npx vitest run`: 100% unit tests pass with detailed coverage.
2. `npm run build`: Strict TypeScript build completes with zero errors, declarations generated, no `any`.
3. Local HTTP verification: Verify `/health` and `/api/status` start and respond without issues.
4. Git cleanliness: Small, atomic commits with descriptive commit messages.
5. Documentation: Complete `README.md` and `.env.example` updates.
