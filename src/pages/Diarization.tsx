import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { SpeakerDiarization } from "@/components/SpeakerDiarization";
import { DiarizationSkeleton } from "@/components/PageSkeleton";
import { db } from "@/lib/localDb";

const Diarization = () => {
  const location = useLocation();
  const stateText = location.state?.text as string | undefined;

  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Recover audio blob from Dexie (same mechanism as TextEditor)
  useEffect(() => {
    (async () => {
      try {
        const entry = await db.audioBlobs.get("last_audio");
        if (entry?.blob) {
          setAudioBlob(entry.blob);
          setAudioName(entry.name || "audio.webm");
        }
      } catch {
        /* Dexie not available */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <DiarizationSkeleton />;

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4" dir="rtl">
      <SpeakerDiarization
        initialAudioBlob={audioBlob}
        initialAudioName={audioName}
        initialText={stateText || localStorage.getItem("current_editing_text") || undefined}
      />
    </div>
  );
};

export default Diarization;
