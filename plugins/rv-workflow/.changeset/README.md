# Changesets

Add one changeset for every pull request that changes the published npm package:

```sh
cd plugins/rv-workflow
npm run changeset
```

Choose `patch`, `minor`, or `major`, describe the user-visible change, and commit the generated Markdown file with the pull request. Documentation-only, test-only, and internal repository changes that do not affect the published package may omit a changeset.

After a changeset reaches `main`, the release workflow opens or updates a version pull request. Merging that pull request publishes `@rvkang/rv-workflow`, pushes the package version Git tag, and creates the matching GitHub Release.
