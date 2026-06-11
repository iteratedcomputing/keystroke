# hooks

a hook is any executable file. when the timer hits zero (or you ship early),
keystroke writes your post to a temp markdown file and runs the hook with it.

## resolution

keystroke looks for the hook at `$KEYSTROKE_HOOK`, falling back to `./hook`
relative to where the server was started. the file must exist and be
executable, otherwise the ui refuses to let you write.

## contract

| input                        | meaning                            |
| ---------------------------- | ---------------------------------- |
| `$1`                         | absolute path to the markdown file |
| `KEYSTROKE_TITLE`            | the title as typed, may be empty   |
| `KEYSTROKE_SLUG`             | lowercased, hyphenated title       |
| `KEYSTROKE_DURATION_MINUTES` | the duration that was picked       |

the file is named `YYYY-MM-DD-<slug>.md` and contains only the editor body,
no front matter. add your own in the hook if your blog needs it.

- exit 0: the post is considered published and the session is cleared
- any other exit code: the ui shows your stdout/stderr and the draft path
- stdout is shown in the ui on success too, so print something useful
- hooks are killed after 2 minutes by default; override with
  `KEYSTROKE_HOOK_TIMEOUT` (milliseconds)

## example: publish to a blog repo via pr

```sh
#!/bin/sh
set -e

blog=$HOME/projects/my-blog
post=posts/$(basename "$1")
branch=post/$KEYSTROKE_SLUG

cd "$blog"
git checkout main -q && git pull -q
git checkout -b "$branch" -q
{
  echo "---"
  echo "title: $KEYSTROKE_TITLE"
  echo "date: $(date +%Y-%m-%d)"
  echo "---"
  cat "$1"
} > "$post"
git add "$post"
git commit -qm "post: $KEYSTROKE_SLUG"
git push -qu origin "$branch"
gh pr create --fill
gh pr merge --squash --delete-branch
echo "published $post"
```

## the demo hook

`make demo` starts the server with `hooks/wordcount.sh`, a bundled hook that
counts the words in your post and publishes nothing. it exists so you can
feel the timer before wiring up a real destination.

## testing a hook

run it by hand before trusting it with a deadline:

```sh
echo "# test post" > /tmp/test.md
KEYSTROKE_TITLE="Test" KEYSTROKE_SLUG=test ./hook /tmp/test.md
```
