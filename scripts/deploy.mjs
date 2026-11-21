// npm run deploy  — build the app and publish it to GitHub Pages.
//
// How GitHub Pages works here: whatever is in the repo's `gh-pages` branch is served as a
// website at https://<user>.github.io/<repo>/. So we:
//   1. build the app into dist/
//   2. turn dist/ into its own tiny git repo with a single commit on branch gh-pages
//   3. force-push that to the gh-pages branch of your repo (it only ever holds the latest build)
// Your source code lives separately on `main`; this never touches it.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd })
const remote = execSync('git remote get-url origin').toString().trim()

run('npm run build')

const dist = path.resolve('dist')
fs.writeFileSync(path.join(dist, '.nojekyll'), '') // tell GitHub to serve files as-is (no Jekyll processing)
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true })

run('git init -q -b gh-pages', dist)
run('git add -A', dist)
run(`git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Deploy ${new Date().toISOString()}"`, dist)
run(`git push -f ${remote} gh-pages`, dist)
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true })

const m = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
if (m) console.log(`\nPublished! Phone link: https://${m[1].toLowerCase()}.github.io/${m[2]}/phone.html\n(GitHub can take a minute or two to update.)`)
