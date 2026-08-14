# CrowdFlow — one Bun/TypeScript toolchain. Kotlin exists only under the Expo
# Android mesh module, where the screen-off foreground service requires it.
DASHBOARD := apps/dashboard
API_PORT ?= 8099
UI_PORT ?= 5199
CIRCUIT ?= silverstone
SCENARIO ?= egress
POPULATION ?= 2500
SEED ?= 42
SPEED ?= 4

.PHONY: help install console api dashboard test typecheck codegen build gate clean
help:
	@echo "make console     Bun API + dashboard -> http://127.0.0.1:$(UI_PORT)"
	@echo "make api         Bun API only        -> http://127.0.0.1:$(API_PORT)"
	@echo "make dashboard   operator console only"
	@echo "make test        every Vitest suite + TypeScript check"
	@echo "make codegen     deterministic JSON Schema from authored TypeScript"
	@echo "make gate        seeded Silverstone intervention A/B"

install:
	bun install --frozen-lockfile

console:
	@echo "API  http://127.0.0.1:$(API_PORT)"
	@echo "UI   http://127.0.0.1:$(UI_PORT)"
	@trap 'kill 0' EXIT INT TERM; \
	bun packages/api/src/main.ts --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) --population $(POPULATION) --seed $(SEED) --speed $(SPEED) & \
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) bun run --filter crowdflow-dashboard dev -- --port $(UI_PORT) & \
	wait

api:
	bun packages/api/src/main.ts --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) --population $(POPULATION) --seed $(SEED) --speed $(SPEED)

dashboard:
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) bun run --filter crowdflow-dashboard dev -- --port $(UI_PORT)

test: typecheck
	bun run test

typecheck:
	bun run typecheck

codegen:
	bun run codegen
	@git diff --exit-code -- packages/contracts/schema

build:
	bun run build

gate:
	bun run crowdflow -- sim ab $(CIRCUIT) --count 6000 --ticks 700 --seed $(SEED)

clean:
	rm -rf node_modules packages/*/dist apps/*/dist apps/*/node_modules/.vite
