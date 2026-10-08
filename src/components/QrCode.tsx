import { useEffect, useState } from 'react'

/** A QR code for `value`, drawn as an image. The QR library loads only when needed. */
export function QrCode({ value, label, size = 168 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('qrcode').then(async (QR) => {
      // Dark on white in both colour schemes: scanners need the contrast.
      const svg = await QR.toString(value, { type: 'svg', margin: 1, color: { dark: '#2c2c2a', light: '#ffffff' } })
      if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  if (!src) return <div className="qr qr--loading" style={{ width: size, height: size }} />
  return <img className="qr" src={src} width={size} height={size} alt={label} />
}
