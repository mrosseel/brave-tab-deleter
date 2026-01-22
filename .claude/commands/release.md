# Release Chrome Extension

Prepare and package a new release of the Tab Deleter browser extension.

## Instructions

### 1. Get Current Version

Read the current version from `manifest.json`:

```bash
grep '"version"' manifest.json | head -1
```

### 2. Determine Version Bump

Ask the user what type of release this is using AskUserQuestion:
- **Patch** (x.y.Z): Bug fixes, minor changes
- **Minor** (x.Y.0): New features, backwards compatible
- **Major** (X.0.0): Breaking changes

Calculate the new version based on current version and bump type.

### 3. Get Changelog

Find commits since the last release. Releases are tagged as `vX.Y.Z` or commits contain "release" in the message.

```bash
# Find last release tag
git tag --list 'v*' --sort=-version:refname | head -1

# Get commits since last tag (or all commits if no tag)
git log $(git tag --list 'v*' --sort=-version:refname | head -1)..HEAD --oneline 2>/dev/null || git log --oneline
```

Format the changelog as a bullet list of meaningful changes. Skip:
- Merge commits
- "WIP" commits
- Commits that are just version bumps

### 4. Update Version Files

Update version in both files:
- `manifest.json`: Update the `"version"` field
- `package.json`: Update the `"version"` field

### 5. Update WEBSTORE.md

Create or update `WEBSTORE.md` with this structure:

```markdown
# Chrome Web Store Listing

## Short Description (132 chars max)

[Keep existing or update if features changed significantly]

## Detailed Description

[Keep existing feature list, update if new features added]

## Changelog

### vX.Y.Z (YYYY-MM-DD)
- [List of changes from git commits]

[Only keep the latest version's changelog]
```

Review the commit messages to determine if any features were added/changed that need the description updated.

### 6. Build and Package

```bash
npm run build
npm run package
```

### 7. Create Git Tag

After user confirms everything looks good:

```bash
git add manifest.json package.json WEBSTORE.md
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
```

### 8. Summary

Output:
- New version number
- Changelog summary
- Path to the zip file
- Remind user to:
  - Push the tag: `git push && git push --tags`
  - Upload zip to Chrome Web Store

$ARGUMENTS
