import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-fg text-canvas hover:bg-white shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset]",
        shiny:
          "border border-intel/80 bg-raised/85 text-fg shadow-[inset_0_0_0_1px_var(--color-overlay)] before:size-1.5 before:shrink-0 before:rounded-full before:bg-intel before:animate-cta-dot hover:border-fg hover:bg-overlay",
        secondary: "border border-line-strong bg-surface text-fg hover:border-fg-subtle hover:bg-overlay",
        ghost: "text-fg-muted hover:bg-surface hover:text-fg",
        outline: "border border-line-strong text-fg hover:bg-surface",
        danger: "bg-critical text-canvas hover:bg-[#e57f65]",
        dangerOutline: "border border-critical/60 bg-critical/[0.08] text-critical hover:bg-critical/15",
        intel: "border border-intel/50 bg-intel/[0.08] text-intel hover:bg-intel/15",
        safe: "bg-safe text-canvas hover:bg-[#93b9ad]",
        link: "h-auto px-0 text-fg-muted underline-offset-4 hover:text-fg hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
