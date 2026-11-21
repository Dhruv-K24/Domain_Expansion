// The dataset = every example you've recorded, stored in data/signs.json by the dev server.
// See vite.config.ts for the safety design: the page only ever ADDS or DELETES-BY-LABEL,
// it never replaces the whole file.
import type { Sample } from './knn'

export const DOMAINS = [
  { id: 'infinite_void', name: 'Unlimited Void', user: 'Gojo' },
  { id: 'malevolent_shrine', name: 'Malevolent Shrine', user: 'Sukuna' },
  { id: 'chimera_shadow_garden', name: 'Chimera Shadow Garden', user: 'Megumi' },
  { id: 'self_embodiment', name: 'Self-Embodiment of Perfection', user: 'Mahito' },
  { id: 'coffin_iron_mountain', name: 'Coffin of the Iron Mountain', user: 'Jogo' },
  { id: 'idle_death_gamble', name: 'Idle Death Gamble', user: 'Hakari' },
  // "none" = examples of NOT doing a sign (random hands, waving, scratching your head).
  // Very important: it teaches the classifier what "nothing" looks like.
  { id: 'none', name: 'Not a sign', user: '' },
] as const

export const domainName = (id: string) => DOMAINS.find((d) => d.id === id)?.name ?? id

async function call(url: string, body?: unknown) {
  const r = await fetch(url, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`server said HTTP ${r.status}`)
  return r.json()
}

export async function loadDataset(): Promise<Sample[]> {
  // Laptop dev server: live API (supports recording). Standalone build (phone): there is no
  // server, so we fall back to the copy of signs.json that the build bundles next to the app.
  let data
  try { data = await call('/api/dataset') }
  catch { data = await call(`${import.meta.env.BASE_URL}signs.json`) }
  if (!Array.isArray(data)) throw new Error('dataset file is not a list')
  return data
}

/** Add new samples. Returns how many samples are now ON DISK (proof it saved). */
export async function appendSamples(add: Sample[]): Promise<number> {
  // round numbers so the file stays small (3 decimals is plenty)
  const compact = add.map((s) => ({ ...s, f: s.f.map((v) => Math.round(v * 1000) / 1000) }))
  return (await call('/api/dataset/append', compact)).total
}

export async function deleteLabel(label: string): Promise<number> {
  return (await call('/api/dataset/delete', { label })).total
}
