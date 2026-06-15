# Marketplace Dashboard Project Memory

Last reviewed: 2026-06-15 15:25 +04

## Purpose

Marketplace Dashboard is a DarDoc marketplace-facing dashboard. It supports marketplace partner/account workflows and should make repeated partner/CX requests visible and self-service where possible.

## Business Context

- Users are marketplace partners, ops users, or internal teams supporting marketplace accounts.
- UI should be work-focused and clear, with reviewable changes before deployment.
- This repo is part of the Mac mini Codex automation lane after Doctor Dashboard.

## Technical Shape

- Framework: Next.js + React.
- Auth: Clerk in normal usage.
- Default branch: `main`.
- Remote: `https://github.com/unitedadi/Marketplace-Dashboard.git`.

## Commands

- Install: `npm install`
- Dev: `npm run dev -- --hostname 0.0.0.0 --port 3004`
- Build: `npm run build`
- Lint: `npm run lint`

## Verification Rules

- Run `npm run build` after code changes.
- For UI changes, run the app, produce a targeted screenshot of the changed state, and attach it to Linear.
- Do not push/deploy/modify production data unless approved.

## Automation Rules

- Read this file before starting every task in this repo.
- Update Task History after completed code/debug/artifact/ops tasks.
- Add durable business or technical discoveries to the relevant section above.

## Task History

### 2026-06-15 15:25 +04 - Mac mini onboarding

- Source: Aditya requested adding Marketplace Dashboard to the Mac mini Codex runner.
- Added baseline project memory and runner configuration.
- Follow-up: verify build/dev behavior and add/confirm skip-auth UI review mode if needed.
