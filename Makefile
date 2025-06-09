all: lint format test # build

.PHONY: init
init:
	npm install

.PHONY: test
test: 
	npx testcafe chrome tests/

.PHONY: format
format:
	npx prettier -w popout.js

.PHONY: lint
lint:
	npx eslint popout.js

.PHONY: 
clean:
	rm node_modules
	rm dist/popout.dist.js

build: popout.js
	npx swc popout.js -o dist/popout.dist.js
