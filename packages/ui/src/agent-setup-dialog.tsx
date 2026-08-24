import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AgentAvatar } from "./agent-avatar.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";

const setupPhrases = [
  "Making room for a new point of view",
  "Connecting tools and skills",
  "Preparing the agent instructions",
  "Creating a private workspace",
  "Connecting the shared computer",
  "Syncing the available tools",
  "Registering your new bot",
  "Checking the agent configuration",
  "Learning where everything lives",
  "Organising the toolbox",
  "Reading the house rules",
  "Preparing the first conversation",
  "Warming up a first hello",
  "Running the final checks",
  "Almost ready to meet you",
] as const;

function randomNextPhrase(current: number): number {
  const offset = 1 + Math.floor(Math.random() * (setupPhrases.length - 1));
  return (current + offset) % setupPhrases.length;
}

export interface AgentSetupDialogProps {
  agentId: string;
  avatarId?: string;
  error?: string;
  name: string;
  onClose: () => void;
  open: boolean;
  status: "starting" | "setting_up" | "failed";
}

export function AgentSetupDialog({
  agentId,
  avatarId,
  error,
  name,
  onClose,
  open,
  status,
}: AgentSetupDialogProps) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const failed = status === "failed";
  const displayedAvatarId = avatarId || agentId || name;

  useEffect(() => {
    if (!open || failed) return;
    const interval = window.setInterval(() => setPhraseIndex(randomNextPhrase), 1_800);
    return () => window.clearInterval(interval);
  }, [failed, open]);

  useEffect(() => {
    if (!open) setPhraseIndex(0);
  }, [open]);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && failed) onClose();
      }}
      open={open}
    >
      <DialogContent
        aria-describedby="agent-setup-message"
        className="agent-setup-dialog max-w-[420px] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (!failed) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!failed) event.preventDefault();
        }}
      >
        <div className="agent-setup-content" data-avatar-id={displayedAvatarId}>
          <div className="agent-setup-avatar-stage">
            <AgentAvatar className="agent-setup-avatar" id={displayedAvatarId} state="idle" />
          </div>
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <div className="agent-setup-message-frame" id="agent-setup-message" role="status">
            {failed ? (
              <p className="agent-setup-error">{error || "Setup could not be completed."}</p>
            ) : (
              <AnimatePresence initial={false} mode="wait">
                <motion.p
                  animate={{ opacity: 1, y: 0 }}
                  className="agent-setup-phrase"
                  exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
                  key={setupPhrases[phraseIndex]}
                  transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeInOut" }}
                >
                  {setupPhrases[phraseIndex]}
                </motion.p>
              </AnimatePresence>
            )}
          </div>
          {failed ? (
            <button className="agent-setup-close" onClick={onClose} type="button">
              Close
            </button>
          ) : (
            <span aria-hidden="true" className="agent-setup-dots">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
