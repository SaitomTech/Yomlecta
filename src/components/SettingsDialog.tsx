import { Download, RefreshCw, Scale, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { getUpdateMessage, useUpdates } from '../lib/updateContext'
import { useDialogA11y } from '../lib/ui/useDialogA11y'
import { LicenseDialog } from './LicenseDialog'

export function SettingsDialog({
  onClose,
  disabled = false,
}: {
  onClose: () => void
  disabled?: boolean
}) {
  const updates = useUpdates()
  const { update, phase, progress, autoCheck, setAutoCheck, checkForUpdates, installUpdate } =
    updates
  const [licenseOpen, setLicenseOpen] = useState(false)
  const isUpdateBusy = phase === 'checking' || phase === 'downloading' || phase === 'installing'
  const isInstallingUpdate = phase === 'downloading' || phase === 'installing'
  const dialogRef = useDialogA11y({
    open: true,
    onClose: () => {
      if (!licenseOpen) onClose()
    },
  })

  return (
    <>
      <dialog
        ref={dialogRef}
        className="fixed inset-0 z-50 m-0 grid h-full w-full max-h-none max-w-none place-items-center border-0 bg-[#18211f]/35 px-4 py-6 backdrop-blur-[2px]"
        open
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <section className="w-full max-w-[520px] overflow-hidden rounded-[16px] border border-[#b7cbc0] bg-white shadow-[0_24px_70px_rgba(24,33,31,0.2)]">
          <header className="flex items-start justify-between gap-4 border-b border-[#d8e1dc] px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e8f2ec] text-[#1d6b50]">
                <Settings size={17} />
              </span>
              <div>
                <h2 id="settings-dialog-title" className="text-sm font-bold">
                  設定
                </h2>
                <p className="mt-1 text-[10px] leading-4 text-[#71807b]">
                  更新確認やアプリ情報を管理します。
                </p>
              </div>
            </div>
            <button
              className="rounded-md p-1.5 text-[#9aa6a1] hover:bg-[#eef3ef] hover:text-[#174d3c]"
              type="button"
              onClick={onClose}
              aria-label="設定を閉じる"
            >
              <X size={17} />
            </button>
          </header>
          <div className="space-y-5 px-5 py-5">
            <section className="rounded-[12px] border border-[#d8e1dc] bg-[#f7faf7] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold">アップデート</h3>
                  <p className="mt-1 text-[11px] leading-5 text-[#71807b]">
                    {getUpdateMessage(updates) ?? '最新版かどうかを確認できます。'}
                  </p>
                </div>
                {update && (
                  <span className="rounded-full bg-[#fff4da] px-2 py-1 text-[10px] font-semibold text-[#8b6a2b]">
                    更新あり
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#53615b]">
                  <input
                    className="accent-[#1d6b50]"
                    type="checkbox"
                    checked={autoCheck}
                    onChange={(event) => setAutoCheck(event.target.checked)}
                  />
                  更新を自動確認
                </label>
                <div className="flex flex-wrap gap-2">
                  {update && (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1d6b50] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#174d3c] disabled:opacity-50"
                      type="button"
                      onClick={() => void installUpdate()}
                      disabled={isUpdateBusy || disabled}
                    >
                      <Download size={13} />
                      {phase === 'installed' ? '再起動' : 'インストール'}
                    </button>
                  )}
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#b7cbc0] bg-white px-3 py-2 text-[11px] font-semibold text-[#53615b] hover:bg-[#e8f2ec] disabled:opacity-50"
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={isUpdateBusy || phase === 'installed'}
                  >
                    <RefreshCw className={isUpdateBusy ? 'animate-spin' : ''} size={13} />
                    {isInstallingUpdate && progress !== null ? `${progress}%` : '更新を確認'}
                  </button>
                </div>
              </div>
            </section>
            <button
              className="flex w-full items-center gap-3 rounded-[12px] border border-[#d8e1dc] px-4 py-3 text-left transition hover:bg-[#f7faf7]"
              type="button"
              onClick={() => setLicenseOpen(true)}
            >
              <Scale size={16} className="text-[#1d6b50]" />
              <span>
                <span className="block text-xs font-semibold">ライセンス情報</span>
                <span className="mt-0.5 block text-[10px] text-[#71807b]">
                  アプリ本体と外部コンポーネントのライセンスを表示
                </span>
              </span>
            </button>
          </div>
        </section>
      </dialog>
      {licenseOpen && <LicenseDialog onClose={() => setLicenseOpen(false)} />}
    </>
  )
}
