// Shared look of the FiveM charts
export const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
export const axis = { stroke: 'var(--muted-foreground)', fontSize: 12, tickLine: false, axisLine: false }
export const tooltip = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 },
  labelFormatter: (label: unknown) => shortDay(String(label)),
}
export const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
