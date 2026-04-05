import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow hover:opacity-90 focus-visible:ring-primary",
  secondary:
    "bg-secondary text-secondary-foreground hover:opacity-90 focus-visible:ring-secondary",
  outline:
    "border border-border bg-transparent hover:bg-muted focus-visible:ring-ring",
  ghost:
    "bg-transparent hover:bg-muted focus-visible:ring-ring",
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90 focus-visible:ring-destructive"
};

const sizes: Record<ButtonSize, string> = {
  default: "h-11 px-4 py-2 sm:h-10",
  sm: "h-10 rounded-md px-3 sm:h-9",
  lg: "h-12 rounded-md px-6 sm:h-11",
  icon: "h-11 w-11 sm:h-10 sm:w-10"
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        {...(!asChild ? { type } : {})}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
