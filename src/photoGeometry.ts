import type { Photo } from './model'

export function photoGeometry(
  photo: Photo,
  width: number,
  height: number,
  frame: number,
  frameHeight = frame,
) {
  const sideways = Math.abs(photo.rotation) % 180 === 90
  const rotatedWidth = sideways ? height : width
  const rotatedHeight = sideways ? width : height
  const scale = Math.max(frame / rotatedWidth, frameHeight / rotatedHeight) * photo.zoom
  const overflowX = Math.max(0, rotatedWidth * scale - frame)
  const overflowY = Math.max(0, rotatedHeight * scale - frameHeight)
  return {
    width: width * scale,
    height: height * scale,
    overflowX,
    overflowY,
    centerX: frame / 2 + (0.5 - photo.x) * overflowX,
    centerY: frameHeight / 2 + (0.5 - photo.y) * overflowY,
  }
}
