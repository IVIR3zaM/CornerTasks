# Top-level convenience targets for the CornerTasks repo.

.PHONY: design-validate design-preview design v030-status

v030-status:
	@node scripts/v030-status.mjs

design-validate:
	@node design/tools/validate/validate.mjs

design-preview:
	@node design/tools/preview/generate.mjs
	@echo "Open design/preview/index.html in a browser."

design: design-validate design-preview
