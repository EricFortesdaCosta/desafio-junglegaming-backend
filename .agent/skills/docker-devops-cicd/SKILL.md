---
name: docker-devops-cicd
description: Modern DevOps, Docker, LocalStack emulation, and GitHub Actions CI/CD guide for reproducible development, testing, and automated deployment pipelines.
---

# Docker, DevOps & CI/CD Production Guide

Patterns and templates for containerization, local cloud emulation, and automated CI/CD pipelines.

---

## 1. Multi-Stage Dockerfile (Node.js & Spring Boot)

Keep production container images minimal, secure, and fast.

---

## 2. Docker Compose with Healthchecks & LocalStack
Standard local development environment with PostgreSQL and LocalStack (AWS SQS/SNS/S3).
Healthcheck tests ensuring services are ready before dependent apps start.

---

## 3. GitHub Actions CI Pipeline
Automated linting, test execution with real service containers (PostgreSQL, LocalStack), and build packaging.

