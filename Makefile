SHELL := /bin/zsh

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BACKEND := $(ROOT)/backend
FRONTEND := $(ROOT)/frontend
UV ?= uv
UV_CACHE_DIR ?= /private/tmp/study-tracker-uv-cache
UV_RUN := UV_CACHE_DIR=$(UV_CACHE_DIR) $(UV)
SERVICE := $(ROOT)/scripts/macos_service.py
SERVICE_PYTHON ?= python3

.PHONY: help install backend-install frontend-install build serve app dev-api dev-ui \
	migrate plan-validate plan-sync plan-update plan-patch plan-inspect backup \
	backend-check test frontend-test lint check service-install service-start \
	service-stop service-restart service-status service-uninstall rebuild update \
	logs logs-once health

help:
	@echo "React Study Tracker"
	@echo "  make install          Reproduce locked Python and Node environments"
	@echo "  make build            Build the production React frontend"
	@echo "  make serve            Serve API + built frontend on 127.0.0.1:8787"
	@echo "  make app              Build, then serve in the foreground"
	@echo "  make dev-api          Run the API for active development"
	@echo "  make dev-ui           Run Vite with hot reload"
	@echo "  make check            Run backend and frontend checks"
	@echo "  make service-install  Install/start the lightweight macOS login service"
	@echo "  make service-stop     Stop and unload the macOS service"
	@echo "  make service-start    Load and start the macOS service"
	@echo "  make service-restart  Restart through launchd (no PID handling)"
	@echo "  make service-status   Show launchd state and HTTP health"
	@echo "  make rebuild          Rebuild frontend and restart the service"
	@echo "  make update           Sync locked deps, rebuild, and restart"
	@echo "  make logs             Follow service logs"
	@echo "  make plan-update PLAN=/path/to/plan.md"

install: backend-install frontend-install

backend-install:
	cd $(BACKEND) && $(UV_RUN) sync --frozen

frontend-install:
	cd $(FRONTEND) && npm ci

build:
	cd $(FRONTEND) && npm run build

serve:
	@test -f "$(FRONTEND)/dist/index.html" || \
		(echo "Frontend is not built. Run: make build" && exit 2)
	cd $(BACKEND) && .venv/bin/python -m tracker_api.main

app: build serve

dev-api:
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.main

dev-ui:
	cd $(FRONTEND) && npm run dev

migrate:
	cd $(BACKEND) && $(UV_RUN) run python -c \
		"from tracker_api.migrations.runner import run_migrations; print(run_migrations())"

plan-validate:
	@test -n "$(PLAN)" || (echo "Usage: make plan-validate PLAN=/path/to/plan.md" && exit 2)
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan validate "$(abspath $(PLAN))"

plan-sync:
	@test -n "$(PLAN)" || (echo "Usage: make plan-sync PLAN=/path/to/plan.md" && exit 2)
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan sync "$(abspath $(PLAN))"

plan-update:
	@test -n "$(PLAN)" || (echo "Usage: make plan-update PLAN=/path/to/plan.md" && exit 2)
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan validate "$(abspath $(PLAN))"
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.backup
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan sync "$(abspath $(PLAN))"

plan-patch:
	@test -n "$(PATCH)" || (echo "Usage: make plan-patch PATCH=/path/to/patch.md" && exit 2)
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan patch "$(abspath $(PATCH))"

plan-inspect:
	@test -n "$(COURSE)" || (echo "Usage: make plan-inspect COURSE=course_id" && exit 2)
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.plan inspect "$(COURSE)"

backup:
	cd $(BACKEND) && $(UV_RUN) run python -m tracker_api.backup $(BACKUP)

backend-check:
	cd $(BACKEND) && $(UV_RUN) run ruff check tracker_api ../scripts
	cd $(BACKEND) && $(UV_RUN) run mypy tracker_api

test:
	cd $(BACKEND) && $(UV_RUN) run pytest

frontend-test:
	cd $(FRONTEND) && npm test

lint:
	cd $(FRONTEND) && npm run lint

check: backend-check test frontend-test lint build

service-install:
	$(SERVICE_PYTHON) $(SERVICE) install

service-start:
	$(SERVICE_PYTHON) $(SERVICE) start

service-stop:
	$(SERVICE_PYTHON) $(SERVICE) stop

service-restart:
	$(SERVICE_PYTHON) $(SERVICE) restart

service-status:
	$(SERVICE_PYTHON) $(SERVICE) status

service-uninstall:
	$(SERVICE_PYTHON) $(SERVICE) uninstall

rebuild: build service-restart

update: backend-install frontend-install build service-restart

logs:
	@mkdir -p "$(ROOT)/data/logs"
	tail -n 100 -F "$(ROOT)/data/logs/tracker.stdout.log" \
		"$(ROOT)/data/logs/tracker.stderr.log"

logs-once:
	@tail -n 100 "$(ROOT)/data/logs/tracker.stdout.log" \
		"$(ROOT)/data/logs/tracker.stderr.log" 2>/dev/null || true

health:
	curl -fsS http://127.0.0.1:8787/api/health
