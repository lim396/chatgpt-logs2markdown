.PHONY: run
run:
	node GPTLogsToMd.ts -- $(ARGS)


.PHONY: lint
lint:
	npm run lint

.PHONY: fmt
fmt:
	npx prettier --write ./

