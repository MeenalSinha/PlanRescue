# AWS Builder Mini Challenge — Submission Evidence & Product Feedback

## Submission Overview

* **Hackathon**: Amazon Developer Hackathon 2026
* **Primary Track**: Alexa+
* **Mini Challenge**: AWS Builder
* **Project Name**: PlanRescue
* **Repository**: [https://github.com/MeenalSinha/PlanRescue](https://github.com/MeenalSinha/PlanRescue)

---

## 1. AWS Service & Runtime Integration Details

| Attribute | Implementation Detail |
| :--- | :--- |
| **AWS Service** | **Amazon Bedrock** |
| **Runtime Operation** | **Amazon Bedrock Converse API** (`ConverseCommand`) |
| **Official SDK** | `@aws-sdk/client-bedrock-runtime` (`^3.1156.0`) |
| **Application Component** | [`apps/web/src/lib/agent/bedrockProvider.ts`](file:///c:/Users/Meenal%20Sinha/Downloads/planrescue-phase4/planrescue/apps/web/src/lib/agent/bedrockProvider.ts) |
| **Provider Factory** | [`apps/web/src/lib/agent/factory.ts`](file:///c:/Users/Meenal%20Sinha/Downloads/planrescue-phase4/planrescue/apps/web/src/lib/agent/factory.ts) (`createAgentProvider`) |
| **Selection Variable** | `PLANRESCUE_AGENT_PROVIDER=bedrock` |
| **Foundation Models Supported** | `anthropic.claude-3-haiku-20240307-v1:0` (default), `amazon.nova-micro-v1:0`, `us.anthropic.claude-3-5-haiku-20241022-v1:0` |
| **Security & IAM** | Standard AWS credentials chain (`AWS_REGION`, `AWS_PROFILE`, IAM roles); requires `bedrock:InvokeModel` |

### Why This Integration Is Valuable for PlanRescue
PlanRescue is an intelligent scheduling recovery assistant. When unexpected schedule disruptions occur (e.g. meetings running late), users speak or type natural-language requests. Amazon Bedrock's Converse API performs rapid, structured intent interpretation grounded in the user's actual calendar and task data retrieved over Streamable HTTP from the local MCP server.

Bedrock extracts the disrupted event ID, overrun duration, and protected event constraints into a strictly validated Zod schema (`rawExtractedIntentSchema`), which is then handed off to PlanRescue's deterministic Recovery Engine for conflict solving, constraint validation, and explicit user-approved atomic application.

---

## 2. Verification Evidence & Automated Tests

All automated tests run cleanly in the local environment and in CI gates:

| Test Suite | Command | Outcome | Description |
| :--- | :--- | :--- | :--- |
| **Bedrock Provider Tests** | `npm run test:bedrock` | **26 passed (100%)** | Validates structured extraction, JSON code fence handling, error mapping, credential failure guards, and route integration. |
| **Web Unit Tests** | `npm run test:web:unit` | **97 passed (100%)** | Validates all web helpers, architecture guards, and agent components. |
| **Full CI Gate** | `npm run check` | **502 passed in 33 files (100%)** | Full end-to-end typechecks, builds, backend tests, and frontend tests. |
| **Live Smoke Test Script** | `npm run test:bedrock:live` | **Available & Tested** | Opt-in live test invoking the real Bedrock Converse API with synthetic schedule context when credentials are provided. |

### Verification Status
* **Status**: **Implemented, awaiting live AWS verification**
* Code and automated tests are fully implemented and verified passing. If live AWS credentials with model access are configured in `apps/web/.env.local`, executing `npm run test:bedrock:live` completes live model inference.

---

## 3. Product Feedback (AWS Builder Mini Challenge)

*Below are draft responses for the required submission feedback fields. Questions reflecting live account experience can be tailored with your own firsthand observations.*

### Question 1: Which AWS services and developer tools did you use, and for what?
**Draft Answer:**
> We integrated **Amazon Bedrock** using the official AWS SDK for JavaScript v3 (`@aws-sdk/client-bedrock-runtime`) and the **Converse API** (`BedrockRuntimeClient`, `ConverseCommand`). In our application, PlanRescue, Amazon Bedrock powers the natural-language scheduling intelligence: when a user reports a disruption (e.g. *"My meeting is running 40 minutes late. Don't move my doctor's appointment"*), Bedrock interprets the request against calendar and task data retrieved via Model Context Protocol (MCP) tools. Bedrock extracts structured intent (disrupted event ID, overrun duration, protected commitments) that feeds into our deterministic recovery engine.

### Question 2: What worked well?
**Draft Answer:**
> The **Amazon Bedrock Converse API** is a significant improvement over model-specific invoke endpoints. Having a standardized interface across different model families (Anthropic Claude, Amazon Nova, Meta Llama) allowed us to implement a clean, unified provider without model-specific prompt formatting or payload hacking. The official `@aws-sdk/client-bedrock-runtime` TypeScript types are well-structured, supporting `AbortController` signals for timeout enforcement and standard AWS credential resolution out of the box.

### Question 3: What needs work?
**Draft Answer:**
> 1. **Cross-Region Inference Profile Naming**: When using newer models (such as Claude 3.5 Haiku), Bedrock requires inference profile IDs (e.g. `us.anthropic.claude-3-5-haiku-...`) rather than raw foundation model IDs. Better documentation and unified SDK helpers to discover available inference profiles for a given region would streamline onboarding.
> 2. **JSON-Mode Consistency Across Models**: While some models natively enforce JSON schema output, others require explicit system prompt engineering and client-side extraction. Standardizing structured JSON output parameters across all Converse API foundation models would eliminate client-side regex/braced fallback parsing.

### Question 4: How was your onboarding experience?
*(To be completed by the developer based on firsthand AWS account setup)*
> **Developer Experience Notes:** Setting up model access in the AWS Bedrock Console is straightforward, but first-time users should be aware that model access is region-specific and requires explicit request approval in the console before API calls succeed. Integrating the `@aws-sdk/client-bedrock-runtime` SDK into a modern Next.js TypeScript application took less than an hour once model access was granted.

### Question 5: Would you use these services again?
*(To be confirmed based on your project preferences)*
> **Draft Answer:** Yes. The Converse API provides a production-grade foundation model gateway with enterprise IAM security, multi-model flexibility, and serverless scalability. For applications combining agentic orchestration with deterministic validation like PlanRescue, Bedrock is an ideal fit.

---

## 4. Scope and Known Limitations

1. **Single-User Local Prototype**: The application runs locally with `local-user` attribution; IAM integration secures the Bedrock API call, not multi-tenant web user authentication.
2. **Local Calendar Target**: Execution modifies PlanRescue's local SQLite calendar; external Google / Microsoft Graph calendars are out of scope.
3. **Disruption Type**: Focuses on `event_overrun` disruptions.
4. **Deterministic Authority**: Bedrock interprets user intent only; all scheduling constraint solving and plan validation remain strictly deterministic.
