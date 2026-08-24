"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "../../lib/utils.js";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full",
        "border border-transparent bg-line-strong transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[14px] rounded-full bg-surface shadow-btn",
          "transition-transform translate-x-[1px] data-[state=checked]:translate-x-[13px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
