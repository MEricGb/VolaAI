# VolaAI

VolaAI is an AI travel assistant built for Vibehack 2026. The idea is simple: trip planning should feel like chatting, not filling in forms. Instead of jumping between flight sites, hotel pages, booking emails, and support tools, the user can stay inside WhatsApp, describe a trip in natural language, share a screenshot, and get structured travel help back in the same conversation.

This repository contains the full system behind that experience. It includes a React web app, a NestJS API, a Rust AI orchestration service, and Python microservices for flight search and OCR. Together, these services turn free-form travel requests and booking screenshots into real searches, extracted travel details, and AI-generated responses.

## What the project does

VolaAI is built around a few core flows:

- plan a trip from a WhatsApp message
- search flights from structured travel intent
- read booking screenshots and extract useful travel details
- support direct messages and Twilio Conversations group flows
- expose a web landing page and admin dashboard on top of the backend

## What we used

This repo is multi-service, so the stack is split by responsibility.

### Frontend

- React 18
- Vite
- `react-router-dom`
- plain CSS

### API and backend

- TypeScript
- NestJS 10
- Prisma 7
- PostgreSQL
- Twilio WhatsApp Messaging
- Twilio Conversations
- MinIO object storage
- Stripe webhook scaffold

### AI and orchestration

- Rust
- `tonic` for gRPC
- `rig-core`
- Featherless / OpenAI-compatible LLM API integration
- a three-stage orchestration pipeline for tool selection, tool execution, and response generation

### Python services

- Python
- `grpcio`
- `grpcio-tools`
- `pytesseract`
- `pillow`
- OpenAI-compatible OCR backends

### Shared contracts and infra

- Protocol Buffers in `proto/`
- Dockerfiles per service
- Railway deployment configs
- local Docker services for PostgreSQL, Redis Stack, MinIO, and Nginx
- `just` files for local developer workflows

## Project architecture

The system is split into five main services plus shared protobuf contracts:

```text
.
|-- web/       React frontend and admin UI
|-- api/       NestJS API, Twilio webhooks, Prisma, media handling
|-- agent/     Rust gRPC AI orchestrator
|-- scraper/   Python gRPC flight search service
|-- ocr/       Python gRPC OCR service
|-- proto/     Shared protobuf definitions
```

### `web/`

The frontend is a Vite + React app with:

- a public landing page
- a basic admin dashboard shell
- API calls to the NestJS backend through `VITE_API_URL` or `/api`

### `api/`

The API is the main product entrypoint. It handles:

- Twilio webhooks for inbound WhatsApp messages
- Twilio Conversations pre-event hooks for group chat flows
- Prisma models and PostgreSQL persistence
- MinIO-backed media ingestion and serving
- public config and admin endpoints for the web app
- gRPC communication with the Rust agent

Main routes currently include:

- `GET /health`
- `POST /whatsapp`
- `POST /whatsapp/conversations/pre-event`
- `GET /whatsapp/groups`
- `GET /whatsapp/public-config`
- `GET /whatsapp/admin/overview`
- `POST /whatsapp/groups`
- `POST /stripe/webhook`
- `GET /media/:key`

### `agent/`

The Rust agent is the intelligence layer of the system. It receives chat requests over gRPC and runs a three-step pipeline:

1. understand the request and decide which tool is needed
2. call the right downstream service or inline tool
3. generate the final user-facing response

The agent currently connects to:

- `scraper/` for flight search
- `ocr/` for booking screenshot extraction
- an inline destination-identification tool for scenic travel photos

### `scraper/`

The scraper service is a Python gRPC service that receives structured travel parameters and calls the Vola flight search client. It is intentionally narrow: no conversation state, no UI logic, just structured search input and returned offers.

### `ocr/`

The OCR service is a Python gRPC service that extracts travel details from screenshots and booking images. It supports multiple backends, including `mock`, `tesseract`, `google`, `openai`, and `featherless`.

## How the system works

Typical flow:

1. A user sends a WhatsApp message.
2. Twilio delivers the webhook to the NestJS API.
3. The API stores state in PostgreSQL and media in MinIO if attachments are present.
4. The API forwards the AI request to the Rust agent over gRPC.
5. The agent decides whether it needs search, OCR, or destination recognition.
6. The agent calls the appropriate tool or microservice.
7. The agent returns a final reply to the API.
8. The API sends the answer back to the user through Twilio.
9. The web app consumes public and admin data from the API.

## Why the architecture looks like this

The repository is separated by capability instead of forcing everything into one service:

- `web/` focuses on presentation
- `api/` owns product-facing HTTP and Twilio integrations
- `agent/` owns AI reasoning and tool orchestration
- `scraper/` and `ocr/` stay small and specialized
- `proto/` keeps service contracts explicit

That keeps the AI workflow modular and makes it easier to iterate on individual capabilities during a hackathon project.

## Local development

### Prerequisites

- Node.js 20+
- npm
- Python 3.10+
- Rust toolchain
- Docker and Docker Compose
- `just` optional but recommended
- Tesseract optional if you want local non-mock OCR

### Environment files

Environment is split across services:

- root `.env` for the Rust agent
- `api/.env` for database, Twilio, MinIO, public URLs, and API config
- `web` can use `VITE_API_URL` if needed

Use [api/.env.example](/Users/ericmoroiu/repos/vibehack-2026/api/.env.example) as the starting point for the API environment.

### Start local dependencies

From the repo root:

```bash
docker compose -f api/dev.yaml up -d
```

This starts:

- PostgreSQL
- Redis Stack
- MinIO
- Nginx

Redis is provisioned for local development, although the current API code does not actively use it yet.

### Start the scraper

```bash
cd scraper
just run
```

Default gRPC address: `localhost:50051`

### Start the OCR service

```bash
cd ocr
just run
```

Default gRPC address: `localhost:50053`

### Start the Rust agent

```bash
cd agent
cargo run
```

Default gRPC address: `localhost:50052`

### Start the API

```bash
cd api
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

Default HTTP address: `http://localhost:3000`

### Start the web app

```bash
cd web
npm install
npm run dev
```

Default frontend address: `http://localhost:5173`

## Useful commands

### API

```bash
cd api
just setup
just db-generate
just db-migrate
just start
just check
```

### Agent

```bash
cd agent
just build
just start
just prompt "Find me flights to Rome next Friday"
```

### OCR

```bash
cd ocr
just setup
just start
```

### Scraper

```bash
cd scraper
just setup
just start
```

## Current project status

Already implemented in code:

- WhatsApp inbound messaging flow
- Twilio Conversations group support
- AI-triggered direct and group interactions
- flight search through the scraper service
- booking screenshot extraction through the OCR service
- media storage and serving through MinIO
- landing page and admin dashboard shell

Still partial or scaffolded:

- Stripe webhook processing currently logs payloads
- some admin pages are placeholders
- Redis is available in local infra but not yet wired into active API behavior

## Deployment

- each service has its own Dockerfile at the repo root
- several services include `railway.toml`
- the API deployment runs Prisma migrations before starting the server

## Additional notes

- backend-specific notes live in [api/README.md](/Users/ericmoroiu/repos/vibehack-2026/api/README.md)
- protobuf contracts live in `proto/`
- the repo also includes local images that can be used for OCR and destination testing
