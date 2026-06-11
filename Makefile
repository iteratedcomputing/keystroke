.PHONY: format test build dev demo

format:
	npx prettier --write .

test:
	node --test "test/*.test.js"

build:
	@echo "nothing to build"

dev:
	node src/server.js

demo:
	KEYSTROKE_HOOK=hooks/wordcount.sh node src/server.js
