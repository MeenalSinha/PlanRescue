# Amazon Bedrock Integration & AWS Runtime Architecture

## Overview

PlanRescue is a consequence-aware schedule recovery system developed for the **Amazon Developer Hackathon 2026, Alexa+ Track & AWS Builder Mini Challenge**.

In Phase 9, PlanRescue integrates **Amazon Bedrock** as a first-class foundation model provider for its natural-language scheduling agent. Users can describe complex schedule disruptions in plain English (e.g., *"My team meeting is running 40 minutes late. Fix my afternoon, but don't move my doctor's appointment"*), which PlanRescue interprets through Amazon Bedrock using the official AWS SDK for JavaScript v3.

The Bedrock provider is pluggable and selectable alongside the existing OpenAI provider via `PLANRESCUE_AGENT_PROVIDER`. Crucially, **Amazon Bedrock only interprets user scheduling intent**; all scheduling feasibility calculations, constraint solving, independent validation, and plan execution remain strictly deterministic and governed by the local Model Context Protocol (MCP) server and SQLite persistence layer.

---

## Architecture

The natural-language recovery pipeline connects the Next.js web application, the official AWS Bedrock Runtime SDK, and the local MCP server:

```
User natural-language request
        │
        ▼
PlanRescue Next.js API (/api/agent/turn)
        │
        ├── 1. MCP get_schedule & get_tasks (grounding context)
        │
        ▼
Provider Factory (createAgentProvider)
        │
        ├── PLANRESCUE_AGENT_PROVIDER=openai  ──► OpenAI API (gpt-4o-mini)
        │
        └── PLANRESCUE_AGENT_PROVIDER=bedrock ──► Amazon Bedrock Converse API
                                                    (BedrockRuntimeClient + ConverseCommand)
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
Structured JSON Intent Output
        │
        ▼
Zod Schema Validation (rawExtractedIntentSchema)
        │
        ▼
Grounded Schedule Verification (rejects hallucinated event IDs)
        │
        ▼
MCP analyze_conflicts (deterministic conflict & cascade analysis)
        │
        ▼
MCP propose_recovery_plan (multi-strategy constraint solver)
        │
        ▼
MCP validate_recovery_plan (independent hard-constraint validator)
        │
        ▼
Grounded Explanation Generation & User Review
        │
        ▼
Explicit User Approval & Apply Confirmation (Two-Step Safety Gate)
        │
        ▼
MCP apply_approved_plan (Atomic SQLite Transaction & Audit Log)
```

### Components

1. **Official AWS SDK v3 Client**:
   * Package: `@aws-sdk/client-bedrock-runtime` (`^3.1156.0`).
   * API: `BedrockRuntimeClient` and `ConverseCommand`.
   * Standardized Conversation Inference: Submits structured system instructions, grounded calendar context, and bounded conversation history (last 6 turns) using the Converse API.
2. **BedrockProvider Adapter ([`apps/web/src/lib/agent/bedrockProvider.ts`](file:///c:/Users/Meenal%20Sinha/Downloads/planrescue-phase4/planrescue/apps/web/src/lib/agent/bedrockProvider.ts))**:
   * Implements the unified [`LlmProvider`](file:///c:/Users/Meenal%20Sinha/Downloads/planrescue-phase4/planrescue/apps/web/src/lib/agent/provider.ts) interface.
   * Enforces configurable request timeouts via `AbortController`.
   * Sanitizes and parses textual responses (supporting clean JSON, fenced markdown blocks, and braced extraction).
   * Validates structured output using Zod (`rawExtractedIntentSchema`).
   * Normalizes model responses into the canonical `ExtractedIntent` contract.
3. **Provider Factory ([`apps/web/src/lib/agent/factory.ts`](file:///c:/Users/Meenal%20Sinha/Downloads/planrescue-phase4/planrescue/apps/web/src/lib/agent/factory.ts))**:
   * Selects `BedrockProvider` when `PLANRESCUE_AGENT_PROVIDER=bedrock`.
   * Selects `OpenAiProvider` when `PLANRESCUE_AGENT_PROVIDER=openai` (or unset).
   * Keeps orchestrator logic strictly provider-agnostic.
4. **Safety & Read-Only AI Agent**:
   * The AI agent allowlist is restricted strictly to read-only MCP tools (`get_schedule`, `get_tasks`, `analyze_conflicts`, `propose_recovery_plan`, `validate_recovery_plan`).
   * Write tools (`approve_recovery_plan`, `reject_recovery_plan`, `apply_approved_plan`) are **never** exposed to the LLM.
   * Event references extracted by the LLM are checked against actual calendar events retrieved via MCP; hallucinated IDs are immediately rejected.

---

## Prerequisites

To use Amazon Bedrock with PlanRescue:

1. **AWS Account**: An active AWS account with Amazon Bedrock enabled.
2. **Model Access**: Request model access in the AWS Management Console for your desired foundation model:
   * **Amazon Bedrock Console** -> **Model access** -> Request access for **Anthropic Claude 3 Haiku**, **Claude 3.5 Haiku**, or **Amazon Nova Micro / Lite**.
3. **AWS Region**: A region supporting the selected Bedrock model (e.g. `us-east-1`, `us-west-2`, `ap-south-1`, `eu-central-1`).
4. **IAM Permissions**: The authenticated AWS identity must have at least the following permission:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
5. **AWS Credentials**: Standard AWS SDK credential-provider chain:
   * Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, (and `AWS_SESSION_TOKEN` if using temporary credentials).
   * AWS CLI profile: `~/.aws/credentials` and `~/.aws/config` (selected via `AWS_PROFILE`).
   * IAM Roles for EC2/ECS/EKS/Lambda when deployed.

---

## Configuration

Configure the web application in `apps/web/.env.local`:

```bash
# -----------------------------------------------------------------------------
# PlanRescue AI Agent Configuration (apps/web/.env.local)
# -----------------------------------------------------------------------------

# Select Amazon Bedrock as the AI provider
PLANRESCUE_AGENT_PROVIDER=bedrock

# AWS Region where your Bedrock model access is enabled
AWS_REGION=us-east-1

# Optional: AWS CLI profile name from ~/.aws/credentials
# AWS_PROFILE=planrescue

# Configurable foundation model ID or inference profile ID
# Default: anthropic.claude-3-haiku-20240307-v1:0
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0

# Optional: Maximum inference timeout in milliseconds (5000-120000)
PLANRESCUE_AGENT_TIMEOUT_MS=30000

# Optional: Set to false to disable natural-language agent
PLANRESCUE_AGENT_ENABLED=true
```

*(Note: When `PLANRESCUE_AGENT_PROVIDER=bedrock` is configured, no `OPENAI_API_KEY` is required).*

---

## Running the Application

### 1. Start the MCP Server (Terminal 1)
```bash
npm run dev:mcp
```
Starts the Streamable HTTP MCP server on `http://127.0.0.1:3001/mcp` and seeds the local SQLite database.

### 2. Start the Next.js Web App (Terminal 2)
```bash
npm run dev:web
```
Runs the web application on `http://127.0.0.1:3000`.

### 3. Natural-Language Scheduling in UI
1. Navigate to `http://127.0.0.1:3000`.
2. In the **PlanRescue AI Agent** chat interface, enter:
   > *"My team meeting is running 40 minutes late. Fix my afternoon, but don't move my doctor's appointment."*
3. The server calls the Amazon Bedrock Converse API with grounded schedule context.
4. Bedrock extracts the structured intent (`targetEventId: "evt-001"`, `overrunMinutes: 40`, `protectedEventIds: ["evt-005"]`).
5. PlanRescue evaluates conflicts, calculates candidate recovery plans, and validates them independently.
6. The user inspects candidate trade-offs and can explicitly click **Approve** and **Apply**.

---

## Verification & Testing

### 1. Automated Unit & Integration Tests (No AWS Credentials Required)
Unit tests mock the AWS SDK client boundary to test model responses, JSON extraction, timeouts, authentication errors, access denial, and throttling:

```bash
# Run Bedrock-specific test suite (26 tests)
npm run test:bedrock

# Run all web unit tests (97 tests)
npm run test:web:unit

# Run full project CI verification gate (502 tests across 33 files)
npm run check
```

### 2. Live AWS Bedrock Smoke Test (Opt-In with Genuine AWS Credentials)
When genuine AWS credentials and model access are configured, run the live smoke test script:

```bash
# Set your AWS credentials
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"

# Run live Bedrock inference test
npm run test:bedrock:live
```

Expected output upon successful live verification:
```
================================================================
PlanRescue — Amazon Bedrock Live Runtime Verification
================================================================
Provider:        bedrock
AWS Region:      us-east-1
Bedrock Model:   anthropic.claude-3-haiku-20240307-v1:0
Credentials detected: YES

Submitting synthetic test prompt:
"My team meeting is running 40 minutes late. Fix my afternoon, but don't move my doctor's appointment."

----------------------------------------------------------------
Inference successful in 842ms!
Extracted Intent:
{
  "status": "supported",
  "disruptionType": "event_overrun",
  "targetEventId": "evt-001",
  "targetEventTitle": "Team Meeting",
  "overrunMinutes": 40,
  "protectedEventIds": [
    "evt-005"
  ],
  "preference": "minimal_disruption",
  "rationale": "Team meeting overrun of 40 minutes with doctor appointment protected."
}
----------------------------------------------------------------
VERIFICATION PASSED:
  ✓ Amazon Bedrock Converse API invocation succeeded.
  ✓ Structured intent parsed and schema-validated.
  ✓ Target event ID evt-001 grounded in schedule.
  ✓ Overrun minutes (40) accurately identified.
  ✓ Doctor's appointment preserved in protectedEventIds.
  ✓ Read-only guarantee: 0 calendar mutations executed.
```

If credentials are not yet configured, the script exits gracefully with setup instructions without failing the build.

---

## Troubleshooting

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| `AWS credentials are missing or could not be verified` | Environment lacks AWS keys or profile | Run `aws configure` or export `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. |
| `AWS authorization failed: Your AWS credentials lack bedrock:InvokeModel permission` | IAM user/role lacks invoke permission | Attach an IAM policy granting `bedrock:InvokeModel` for your Bedrock model resource. |
| `The configured Bedrock model was not found or is inaccessible` | Model access not requested in region | In the AWS Console, open Amazon Bedrock -> Model access -> Request access for the model. |
| `Amazon Bedrock timed out` | Network latency exceeded timeout | Increase `PLANRESCUE_AGENT_TIMEOUT_MS` (e.g. `45000`) in `apps/web/.env.local`. |
| `Amazon Bedrock is currently rate-limited` | AWS account quota reached | Wait a moment or request a quota increase for Bedrock InvokeModel TPS. |

---

## Security, Privacy & Cost Transparency

1. **Credential Safety**:
   * AWS credentials are **never** bundled into browser code, JavaScript bundles, HTTP responses, or export reports.
   * All Bedrock invocations occur strictly server-side in Next.js route handlers.
2. **Data Minimization**:
   * PlanRescue transmits only the prompt and synthetic/scheduled event titles and times necessary to ground intent.
   * No environment variables, database files, or secrets are ever sent to foundation models.
3. **Model Charges**:
   * Amazon Bedrock foundation model invocations incur per-token usage costs according to AWS pricing (e.g. Claude 3 Haiku input/output token pricing).
   * Automated CI test suites (`npm test`, `npm run check`) use mocked boundaries and do not incur AWS charges.
