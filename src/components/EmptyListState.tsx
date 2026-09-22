import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyListState({
  icon: Icon,
  title,
  description,
  action,
  className = 'py-24',
  role,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
  role?: 'alert'
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-5 ${className} text-center`}
      role={role}
    >
      <Icon className="text-[#9aada3]" size={33} strokeWidth={1.3} />
      <h2 className="mt-4 text-[17px] font-semibold">{title}</h2>
      <p className="mt-2 text-xs leading-6 text-[#71807b]">{description}</p>
      {action}
    </div>
  )
}
