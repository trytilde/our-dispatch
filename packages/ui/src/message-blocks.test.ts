import { describe, expect, it } from "vite-plus/test";
import { splitMessageSegments } from "./message-blocks.js";

describe("message block segmentation", () => {
  it("renders attachment-shaped tool output as media without its JSON tool result", () => {
    const segments = splitMessageSegments([
      {
        type: "tool",
        tool_name: "image",
        state: "output-available",
        output: {
          attachment_id: "attachment-one",
          media_type: "image/png",
          filename: "screenshot-factory.png",
        },
      },
      {
        type: "file",
        attachment_id: "attachment-one",
        media_type: "image/png",
        filename: "screenshot-factory.png",
      },
    ]);

    expect(segments).toEqual([
      {
        kind: "files",
        parts: [
          {
            type: "file",
            attachment_id: "attachment-one",
            media_type: "image/png",
            filename: "screenshot-factory.png",
          },
        ],
      },
    ]);
  });

  it("renders a legacy inline screenshot as an image instead of base64 tool JSON", () => {
    expect(
      splitMessageSegments([
        {
          type: "tool-screenshot",
          tool_name: "screenshot",
          state: "output-available",
          output: {
            media_type: "image/png",
            data: "aGVsbG8=",
            filename: "screenshot-factory.png",
          },
        },
      ]),
    ).toEqual([
      {
        kind: "files",
        parts: [
          {
            type: "file",
            media_type: "image/png",
            filename: "screenshot-factory.png",
            url: "data:image/png;base64,aGVsbG8=",
          },
        ],
      },
    ]);
  });
});
