all: lint format

.PHONY: init
init:
	npm install

.PHONY: format
format:
	npx prettier -w popout.js

.PHONY: lint
lint:
	npx eslint popout.js

.PHONY: clean
clean:
	rm -rf node_modules
