"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils.js";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[var(--scrim)]",
        "data-[state=open]:animate-[fade-in_150ms_ease-out]",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-window border-[0.5px] border-line-strong bg-surface text-ink shadow-overlay outline-none",
          "data-[state=open]:animate-[pop-in_160ms_cubic-bezier(0.23,1,0.32,1)]",
          "max-[720px]:!inset-x-0 max-[720px]:!top-auto max-[720px]:!bottom-0 max-[720px]:!max-h-[calc(100dvh-20px)] max-[720px]:!max-w-none max-[720px]:!translate-x-0 max-[720px]:!translate-y-0 max-[720px]:!rounded-b-none max-[720px]:!border-x-0 max-[720px]:!border-b-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
