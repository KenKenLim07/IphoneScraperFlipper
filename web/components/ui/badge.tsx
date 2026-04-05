import * as React from "react";

import { cn } from "@/lib/utils";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "secondary" | "outline";
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variantClass =
    variant === "secondary"
      ? "bg-secondary text-secondary-foreground"
      : variant === "outline"
        ? "border border-border text-foreground"
        : "bg-primary text-primary-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClass,
        className
      )}
      {...props}
    />
  );
}

