import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

/** A select over a short list of labelled values. */
export function SimpleSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  disabled,
  testId,
  label,
  className,
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  testId?: string;
  /** For a select without a visible label. */
  label?: string;
  className?: string;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => next !== null && onChange(next as T)}
      disabled={disabled}
    >
      <SelectTrigger id={id} data-testid={testId} aria-label={label} className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
