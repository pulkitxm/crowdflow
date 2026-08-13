# CrowdFlow — one npm/TypeScript toolchain. Kotlin exists only under the Expo
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
	@echo "make console     Node API + dashboard -> http://127.0.0.1:$(UI_PORT)"
	@echo "make api         Node API only        -> http://127.0.0.1:$(API_PORT)"
	@echo "make dashboard   operator console only"
	@echo "make test        every Vitest suite + TypeScript check"
	@echo "make codegen     deterministic JSON Schema from authored TypeScript"
	@echo "make gate        seeded Silverstone intervention A/B"

install:
	npm ci

console:
	@echo "API  http://127.0.0.1:$(API_PORT)"
	@echo "UI   http://127.0.0.1:$(UI_PORT)"
	@trap 'kill 0' EXIT INT TERM; \
	npm --workspace @crowdflow/api exec -- tsx src/main.ts --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) --population $(POPULATION) --seed $(SEED) --speed $(SPEED) & \
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) npm --workspace crowdflow-dashboard run dev -- --port $(UI_PORT) & \
	wait

api:
	npm --workspace @crowdflow/api exec -- tsx src/main.ts --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) --population $(POPULATION) --seed $(SEED) --speed $(SPEED)

dashboard:
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) npm --workspace crowdflow-dashboard run dev -- --port $(UI_PORT)

test: typecheck
	npm test

typecheck:
	npm run typecheck

codegen:
	npm run codegen
	@git diff --exit-code -- packages/contracts/schema

build:
	npm run build

gate:
	npm run crowdflow -- sim ab $(CIRCUIT) --count 6000 --ticks 700 --seed $(SEED)

clean:
	rm -rf node_modules packages/*/dist apps/*/dist apps/*/node_modules/.vite
