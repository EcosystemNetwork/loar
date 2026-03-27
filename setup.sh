#!/usr/bin/env bash
set -euo pipefail

# ============================================
# LOAR — First-Time Development Setup
# ============================================
# Usage: bash setup.sh
# Idempotent — safe to run multiple times.

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${BLUE}[INFO]${RESET}  $1"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $1"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $1"; }

echo ""
echo -e "${BOLD}======================================${RESET}"
echo -e "${BOLD}  LOAR Development Environment Setup  ${RESET}"
echo -e "${BOLD}======================================${RESET}"
echo ""

# -------------------------------------------
# 1. Check Node.js >= 18
# -------------------------------------------
info "Checking Node.js..."
if ! command -v node &> /dev/null; then
  fail "Node.js is not installed. Install v18+ from https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js v${NODE_VERSION} found, but v18+ is required."
  exit 1
fi
ok "Node.js v${NODE_VERSION}"

# -------------------------------------------
# 2. Check/install pnpm 9.15.0
# -------------------------------------------
info "Checking pnpm..."
if command -v pnpm &> /dev/null; then
  PNPM_VERSION=$(pnpm --version)
  if [ "$PNPM_VERSION" = "9.15.0" ]; then
    ok "pnpm v${PNPM_VERSION}"
  else
    warn "pnpm v${PNPM_VERSION} found, but v9.15.0 is required."
    info "Installing pnpm@9.15.0 via corepack..."
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
    ok "pnpm v9.15.0 installed via corepack"
  fi
else
  info "pnpm not found. Installing via corepack..."
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
  ok "pnpm v9.15.0 installed via corepack"
fi

# -------------------------------------------
# 3. Check optional tools
# -------------------------------------------
info "Checking optional tools..."

if command -v forge &> /dev/null; then
  ok "Foundry (forge) found — smart contract development enabled"
  HAS_FORGE=true
else
  warn "Foundry not found — smart contract development disabled"
  warn "Install: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  HAS_FORGE=false
fi

if command -v docker &> /dev/null && docker compose version &> /dev/null; then
  ok "Docker + Compose found — container deployment enabled"
  HAS_DOCKER=true
else
  warn "Docker or Docker Compose not found — container deployment disabled"
  HAS_DOCKER=false
fi

echo ""

# -------------------------------------------
# 4. Environment file
# -------------------------------------------
info "Setting up environment..."
if [ -f .env ]; then
  ok ".env already exists (skipping)"
else
  cp .env.example .env
  ok "Created .env from .env.example"
  warn "Fill in your values in .env before running the app"
fi

echo ""

# -------------------------------------------
# 5. Install dependencies
# -------------------------------------------
info "Installing dependencies..."
pnpm install
ok "Dependencies installed"

echo ""

# -------------------------------------------
# 6. Build contracts (optional, interactive)
# -------------------------------------------
if [ "$HAS_FORGE" = true ]; then
  read -r -p "$(echo -e "${BLUE}[?]${RESET}   Build smart contracts? [y/N] ")" build_contracts
  if [[ "$build_contracts" =~ ^[Yy]$ ]]; then
    info "Building contracts..."
    (cd apps/contracts && forge build)
    ok "Contracts built"

    info "Generating wagmi hooks..."
    pnpm exec wagmi generate 2>/dev/null && ok "Wagmi hooks generated" || warn "Wagmi generate failed (non-critical)"
  fi
fi

# -------------------------------------------
# 7. Docker build (optional, interactive)
# -------------------------------------------
if [ "$HAS_DOCKER" = true ]; then
  read -r -p "$(echo -e "${BLUE}[?]${RESET}   Build Docker containers? [y/N] ")" build_docker
  if [[ "$build_docker" =~ ^[Yy]$ ]]; then
    info "Building Docker containers..."
    docker compose build
    ok "Docker containers built"
  fi
fi

echo ""

# -------------------------------------------
# Summary
# -------------------------------------------
echo -e "${BOLD}======================================${RESET}"
echo -e "${GREEN}${BOLD}  Setup complete!${RESET}"
echo -e "${BOLD}======================================${RESET}"
echo ""
echo -e "  ${BOLD}Quick Start:${RESET}"
echo -e "    pnpm dev           Start all services"
echo -e "    pnpm dev:web       Start web only (port 3001)"
echo -e "    pnpm dev:server    Start server only (port 3000)"
echo ""
echo -e "  ${BOLD}More commands:${RESET}"
echo -e "    make help          Show all available commands"
echo ""
echo -e "  ${BOLD}Documentation:${RESET}"
echo -e "    docs/              Architecture, API, troubleshooting"
echo -e "    CONTRIBUTING.md    How to contribute"
echo ""
