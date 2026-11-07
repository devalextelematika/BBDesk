import { Icon, type IconName } from "./ui/icon";

export function SmallButton({ label, icon, onClick, disabled = false, pressed }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <button type="button" className="db-icon-btn" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}><Icon name={icon} className="db-icon"/></button>;
}
