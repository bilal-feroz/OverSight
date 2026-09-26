import { cn } from "@/lib/utils";

/** Renders block text, optionally emphasizing the decision-critical phrase. */
export function BlockText({
  text,
  phrase,
  emphasize,
  className,
}: {
  text: string;
  phrase?: string;
  emphasize?: boolean;
  className?: string;
}) {
  if (!emphasize || !phrase) return <span className={className}>{text}</span>;
  const index = text.indexOf(phrase);
  if (index < 0 || phrase.length === text.length) {
    return (
      <span className={cn(className, emphasize && "text-fg")}>
        {text}
      </span>
    );
  }
  return (
    <span className={className}>
      {text.slice(0, index)}
      <mark className="bg-transparent font-medium text-fg underline decoration-critical/80 decoration-2 underline-offset-[5px]">
        {phrase}
      </mark>
      {text.slice(index + phrase.length)}
    </span>
  );
}
