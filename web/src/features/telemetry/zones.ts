// GTA V world: bounds in game units (north up) and rough centres of the main areas
export const WORLD = { xMin: -4200, xMax: 4600, yMin: -4400, yMax: 8400 }

export const ZONES: [string, number, number][] = [
  ['Los Santos', 100, -900], ['Vespucci', -1250, -1350], ['Aéroport LS', -1150, -2850], ['Port de LS', 950, -2950],
  ['Vinewood', 300, 850], ['Mirror Park', 1150, -550], ['Rancho', 400, -1800], ['Pacific Bluffs', -2000, -350],
  ['Chumash', -3150, 950], ['Tongva Hills', -1700, 1900], ['Fort Zancudo', -2250, 3100], ['Great Chaparral', -350, 2650],
  ['Harmony', 550, 2700], ['Grand Senora', 1700, 2900], ['Sandy Shores', 1850, 3700], ['Alamo Sea', 900, 4100],
  ['Grapeseed', 1700, 4800], ['Mont Chiliad', 500, 5600], ['Paleto Bay', -250, 6300], ['Palomino', 2600, -600],
  ['Mont Gordo', 2850, 5500], ['Raton Canyon', -1300, 4400],
]

export function zoneIndex(x: number, y: number) {
  let best = 0
  let bd = Infinity
  ZONES.forEach(([, zx, zy], i) => {
    const d = (zx - x) ** 2 + (zy - y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

export const zoneName = (x: unknown, y: unknown) => {
  const nx = Number(x)
  const ny = Number(y)
  return Number.isFinite(nx) && Number.isFinite(ny) && x !== null && y !== null ? ZONES[zoneIndex(nx, ny)][0] : '?'
}
