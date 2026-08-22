APP_PORT ?= 5199
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
SIM_MOVEMENT_SCALE ?= 90
SIM_GATES ?=
SIM_RESET ?=

.PHONY: help install app mobile simulator comments lint test typecheck codegen build check gate clean
help:
	@echo "make app         Next.js UI + API + WebSocket -> http://127.0.0.1:$(APP_PORT)"
	@echo "make mobile      Expo spectator app"
	@echo "make simulator   populate live people through circuit gates"
	@echo "make comments    reject new source comments"
	@echo "make lint        project lint rules"
	@echo "make test        every Vitest suite + TypeScript check"
	@echo "make codegen     deterministic JSON Schema from authored TypeScript"
	@echo "make check       complete local quality gate"
	@echo "make gate        seeded Silverstone intervention A/B"

install:
	bun install --frozen-lockfile

app:
	bun run dev -- --host 127.0.0.1 --port $(APP_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) --population $(POPULATION) --seed $(SEED) --speed $(SPEED)

mobile:
	EXPO_PUBLIC_CROWDFLOW_API=http://127.0.0.1:$(APP_PORT) bun run --filter mobile start

simulator:
	bun run crowdflow -- live simulate $(CIRCUIT) --api http://127.0.0.1:$(APP_PORT) $(if $(SIM_RESET),--reset,) --people $(SIM_PEOPLE) --rate $(SIM_RATE) --tick-ms $(SIM_TICK_MS) --duration $(SIM_DURATION) --movement-scale $(SIM_MOVEMENT_SCALE) --start-id $(SIM_START_ID) $(if $(SIM_GATES),--gates $(SIM_GATES),)

comments:
	bun run comments:check

lint:
	bun run lint

test:
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
	rm -rf node_modules packages/*/dist apps/*/dist apps/*/.next
