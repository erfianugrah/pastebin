import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

// ─── McMaster brutalist button ──────────────────────────────────────
// All variants share: 1px solid border, hard corners, no shadow,
// instant hover. Single yellow primary reserved for the dominant CTA
// on each page (Create paste, Decrypt, Confirm delete, etc.).
//
// `asChild` lets you wrap an <a>; we strip the anchor's default
// underline via the .btn class (see globals.css base layer).

const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap border font-medium select-none transition-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Default = grey utility button. The bulk of the UI lives here.
        default:
          "border-input bg-card text-foreground hover:bg-primary hover:border-primary hover:text-primary-foreground",
        // PRIMARY — yellow. One per surface, max.
        primary:
          "border-primary-hover bg-primary text-primary-foreground hover:bg-primary-hover",
        // Destructive — red border on transparent. Hover fills.
        destructive:
          "border-destructive bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground",
        // Outline — alias of default for back-compat with existing call
        // sites that explicitly request `variant="outline"`.
        outline:
          "border-input bg-card text-foreground hover:bg-primary hover:border-primary hover:text-primary-foreground",
        // Ghost — no border, hover fills cell. For dropdown rows etc.
        ghost: "border-transparent bg-transparent hover:bg-muted",
        // Link — underlined text only. Use a real <a> when possible.
        link: "border-transparent bg-transparent text-link underline underline-offset-2 hover:decoration-2",
        // Secondary — alias of default; kept for back-compat.
        secondary:
          "border-input bg-card text-foreground hover:bg-muted",
      },
      size: {
        // Default 28px tall. Mono is denser than proportional so smaller
        // works fine. Frequent action rows can use sm (24px).
        default: "h-7 px-2.5 text-xs",
        sm: "h-6 px-2 text-xs",
        lg: "h-9 px-3.5 text-sm",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
