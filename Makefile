.PHONY: format test build dev demo app install-app

format:
	npx prettier --write .

test:
	node --test "test/*.test.js"

build:
	@echo "nothing to build"

dev:
	node src/server.js $(ARGS)

demo:
	KEYSTROKE_HOOK=hooks/wordcount.sh node src/server.js

app:
	mac/build.sh

install-app: app
	rm -rf ~/Applications/Keystroke.app
	mkdir -p ~/Applications
	cp -R build/Keystroke.app ~/Applications/
	@echo "installed ~/Applications/Keystroke.app"
