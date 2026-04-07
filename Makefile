.PHONY: help setup install dev dev-web dev-server dev-indexer \
       build clean test test-contracts test-coverage lint check-types \
       docker-build docker-up docker-down docker-logs docker-restart \
       smoke-test rollback \
       codegen codegen-indexer db-seed contracts-build contracts-test

# Default target
help: ## Show all available commands
	@echo ""
	@echo "  LOAR — Development Commands"
	@echo "  ==========================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ---- Setup ----

setup: ## First-time project setup (runs setup.sh)
	@bash setup.sh

install: ## Install all dependencies
	pnpm install

# ---- Development ----

dev: ## Start all services (web + server + indexer)
	pnpm dev

dev-web: ## Start web app only (port 3001)
	pnpm dev:web

dev-server: ## Start server only (port 3000)
	pnpm dev:server

dev-indexer: ## Start indexer only (port 42069)
	pnpm -F indexer dev

# ---- Build ----

build: ## Build all apps
	pnpm build

clean: ## Clean all build artifacts
	rm -rf apps/server/dist apps/web/dist
	pnpm -F contracts clean 2>/dev/null || true

# ---- Testing ----

test: ## Run all tests (smart contracts)
	pnpm sc:test

test-contracts: ## Run contract tests with verbose output
	cd apps/contracts && forge test -vvv

test-coverage: ## Run contract test coverage
	pnpm sc:test:cov

# ---- Code Quality ----

lint: ## Run linting
	pnpm -F contracts lint 2>/dev/null || true
	pnpm -F indexer lint 2>/dev/null || true

check-types: ## Run TypeScript type checking across all apps
	pnpm check-types

# ---- Docker (server + indexer only; web deploys via Vercel) ----

docker-build: ## Build server + indexer containers
	docker compose build

docker-up: ## Start server + indexer in Docker (detached)
	docker compose up -d

docker-down: ## Stop Docker services
	docker compose down

docker-logs: ## Tail Docker logs (all services)
	docker compose logs -f

docker-restart: ## Rebuild and restart Docker services
	docker compose down
	docker compose build
	docker compose up -d

docker-health: ## Check health of running services
	@curl -sf http://localhost:3000/health | python3 -m json.tool 2>/dev/null || echo "Server: not running"
	@curl -sf http://localhost:42069/health | python3 -m json.tool 2>/dev/null || echo "Indexer: not running"

smoke-test: ## Run post-deploy smoke tests against localhost
	@bash scripts/smoke-test.sh

rollback: ## Roll back to previous deploy (reads .loar-deploy for SHA)
	@bash scripts/rollback.sh

# ---- Code Generation ----

codegen: ## Generate wagmi hooks from contract ABIs
	pnpm exec wagmi generate

codegen-indexer: ## Generate Ponder types
	pnpm -F indexer codegen

# ---- Database ----

db-seed: ## Seed Firestore with sample data
	pnpm -F server tsx scripts/seed.ts

# ---- Contracts ----

contracts-build: ## Build smart contracts with Foundry
	cd apps/contracts && forge build

contracts-test: ## Test smart contracts
	cd apps/contracts && forge test -vvv
