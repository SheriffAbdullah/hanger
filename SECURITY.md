# Security policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub security advisories: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include what you found, how to reproduce it, the Hanger version or commit, and the Windows and Node versions. We aim to acknowledge a report within a few days and will keep you updated until it is resolved. This is an early-beta, volunteer-run project, so there is no bounty and no fixed response guarantee.

## Scope

In scope:

- Anything that makes Hanger **leak data it promised not to**: names of software outside the declared scope, usernames, hostnames, serial numbers, command lines or window titles appearing in a report, log, console line or file (the privacy canary in `tools/hanger/test/canary-leak.js` guards this).
- Anything that makes Hanger **send data off the machine**. It is designed to make no network calls of its own and to have no telemetry.
- Code execution, privilege escalation or path-traversal issues in the tool, its PowerShell calls, or the small input-response helper it compiles and runs locally.
- Unsafe handling of report or scope files that Hanger reads (a crafted report or scope file should never execute anything).

Out of scope:

- Findings that need an already compromised machine or administrator access to exploit.
- Hanger not detecting hidden or unsanctioned software. This is a deliberate non-goal: Hanger is not a compliance scanner and only sees what the developer declares.
- Security products flagging the input helper. It is a small locally compiled program that reads only timing of input events, never what is typed. If a product blocks it, Hanger falls back and says so in the report. Reports of false positives are welcome as ordinary issues.

## Supported versions

Only the latest commit on `main` is supported while the project is in early beta.
