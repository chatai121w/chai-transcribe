import { assertEquals } from "jsr:@std/assert@1";
import { extractInteractionTranscript } from "./interaction-response.ts";

Deno.test("extracts the documented output_text field", () => {
  assertEquals(
    extractInteractionTranscript({ output_text: "  שלום עולם  " }),
    "שלום עולם",
  );
});

Deno.test("extracts text content from completed interaction steps", () => {
  assertEquals(
    extractInteractionTranscript({
      status: "completed",
      steps: [
        { content: [{ type: "text", text: "שלום" }] },
        { content: [{ type: "text", text: "עולם" }] },
      ],
    }),
    "שלום\n\nעולם",
  );
});

Deno.test("ignores annotations and non-text content", () => {
  assertEquals(
    extractInteractionTranscript({
      steps: [{ content: [{ type: "audio", text: "not transcript" }] }],
    }),
    "",
  );
});
