"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogTitle } from "./dialog.js";
import { cn } from "../../lib/utils.js";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-window bg-surface text-ink",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command palette",
  children,
  className,
  commandProps,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  className?: string;
  commandProps?: React.ComponentProps<typeof CommandPrimitive>;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        aria-describedby={undefined}
        className={cn("top-[82px] max-w-[560px] translate-y-0 p-0", className)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command
          loop
          {...commandProps}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5
            [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium
            [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]
            [&_[cmdk-group-heading]]:text-ink-3"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <CommandPrimitive.Input
        className={cn(
          "h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none max-[720px]:text-[16px]",
          "placeholder:text-ink-3",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-[360px] overflow-y-auto p-1.5", className)}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("px-3 py-8 text-center text-[13px] text-ink-3", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn(className)} {...props} />;
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-control px-2.5 py-2",
        "text-[13px] text-ink outline-none",
        "data-[selected=true]:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn("my-1.5 h-px bg-line", className)} {...props} />;
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
