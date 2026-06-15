import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { setEncryptedKey } from "@/lib/keyCrypto";
import { debugLog } from "@/lib/debugLogger";

/**
 * Invisible component that syncs API keys from cloud to localStorage
 * on app load, so all transcription functions find keys immediately.
 * Keys are stored encrypted using AES-GCM (session-scoped key).
 */
const CloudKeySync = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const syncKeys = async () => {
      try {
        const { data } = await supabase
          .from('user_api_keys')
          .select('*')
          .eq('user_identifier', user.id)
          .maybeSingle();

        if (data) {
          if (data.openai_key) await setEncryptedKey('openai_api_key', data.openai_key);
          if (data.google_key) await setEncryptedKey('google_api_key', data.google_key);
          if (data.groq_key) await setEncryptedKey('groq_api_key', data.groq_key);
          if (data.claude_key) await setEncryptedKey('claude_api_key', data.claude_key);
          if (data.assemblyai_key) await setEncryptedKey('assemblyai_api_key', data.assemblyai_key);
          if (data.deepgram_key) await setEncryptedKey('deepgram_api_key', data.deepgram_key);

          // Additional keys
          if (data.huggingface_key) await setEncryptedKey('huggingface_api_key', data.huggingface_key);
          if (data.whisper_server_url) await setEncryptedKey('whisper_server_url', data.whisper_server_url);
          if (data.whisper_api_key) await setEncryptedKey('whisper_api_key', data.whisper_api_key);
          if (data.ollama_base_url) await setEncryptedKey('ollama_base_url', data.ollama_base_url);

          // Pool keys
          if (Array.isArray(data.openai_keys_pool) && data.openai_keys_pool.length) localStorage.setItem('openai_api_keys_pool', JSON.stringify(data.openai_keys_pool));
          if (Array.isArray(data.google_keys_pool) && data.google_keys_pool.length) localStorage.setItem('google_api_keys_pool', JSON.stringify(data.google_keys_pool));
          if (Array.isArray(data.groq_keys_pool) && data.groq_keys_pool.length) localStorage.setItem('groq_api_keys_pool', JSON.stringify(data.groq_keys_pool));
          if (Array.isArray(data.assemblyai_keys_pool) && data.assemblyai_keys_pool.length) localStorage.setItem('assemblyai_api_keys_pool', JSON.stringify(data.assemblyai_keys_pool));
          if (Array.isArray(data.deepgram_keys_pool) && data.deepgram_keys_pool.length) localStorage.setItem('deepgram_api_keys_pool', JSON.stringify(data.deepgram_keys_pool));

          debugLog.info('CloudKeySync', 'API keys synced from cloud (encrypted) ✓');
        }
      } catch (err) {
        console.error('[CloudKeySync] Error syncing keys:', err);
      }
    };

    syncKeys();
  }, [user]);

  return null;
};

export default CloudKeySync;
