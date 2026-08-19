import type { SVGProps } from 'react'

export type IconName = 'people' | 'map' | 'bag' | 'book' | 'folio' | 'close' | 'back' | 'pen' | 'arrow' | 'image' | 'refresh' | 'volume' | 'volumeOff'

const paths: Record<IconName, React.ReactNode> = {
  people: <><circle cx="8" cy="8" r="2.75"/><circle cx="16" cy="8" r="2.75"/><path d="M3.5 19.5c.45-3.7 2-5.55 4.5-5.55s4.05 1.85 4.5 5.55M11.5 19.5c.45-3.7 2-5.55 4.5-5.55s4.05 1.85 4.5 5.55"/><path d="M10.3 11.2h3.4"/></>,
  map: <><path d="M4 5.5 9 3l6 2.5L20 3v15.5L15 21l-6-2.5L4 21Z"/><path d="M9 3v15.5M15 5.5V21"/><circle cx="7" cy="8.5" r="1"/><circle cx="17.5" cy="15" r="1"/><path d="M8 9.2c2.2.6 2.7 3.5 5 4.1 1 .3 2.1.2 3.5 1"/></>,
  bag: <><path d="M5 8.5h14l1 11.5H4Z"/><path d="M8.5 8.5V6.8A3.2 3.2 0 0 1 11.7 3.5h.6a3.2 3.2 0 0 1 3.2 3.3v1.7"/><path d="M4.5 12h15M9.5 12v2.8h5V12"/></>,
  book: <><path d="M6 3.5h11.5A1.5 1.5 0 0 1 19 5v15.5H7A2.5 2.5 0 0 1 4.5 18V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M4.5 18A2.5 2.5 0 0 1 7 15.5h12M8 3.5v12M11 8h5M11 11h4"/></>,
  folio: <><path d="M5 3.5h12.5A1.5 1.5 0 0 1 19 5v15.5H6.5A2.5 2.5 0 0 1 4 18V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M4 18a2.5 2.5 0 0 1 2.5-2.5H19M8 7.5h7M8 10.5h4"/><circle cx="15.8" cy="10.8" r="1.5"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  back: <><path d="M19 12H6M10 7l-5 5 5 5"/></>,
  pen: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m13.5 7.5 3 3"/></>,
  arrow: <><path d="M5 12h13M14 7l5 5-5 5"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 4 4 2-2 5 4"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-1.5 4.3"/></>,
  volume: <><path d="M5 10v4h3l4 4V6L8 10Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></>,
  volumeOff: <><path d="M5 10v4h3l4 4V6L8 10Z"/><path d="m16 10 5 5M21 10l-5 5"/></>,
}

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
