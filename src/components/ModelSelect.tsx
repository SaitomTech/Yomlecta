type ModelOption = {
  id: string
  label: string
  disabled?: boolean
}

type ModelSelectProps = {
  id: string
  value: string
  systemModels?: readonly ModelOption[]
  localModels: readonly ModelOption[]
  apiModels: readonly ModelOption[]
  onChange: (modelId: string) => void
  disabled?: boolean
  'aria-label'?: string
}

const modelSelectClassName =
  'mt-2 w-full rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-2.5 text-sm text-[#18211f] outline-none focus:border-[#1d6b50] focus:ring-2 focus:ring-[#1d6b50]/20 disabled:cursor-not-allowed disabled:opacity-50'

export function ModelSelect({
  id,
  value,
  systemModels = [],
  localModels,
  apiModels,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: ModelSelectProps) {
  return (
    <select
      id={id}
      className={modelSelectClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {systemModels.length > 0 && (
        <optgroup label="macOS標準">
          {systemModels.map((model) => (
            <option key={model.id} value={model.id} disabled={model.disabled}>
              {model.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="ローカルモデル">
        {localModels.map((model) => (
          <option key={model.id} value={model.id} disabled={model.disabled}>
            {model.label}
          </option>
        ))}
      </optgroup>
      {apiModels.length > 0 && (
        <optgroup label="OpenAI API">
          {apiModels.map((model) => (
            <option key={model.id} value={model.id} disabled={model.disabled}>
              {model.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
