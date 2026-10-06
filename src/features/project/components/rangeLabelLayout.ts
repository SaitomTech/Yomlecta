export function rangeLabelLayout({
  startRatio,
  endRatio,
  width,
  startWidth,
  endWidth,
  combinedWidth,
}: {
  startRatio: number
  endRatio: number
  width: number
  startWidth: number
  endWidth: number
  combinedWidth: number
}) {
  const clampLeft = (left: number, labelWidth: number) =>
    Math.max(0, Math.min(left, width - labelWidth))
  const startLeft = clampLeft(startRatio * width - startWidth / 2, startWidth)
  const endLeft = clampLeft(endRatio * width - endWidth / 2, endWidth)
  const showStart = startRatio > 0
  const showEnd = endRatio < 1

  return {
    showStart,
    showEnd,
    combined: showStart && showEnd && endLeft - (startLeft + startWidth) < 8,
    startLeft,
    endLeft,
    combinedLeft: clampLeft(
      ((startRatio + endRatio) / 2) * width - combinedWidth / 2,
      combinedWidth,
    ),
  }
}
