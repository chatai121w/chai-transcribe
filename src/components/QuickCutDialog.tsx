/**
 * Compatibility launcher for the former quick-cut dialog.
 *
 * All cut entry points now open the unified advanced cutter so there is one
 * implementation for presets, cutting, conversion, transcription and storage.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onOpenQuickCut } from "@/lib/quickCutBus";

export default function QuickCutDialog() {
  const navigate = useNavigate();

  useEffect(() => onOpenQuickCut((detail) => {
    navigate("/video-to-mp3?tab=cut", {
      state: {
        cutFile: detail.file,
        cutLabel: detail.file?.name,
        cutPreset: detail.preset,
      },
    });
  }), [navigate]);

  return null;
}
