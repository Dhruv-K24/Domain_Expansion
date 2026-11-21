// Vite config with a tiny dataset API.
// The browser can't write files to your project by itself (security), but the dev server
// runs on your machine with Node.js, so it can.
//
// SAFETY DESIGN (learned the hard way):
//  - The page never sends "here is the whole file, replace it". It only sends
//    "ADD these new samples" or "DELETE samples with this label". So a page that loaded
//    nothing, or an old tab that's out of date, can't wipe what's on disk.
//  - Every change makes a timestamped backup first (data/backups, last 20 kept).
//  - Every response says how many samples are now on disk, so the page can show proof.
//
// TWO PAGES, one codebase:
//   index.html  laptop: training UI, HUD, test keys            npm run dev
//   phone.html  phone:  camera + vignette + domains only       npm run dev:phone  (HTTPS on your Wi-Fi)
// `npm run build` makes a standalone copy of both in dist/ (no server needed; the trained signs
// are bundled as signs.json), ready to host on any HTTPS static host.
import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { MODELS } from './src/models'

// `npm run dev:phone` runs `vite --mode phone`: serve on your local network over HTTPS.
// Phones only allow the camera on HTTPS pages (or localhost), so plain http://<your-pc-ip> won't work.
const PHONE = process.argv.includes('phone') // works the same on Windows / Mac / Linux

const FILE = path.resolve('data/signs.json')
const BACKUPS = path.resolve('data/backups')

type Sample = { label: string; f: number[]; rec?: number }

function readAll(): Sample[] {
  return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []
}

function writeAll(samples: Sample[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  if (fs.existsSync(FILE)) {
    fs.mkdirSync(BACKUPS, { recursive: true })
    fs.copyFileSync(FILE, path.join(BACKUPS, `signs-${Date.now()}.json`))
    const old = fs.readdirSync(BACKUPS).sort().slice(0, -20)
    for (const f of old) fs.unlinkSync(path.join(BACKUPS, f))
  }
  // write to a temp file, then rename: if the computer dies mid-write,
  // you get either the old file or the new one, never half a file.
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(samples))
  fs.renameSync(FILE + '.tmp', FILE)
}

function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
    })
  })
}

// build stamp shown in the app (e.g. "v11-21 17:05"), so you can see which version is running
const BUILD = new Date().toLocaleString('en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replaceAll('/', '-').replace(',', '')

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) }, // relative paths: the built app works from any folder or host
  // laptop: 127.0.0.1 (Claude's preview tool can't reach an IPv6-only server)
  // phone:  all network interfaces, so your phone can reach your PC over Wi-Fi
  server: { host: PHONE ? true : '127.0.0.1', watch: { ignored: ['**/data/**'] } },
  build: {
    rollupOptions: {
      input: { main: path.resolve('index.html'), phone: path.resolve('phone.html') },
    },
  },
  plugins: [
    ...(PHONE ? [basicSsl()] : []), // a self-signed HTTPS certificate (your phone will warn once)
    {
      // copy the trained signs into the build, so the standalone app can recognise them
      name: 'bundle-dataset',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'signs.json', source: fs.readFileSync(FILE, 'utf8') })
      },
    },
    {
      // OFFLINE: write dist/sw.js (from sw-template.js) with the exact list of files to save.
      // Runs AFTER the build has written everything (closeBundle) and simply lists what's
      // really in dist/ — so the list can't contain a file that doesn't exist (one missing
      // file would make the whole offline install fail). Built names contain random hashes
      // (main-Cc1-V49o.js), which is why this can't be a hand-written list.
      // The version is a hash of every file's contents: any change = new version.
      name: 'service-worker',
      apply: 'build',
      closeBundle() {
        const out = path.resolve('dist')
        const files: string[] = []
        ;(function walk(dir: string, rel: string) {
          for (const f of fs.readdirSync(dir).sort()) {
            const p = path.join(dir, f), r = rel ? rel + '/' + f : f
            if (fs.statSync(p).isDirectory()) walk(p, r); else if (r !== 'sw.js') files.push(r)
          }
        })(out, '')
        const hash = crypto.createHash('sha1')
        for (const f of files) hash.update(f).update(fs.readFileSync(path.join(out, f)))
        // replace the exact CODE lines (not just the first match: the comment mentions them too)
        const fill = (src: string, line: string, value: string) => {
          if (!src.includes(line)) throw new Error('sw-template.js: missing line ' + line)
          return src.replace(line, line.replace(/__[A-Z]+__/, value))
        }
        let source = fs.readFileSync('sw-template.js', 'utf8')
        source = fill(source, "const CACHE = 'jjk-domains-__VERSION__'", hash.digest('hex').slice(0, 10))
        source = fill(source, 'const FILES = __FILES__', JSON.stringify(files.map((f) => './' + f)))
        source = fill(source, 'const MODELS = __MODELS__', JSON.stringify(Object.values(MODELS)))
        fs.writeFileSync(path.join(out, 'sw.js'), source)
        console.log(`  service worker: ${files.length} files saved for offline use`)
      },
    },
    {
      name: 'dataset-api',
      configureServer(server) {
        server.middlewares.use('/api/dataset', async (req, res) => {
          const reply = (code: number, obj: unknown) => {
            res.statusCode = code
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            if (req.method === 'GET') return reply(200, readAll())
            if (req.method === 'POST' && req.url === '/append') {
              const add: Sample[] = await readBody(req)
              if (!Array.isArray(add) || add.some((s) => typeof s.label !== 'string' || !Array.isArray(s.f)))
                return reply(400, { error: 'bad samples' })
              const all = readAll().concat(add)
              writeAll(all)
              return reply(200, { total: all.length })
            }
            if (req.method === 'POST' && req.url === '/delete') {
              const { label } = await readBody(req)
              const all = readAll().filter((s) => s.label !== label)
              writeAll(all)
              return reply(200, { total: all.length })
            }
            reply(404, { error: 'unknown route' })
          } catch (e) {
            reply(500, { error: String(e) })
          }
        })
      },
    },
  ],
})
