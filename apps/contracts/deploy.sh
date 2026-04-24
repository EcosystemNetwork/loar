#!/usr/bin/env bash
#
# Deploy helper — passes the signing key and Etherscan key via environment
# variables rather than as --private-key / --etherscan-api-key flags on the
# forge command line. On a multi-user host, command-line args are visible to
# anyone running `ps auxww`, land in shell history, and are echoed by any
# `set -x` wrapper. foundry honours ETH_PRIVATE_KEY and ETHERSCAN_API_KEY
# directly, so the argv never carries the key.
#
# Required env (source from a gitignored .env or your secrets manager):
#   ETH_PRIVATE_KEY  — hex-encoded deploy key (no 0x prefix required by forge)
#   RPC_11155111     — Ethereum Sepolia RPC URL
#   RPC_84532        — Base Sepolia RPC URL
#   ETHERSCAN_API_KEY (default target) — for --verify
#   VERIFICATION_KEY_1       — Ethereum Sepolia Etherscan key (optional override)
#   VERIFICATION_KEY_84532   — Base Sepolia Etherscan key (optional override)
set -euo pipefail

: "${ETH_PRIVATE_KEY:?ETH_PRIVATE_KEY must be set in the environment}"

# Sepolia
ETHERSCAN_API_KEY="${VERIFICATION_KEY_1:-${ETHERSCAN_API_KEY:-}}" \
  forge script script/DeployProtocol.s.sol \
  --rpc-url "$RPC_11155111" \
  --broadcast \
  --chain sepolia \
  --verify \
  -vvvv

# Base Sepolia
# ETHERSCAN_API_KEY="${VERIFICATION_KEY_84532:-${ETHERSCAN_API_KEY:-}}" \
#   forge script script/DeployProtocol.s.sol \
#   --rpc-url "$RPC_84532" \
#   --broadcast \
#   --chain base-sepolia \
#   --verify \
#   -vvvv
