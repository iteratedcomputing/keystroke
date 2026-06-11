.PHONY: format test build dev

format:
	npx prettier --write .

test:
	node --test "test/*.test.js"

build:
	@echo "nothing to build"

dev:
	node src/server.js
