import { cn } from "@/lib/utils";

export function EmojiPicker({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (emoji: string) => void;
  options: string[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "scroll-slim grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-2",
        className,
      )}
    >
      {options.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onChange(emoji)}
          className={cn(
            "aspect-square rounded-md text-xl leading-none transition-colors hover:bg-secondary",
            value === emoji && "bg-primary/20 ring-2 ring-primary",
          )}
          aria-label={`Choose ${emoji}`}
          aria-pressed={value === emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
