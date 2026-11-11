import { useEffect, useRef, useState } from 'react'

import type { Photo } from './model'
import { photoGeometry } from './photoGeometry'

export function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))

export function PhotoCrop({
  initial,
  onClose,
  onApply,
}: {
  initial: Photo
  onClose: () => void
  onApply: (settings: Photo) => void
}) {
  const [crop, setCrop] = useState(initial)
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const frame = 512
  const width = photo?.naturalWidth || 1
  const height = photo?.naturalHeight || 1
  const geometry = photoGeometry(crop, width, height, frame)
  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setPhoto(image)
    }
    image.onerror = () => {
      if (!cancelled) setError('图片无法打开，请取消后重新选择 JPG 或 PNG。')
    }
    image.src = initial.src
    return () => {
      cancelled = true
    }
  }, [initial.src])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !photo) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, frame, frame)
    ctx.translate(geometry.centerX, geometry.centerY)
    ctx.rotate((crop.rotation * Math.PI) / 180)
    ctx.drawImage(photo, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height)
  }, [crop, photo, geometry.width, geometry.height, geometry.centerX, geometry.centerY])

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div
      className="re-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="re-dialog re-crop" role="dialog" aria-modal="true" aria-label="裁剪照片">
        <header>
          <h3>裁剪照片</h3>
          <button aria-label="关闭裁剪" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="re-crop-stage">
          <canvas
            width={frame}
            height={frame}
            ref={canvas}
            aria-label="头像取景（拖动调整位置）"
            onPointerDown={(e) => {
              drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d) return
              const ratio = frame / e.currentTarget.getBoundingClientRect().width
              setCrop((c) => ({
                ...c,
                x: geometry.overflowX ? clamp(d.x - ((e.clientX - d.px) * ratio) / geometry.overflowX) : 0.5,
                y: geometry.overflowY ? clamp(d.y - ((e.clientY - d.py) * ratio) / geometry.overflowY) : 0.5,
              }))
            }}
            onPointerUp={() => {
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <label className="re-zoom">
          缩放{' '}
          <input
            type="range"
            aria-label="照片缩放"
            min="1"
            max="3"
            step=".01"
            value={crop.zoom}
            onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
          />
          <output>{Math.round(crop.zoom * 100)}%</output>
        </label>
        <div className="re-actions">
          <button
            onClick={() => setCrop((c) => ({ ...c, rotation: (c.rotation + 270) % 360, x: 0.5, y: 0.5 }))}
          >
            ↶ 向左旋转
          </button>
          <button
            onClick={() => setCrop((c) => ({ ...c, rotation: (c.rotation + 90) % 360, x: 0.5, y: 0.5 }))}
          >
            ↷ 向右旋转
          </button>
        </div>
        <footer>
          <button onClick={onClose}>取消</button>
          <button
            className="re-primary"
            disabled={!photo}
            onClick={() => {
              if (canvas.current && photo) onApply(crop)
            }}
          >
            应用
          </button>
        </footer>
      </div>
    </div>
  )
}
