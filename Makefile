.PHONY: init
init:
	rm yarn.lock
	yarn install

.PHONY: test
test: 
	yarn run testcafe chrome tests/

.PHONY: format
format:
	yarn run prettier -w popout.js

.PHONY: lint
eslint:
	yarn run eslint popout.js

.PHONY: 
clean:
	rm node_modules
	rm dist/popout.dist.js

build: popout.js
	yarn run swc popout.js > dist/popout.dist.js

all: lint format test build