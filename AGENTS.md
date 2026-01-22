Testing:

* Make unit test first (when reasonable), prompting a more testable code with clear dependency injection.
* Prefer code that is testable without heavy mocking.
* Prefer functional style, no classes.
* NEVER alter already pushed commits.  No amend if the commit is pushed.  No force push.


For typescript:

* `pnpm fix` to make code prettier and handle linting rules
* `pnpm check` to check typescript etc


Deployment:

* aurboda-backend is automatically deployed to https://aurboda.net/api on merge to `develop`.
* aurboda-web is automatically deployed to https://aurboda.net/ on merge to `develop`.
