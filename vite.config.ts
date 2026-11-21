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
import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

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

export default defineConfig({
  // 127.0.0.1 (IPv4) explicitly: Claude's preview tool can't reach an IPv6-only server
  server: { host: '127.0.0.1', watch: { ignored: ['**/data/**'] } },
  plugins: [
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
