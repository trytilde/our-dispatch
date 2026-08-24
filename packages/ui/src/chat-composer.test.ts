import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ChatComposer, type ChatComposerProps } from "./chat-composer.js";

function renderComposer(busy: boolean): string {
  const props: ChatComposerProps = {
    agentAvailable: true,
    attachments: [],
    busy,
    draft: "A message",
    dragging: false,
    expanded: false,
    fileInputRef: createRef<HTMLInputElement>(),
    inputRef: createRef<HTMLTextAreaElement>(),
    onCancelReply: () => undefined,
    onDraftChange: () => undefined,
    onDragStateChange: () => undefined,
    onFilesAdded: () => undefined,
    onRemoveAttachment: () => undefined,
    onStop: () => undefined,
    onSubmit: (event) => event.preventDefault(),
    submitting: false,
  };
  return renderToStaticMarkup(createElement(ChatComposer, props));
}

describe("ChatComposer actions", () => {
  it("renders only the stop action while the bot is busy", () => {
    const markup = renderComposer(true);

    expect(markup).toContain('aria-label="Stop"');
    expect(markup).not.toContain('aria-label="Send message"');
    expect(markup).not.toContain('aria-label="Queue message"');
  });

  it("renders the send action when the bot is idle", () => {
    const markup = renderComposer(false);

    expect(markup).toContain('aria-label="Send message"');
    expect(markup).not.toContain('aria-label="Stop"');
  });
});
