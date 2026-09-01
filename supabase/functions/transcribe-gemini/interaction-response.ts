type InteractionContent = {
  type?: string;
  text?: string;
};

type InteractionStep = {
  content?: InteractionContent[];
};

type InteractionResponse = {
  output_text?: string;
  outputText?: string;
  steps?: InteractionStep[];
};

/** Extract text from both documented Interactions API response shapes. */
export function extractInteractionTranscript(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const interaction = payload as InteractionResponse;
  const direct = interaction.output_text || interaction.outputText;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  return (interaction.steps || [])
    .flatMap((step) => step.content || [])
    .filter((content) => !content.type || content.type === "text")
    .map((content) => typeof content.text === "string" ? content.text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
