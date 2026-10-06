export function rangeLabelLayout({
  startRatio,
  endRatio,
  width,
  combinedWidth,
}: {
  startRatio: number
  endRatio: number
  width: number
  combinedWidth: number
}) {
  const clampLeft = (left: number, labelWidth: number) =>
    Math.max(0, Math.min(left, width - labelWidth))
  return {
    combinedLeft: clampLeft(
      ((startRatio + endRatio) / 2) * width - combinedWidth / 2,
      combinedWidth,
    ),
  }
}
