# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository, or email the maintainers at the security contact listed in the repository profile. Include the version or commit, steps to reproduce, and the impact you believe it has.

You will receive an acknowledgement within five working days. We will work with you on a fix and coordinate disclosure. We credit reporters in release notes unless they ask otherwise.

## Supported versions

Until the first release, only the `main` branch is supported. After release 1, the latest minor version receives security fixes.

## Scope

In scope: the Quill server, web application, container image, and official deployment manifests.

Out of scope: third-party services that Quill integrates with, and deployments modified beyond the documented configuration.

## Threat model

A threat model for Quill itself is produced during the research phase (see `quill-plan.md`, investigation R12) and maintained under `docs/architecture`.
