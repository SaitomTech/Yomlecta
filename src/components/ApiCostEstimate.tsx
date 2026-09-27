import { Calculator } from 'lucide-react'
import type { OpenAiCostEstimate } from '../lib/openai/cost'
import { formatOpenAiCost } from '../lib/openai/cost'

type ApiCostEstimateProps = {
  isOpenAi: boolean
  estimate?: OpenAiCostEstimate
  label?: string
}

export function ApiCostEstimate({
  isOpenAi,
  estimate,
  label = 'この処理の費用見込み',
}: ApiCostEstimateProps) {
  if (!isOpenAi || !estimate) return null

  const formatted = formatOpenAiCost(estimate.usd)

  return (
    <div
      className="mt-3 rounded-[9px] border border-[#c9dfcf] bg-[#eef6f0] px-3 py-2.5"
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#245c47]">
          <Calculator size={13} />
          {label}
        </p>
        <p className="text-right text-xs font-bold text-[#174d3c]">
          {formatted.yenLabel}
          <span className="ml-1 font-mono text-[10px] font-medium text-[#71807b]">
            ({formatted.usdLabel})
          </span>
        </p>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-[#71807b]">
        目安です。入力・出力トークン量で変動します（1ドル=160円換算、請求はUSD）。
      </p>
    </div>
  )
}
