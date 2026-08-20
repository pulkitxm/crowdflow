DASHBOARD := apps/dashboard
API_PORT ?= 8099
UI_PORT ?= 5199
CIRCUIT ?= silverstone
SCENARIO ?= egress
POPULATION ?= 2500
SEED ?= 42
SPEED ?= 4
SIM_PEOPLE ?= 500
SIM_RATE ?= 50
SIM_TICK_MS ?= 500
SIM_DURATION ?= 30
SIM_START_ID ?= 1
SIM_GATES ?=
SIM_RESET ?=

.PHONY: help install console api dashboard simulator comments lint test typecheck codegen build check gate clean
help:
	@echo "make console     Bun API + dashboard -> http://127.0.0.1:$(UI_PORT)"
	@echo "make api         Bun API only        -> http://127.0.0.1:$(API_PORT)"
	@echo "make dashboard   operator console only"
	@echo "make simulator   populate live people through circuit gates"
	@echo "make comments    reject new source comments"
	@echo "make lint        project lint rules"
	@echo "make test        every Vitest suite + TypeScript check"
	@echo "make codegen     deterministic JSON Schema from authored TypeScript"
	@echo "make check       complete local quality gate"
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

simulator:
	bun run crowdflow -- live simulate $(CIRCUIT) --api http://127.0.0.1:$(API_PORT) $(if $(SIM_RESET),--reset,) --people $(SIM_PEOPLE) --rate $(SIM_RATE) --tick-ms $(SIM_TICK_MS) --duration $(SIM_DURATION) --start-id $(SIM_START_ID) $(if $(SIM_GATES),--gates $(SIM_GATES),)

comments:
	bun run comments:check

lint:
	bun run lint

test: typecheck
	bun run test

typecheck:
	bun run typecheck

codegen:
	bun run codegen
	@git diff --exit-code -- packages/contracts/schema

build:
	bun run build

check:
	bun run check

gate:
	bun run crowdflow -- sim ab $(CIRCUIT) --count 6000 --ticks 700 --seed $(SEED)

clean:
	rm -rf node_modules packages/*/dist apps/*/dist apps/*/node_modules/.vite
