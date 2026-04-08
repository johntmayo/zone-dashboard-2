# Altagether Zone Dashboard Workflow

## Core setup

- `main` = production / live site
- `staging` = stable testing environment
- feature branches = where new work happens

Staging lives at:

`https://staging.dashboard.altagether.org`

## Normal workflow

### 1. Start a new feature
```bash
git switch main
git pull origin main
git switch -c feature-name
```

### 2. Build the feature
Work in Cursor on that feature branch.

### 3. Save and push the feature branch
```bash
git add .
git commit -m "Describe the change"
git push -u origin feature-name
```

### 4. Test it on staging
Merge the feature branch into `staging` and push:

```bash
git switch staging
git pull origin staging
git merge feature-name
git push
```

Then test on:

`https://staging.dashboard.altagether.org`

### 5. Ship to production
After it works on staging, open a Pull Request from:

`feature-name` → `main`

Then merge it in GitHub.

## Important rules

- Do not work directly on `main`
- Do not push directly to `main`
- Use `staging` to test anything real before launch
- Use GitHub PRs to merge into `main`

## Why this works

- Feature branches give you a safe workspace
- `staging` gives you a stable OAuth-compatible test environment
- GitHub protection on `main` helps prevent accidental production pushes

## Handy commands

### Check where you are
```bash
git status
git branch
```

### Push more changes on the same branch
```bash
git add .
git commit -m "Describe the change"
git push
```

### Trigger a fresh staging deploy if needed
```bash
git switch staging
git commit --allow-empty -m "Trigger staging deployment"
git push
```
