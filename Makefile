# CrowdFlow — one command per thing a person actually does.
#
# `make console` is the operator console: API and dashboard together, killed
# together. Everything else is a piece of it, runnable on its own, because the
# first thing you do when the console misbehaves is run the halves separately.

DASHBOARD := apps/dashboard
API_PORT  ?= 8099
UI_PORT   ?= 5199
CIRCUIT   ?= silverstone
SCENARIO  ?= egress
POPULATION ?= 2500
SEED      ?= 42
SPEED     ?= 4

.PHONY: help install console api dashboard test test-py test-ui typecheck codegen build clean

help:
	@echo "make console     API + dashboard, together   -> http://127.0.0.1:$(UI_PORT)"
	@echo "make api         API only                    -> http://127.0.0.1:$(API_PORT)/docs"
	@echo "make dashboard   dashboard only (proxies to the API)"
	@echo "make test        pytest + vitest + tsc"
	@echo "make codegen     regenerate the committed TypeScript from the Pydantic models"
	@echo ""
	@echo "overridable: CIRCUIT SCENARIO POPULATION SEED SPEED API_PORT UI_PORT"

install:
	uv sync
	cd $(DASHBOARD) && npm install

# The console. Two processes, one Ctrl-C: without the trap, quitting make leaves
# a simulation running in the background and the next `make console` fails on a
# port that is already bound — with an error that says nothing about why.
console: install
	@echo "API  http://127.0.0.1:$(API_PORT)"
	@echo "UI   http://127.0.0.1:$(UI_PORT)"
	@trap 'kill 0' EXIT INT TERM; \
	uv run crowdflow-api --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) \
		--population $(POPULATION) --seed $(SEED) --speed $(SPEED) & \
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) npm --prefix $(DASHBOARD) run dev -- --port $(UI_PORT) & \
	wait

api:
	uv run crowdflow-api --port $(API_PORT) --circuit $(CIRCUIT) --scenario $(SCENARIO) \
		--population $(POPULATION) --seed $(SEED) --speed $(SPEED)

dashboard:
	CROWDFLOW_API=http://127.0.0.1:$(API_PORT) npm --prefix $(DASHBOARD) run dev -- --port $(UI_PORT)

test: test-py test-ui

test-py:
	uv run pytest packages -q

test-ui: typecheck
	npm --prefix $(DASHBOARD) test

typecheck:
	npm --prefix $(DASHBOARD) run typecheck

codegen:
	uv run python packages/contracts/scripts/generate.py
	uv run python packages/api/scripts/generate.py

build:
	npm --prefix $(DASHBOARD) run build

clean:
	rm -rf $(DASHBOARD)/dist $(DASHBOARD)/node_modules/.vite
