import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button variants tuned for Plexara's redesign:
 * - Larger touch targets (40px default min-height) for accessibility.
 * - Filled primary; destructive is outlined (NOT filled red) — filling buttons
 *   red induces anxiety in a medical context. Reduce anxiety everywhere.
 * - Visible focus ring on keyboard nav (a11y non-negotiable).
 * - Preserves the platform `hover-elevate` / `active-elevate-2` utilities.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium",
    "transition-colors transition-shadow duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "hover-elevate active-elevate-2",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border hover:bg-primary/90",
        destructive:
          // Outlined-only — never filled red. Hover tints the bg subtly.
          "border border-destructive/40 text-destructive bg-transparent hover:bg-destructive/5",
        outline:
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          "border bg-secondary text-secondary-foreground border-secondary-border hover:bg-secondary/80",
        ghost:
          "border border-transparent hover:bg-secondary/60 hover:text-foreground",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 40px default min-height — larger, accessible touch target
        default: "min-h-10 px-4",
        sm: "min-h-9 rounded-md px-3 text-xs",
        lg: "min-h-11 rounded-lg px-6",
        icon: "h-10 w-10",
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
