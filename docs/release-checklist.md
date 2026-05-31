# OAC Release Checklist

This checklist is for local release validation before publishing OAC.

## Low-cost checks

Run:

```bash
npm run check:oac-release
```

This command checks:

- text safety: no mojibake, obvious debug strings, skipped planning marker, or HTML-as-JSON errors;
- persisted report structure: business insights, presales strategy, and delivery assessment survive JSON write/read;
- offline end-to-end flow: report JSON, report HTML, and report index are written and read back;
- report quality: source count, source family coverage, business depth, required sections, and 1.0 comparison;
- production build.

After starting the local server, verify the visible app endpoint with:

```bash
npm run check:local-server
```

This check looks for the OAC local health endpoint and confirms that the app shell is served from the active local port.

## Protected real canary

The real canary creates a real report task and may spend search/model quota. It refuses to run unless explicitly enabled.

Before a real run, use the no-cost preflight:

```bash
npm run canary:oac-check
```

The preflight only validates the canary company file and environment shape. It does not create a task, call search APIs, or call the model.

Use a UTF-8 JSON company file instead of typing Chinese company names in the shell. A safe example is:

```text
scripts/canary-company.example.json
```

Required environment variables:

```bash
OAC_CANARY_CONFIRM=RUN
OAC_CANARY_BASE_URL=http://localhost:8888
OAC_CANARY_LICENSE=<license key>
OAC_CANARY_COMPANY_FILE=scripts/canary-company.example.json
```

Then run:

```bash
npm run canary:oac-real
```

The script will:

1. log in with the license;
2. pick a ready seller profile or use `OAC_CANARY_PROFILE_ID`;
3. create a fresh report job;
4. trigger background generation;
5. poll until completion and resume if needed;
6. fetch the report;
7. run the OAC quality gate on the generated report.

Outputs are written outside the repo workspace root:

- `../oac-real-canary-report.json`
- `../oac-real-canary-preview.html`
- `../oac-real-canary-quality-summary.md`

## When to consider the release ready

The release is ready only when:

- `npm run check:oac-release` passes;
- one protected real canary run completes successfully;
- the generated canary report is reviewed in the browser and is clearly more useful than the 1.0 report for sales/presales decision-making.
