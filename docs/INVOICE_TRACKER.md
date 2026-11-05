# Fatura Takip

`/fatura-takip` is a separate application selected from the upper-left application menu. It is not a pricing tab or a new sidebar tool. The existing Terminal pages retain their navigation and access behavior.

## Records and balances

The requested companies are seeded in order: Albayrak, Çizgi, Tempo, Aliyüce, Kalender, Elve, Rezerv, Çelebi, Zirve, Çakmakçı. Additional companies can be created in the application.

Invoices contain a company, invoice number, invoice date and total in TRY. Amounts are stored as integer kuruş. The remaining balance is the total minus recorded usage. An optional opening usage creates a dated opening-balance event. The invoice date is never represented as the historical usage date.

Usage additions and reversals are append-only events attributed to an authenticated account. Write transactions serialize balance changes, prevent overspending, and enforce idempotency for repeated usage requests. Reversing an event preserves the original event. Edits use a version check and cannot reduce an invoice below its used balance. A normalized invoice number is unique within a company. Lists are paginated, and summary totals are read within the same transaction as the displayed invoice page.

## Access and initial setup

The owner chooses a four-digit code on the initial setup screen. Administrators create each member's name and distinct four-digit code. Code changes revoke all of that account's existing sessions. Disabling a member also revokes existing sessions. Member accounts cannot list, create or disable accounts.

Four-digit codes intentionally have a small code space, as requested. Shared database rate limits cap failed attempts at five per address and twenty globally per thirty-minute window. Codes are stored as HMAC-SHA256 digests using a server-only secret. Random 256-bit session tokens are stored only as SHA256 digests. Cookies are HttpOnly, SameSite=Strict and Secure in production, with a ninety-day expiry. All invoice APIs authenticate each request; mutation routes also check the request origin. Financial data is not stored in browser localStorage. Responses are private and not cached.

Production configuration uses the existing `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `GEMINI_API_KEY`. New server-only **Secret** variables:

- `INVOICE_AUTH_SECRET`: randomly generated, at least 32 characters. Keep stable; changing it invalidates the existing account code digests.
- `INVOICE_SETUP_TOKEN`: randomly generated bootstrap token. The owner-only setup URL includes it as `?kurulum=...`. Setup is permanently refused once the first account exists. Do not place the token in source control or send it to other users.

New tables use the `invoice_` prefix in the existing Turso database. Existing customer, pricing and assistant tables are not migrated or rewritten. No file database is accepted by the production server.

## Mesnet extraction

Authenticated users can drop one PDF, JPEG, PNG or WebP file of up to 3 MiB. The server checks its content signature and sends its bytes to the existing Google Gemini API. The model extracts only seller name, invoice number, invoice date, total including tax in integer kuruş, currency and warnings. Document text is untrusted input and has no tools or write access.

The extraction result fills an editable review form. It never creates an invoice or records usage by itself. Missing dates and unidentified companies remain blank. Unreadable amounts and non-TRY or unidentified currencies require manual correction. Multiple invoices in one document are not silently merged. Duplicate detection runs again at save time.

The original uploaded file is processed in memory and is not retained as an attachment. The application saves the reviewed invoice fields; users should retain the original mesnet in their existing document archive.

One extraction request makes at most one model call. It shares the assistant's existing request limit (default 20 per minute) and daily model-call budget (default 300, resetting at Istanbul midnight). Google project RPM/TPM/RPD limits are separate. Administrators can see the shared local daily counter in the Accounts screen. No Google quota reset or budget increase is performed.

## Verification

`node --test tests/invoices.test.cjs` uses isolated SQLite, with no production credentials or paid model calls. It covers leading-zero codes, hashed storage, shared login rate limits, role checks, session revocation, firm order, duplicate invoice numbers, exact balances, concurrent overspend prevention, idempotent retries, reversals, stale edits, invalid dates, Turkish amount parsing and extraction validation.

The browser flow was exercised against a temporary local SQLite fixture: initial setup, login, invoice creation, usage and reversal, account creation, browser session restoration, immediate revocation, unauthorized API requests, origin rejection, application switching and mobile overflow checks. The temporary fixture is not included in the application. Actual document recognition still depends on the configured Gemini project's model availability and quota; no customer document or real model request was used during automated verification.
