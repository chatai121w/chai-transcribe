export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_key_usage_events: {
        Row: {
          created_at: string
          id: number
          key_fp: string
          provider: string
          seconds: number
          user_id: string
          words: number
        }
        Insert: {
          created_at?: string
          id?: number
          key_fp: string
          provider: string
          seconds?: number
          user_id: string
          words?: number
        }
        Update: {
          created_at?: string
          id?: number
          key_fp?: string
          provider?: string
          seconds?: number
          user_id?: string
          words?: number
        }
        Relationships: []
      }
      conversion_history: {
        Row: {
          created_at: string
          duration_ms: number | null
          file_name: string
          file_path: string | null
          file_size: number | null
          folder: string | null
          id: string
          original_name: string
          output_format: string
          output_size: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          folder?: string | null
          id?: string
          original_name: string
          output_format?: string
          output_size?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          folder?: string | null
          id?: string
          original_name?: string
          output_format?: string
          output_size?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      diarization_jobs: {
        Row: {
          created_at: string
          engine: string
          error_message: string | null
          external_job_id: string | null
          file_name: string | null
          file_path: string | null
          id: string
          language: string | null
          progress: number | null
          result: Json | null
          resume_data: Json | null
          speaker_roles: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          engine?: string
          error_message?: string | null
          external_job_id?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          language?: string | null
          progress?: number | null
          result?: Json | null
          resume_data?: Json | null
          speaker_roles?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          engine?: string
          error_message?: string | null
          external_job_id?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          language?: string | null
          progress?: number | null
          result?: Json | null
          resume_data?: Json | null
          speaker_roles?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      diarization_results: {
        Row: {
          created_at: string
          diarization_method: string | null
          duration: number
          engine: string | null
          file_name: string | null
          id: string
          processing_time: number | null
          segments: Json
          speaker_count: number
          speaker_names: Json
          speakers: Json
          transcript_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          diarization_method?: string | null
          duration?: number
          engine?: string | null
          file_name?: string | null
          id?: string
          processing_time?: number | null
          segments?: Json
          speaker_count?: number
          speaker_names?: Json
          speakers?: Json
          transcript_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          diarization_method?: string | null
          duration?: number
          engine?: string | null
          file_name?: string | null
          id?: string
          processing_time?: number | null
          segments?: Json
          speaker_count?: number
          speaker_names?: Json
          speakers?: Json
          transcript_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diarization_results_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_logs: {
        Row: {
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          file_name: string | null
          id: string
          result: string | null
          sql_content: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          file_name?: string | null
          id?: string
          result?: string | null
          sql_content: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          file_name?: string | null
          id?: string
          result?: string | null
          sql_content?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shared_transcripts: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          share_token: string
          transcript_id: string
          user_id: string
          view_count: number | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          share_token?: string
          transcript_id: string
          user_id: string
          view_count?: number | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          share_token?: string
          transcript_id?: string
          user_id?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_transcripts_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      system_secrets: {
        Row: {
          created_at: string | null
          key: string
          value: string
        }
        Insert: {
          created_at?: string | null
          key: string
          value: string
        }
        Update: {
          created_at?: string | null
          key?: string
          value?: string
        }
        Relationships: []
      }
      text_analysis_cache: {
        Row: {
          created_at: string
          duplicates: Json
          id: string
          results: Json
          text_hash: string
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          created_at?: string
          duplicates?: Json
          id?: string
          results?: Json
          text_hash: string
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          created_at?: string
          duplicates?: Json
          id?: string
          results?: Json
          text_hash?: string
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: []
      }
      transcript_versions: {
        Row: {
          action_label: string | null
          created_at: string
          engine_label: string | null
          id: string
          source: string
          text: string
          transcript_id: string
          user_id: string
          version_number: number
          word_count: number | null
        }
        Insert: {
          action_label?: string | null
          created_at?: string
          engine_label?: string | null
          id?: string
          source?: string
          text: string
          transcript_id: string
          user_id: string
          version_number?: number
          word_count?: number | null
        }
        Update: {
          action_label?: string | null
          created_at?: string
          engine_label?: string | null
          id?: string
          source?: string
          text?: string
          transcript_id?: string
          user_id?: string
          version_number?: number
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transcript_versions_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      transcription_jobs: {
        Row: {
          completed_chunks: number | null
          created_at: string
          engine: string
          error_message: string | null
          file_name: string | null
          file_path: string | null
          id: string
          language: string | null
          partial_result: string | null
          progress: number | null
          result_text: string | null
          status: string
          total_chunks: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_chunks?: number | null
          created_at?: string
          engine?: string
          error_message?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          language?: string | null
          partial_result?: string | null
          progress?: number | null
          result_text?: string | null
          status?: string
          total_chunks?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_chunks?: number | null
          created_at?: string
          engine?: string
          error_message?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          language?: string | null
          partial_result?: string | null
          progress?: number | null
          result_text?: string | null
          status?: string
          total_chunks?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          audio_file_path: string | null
          category: string | null
          created_at: string
          edited_text: string | null
          engine: string
          folder: string | null
          id: string
          is_favorite: boolean | null
          notes: string | null
          tags: string[] | null
          text: string
          title: string | null
          updated_at: string
          user_id: string
          word_timings: Json | null
        }
        Insert: {
          audio_file_path?: string | null
          category?: string | null
          created_at?: string
          edited_text?: string | null
          engine?: string
          folder?: string | null
          id?: string
          is_favorite?: boolean | null
          notes?: string | null
          tags?: string[] | null
          text: string
          title?: string | null
          updated_at?: string
          user_id: string
          word_timings?: Json | null
        }
        Update: {
          audio_file_path?: string | null
          category?: string | null
          created_at?: string
          edited_text?: string | null
          engine?: string
          folder?: string | null
          id?: string
          is_favorite?: boolean | null
          notes?: string | null
          tags?: string[] | null
          text?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          word_timings?: Json | null
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          assemblyai_key: string | null
          assemblyai_keys_pool: Json | null
          claude_key: string | null
          created_at: string
          deepgram_key: string | null
          deepgram_keys_pool: Json | null
          google_key: string | null
          google_keys_pool: Json | null
          groq_key: string | null
          groq_keys_pool: Json | null
          huggingface_key: string | null
          id: string
          ollama_base_url: string | null
          openai_key: string | null
          openai_keys_pool: Json | null
          updated_at: string
          user_identifier: string
          whisper_api_key: string | null
          whisper_server_url: string | null
        }
        Insert: {
          assemblyai_key?: string | null
          assemblyai_keys_pool?: Json | null
          claude_key?: string | null
          created_at?: string
          deepgram_key?: string | null
          deepgram_keys_pool?: Json | null
          google_key?: string | null
          google_keys_pool?: Json | null
          groq_key?: string | null
          groq_keys_pool?: Json | null
          huggingface_key?: string | null
          id?: string
          ollama_base_url?: string | null
          openai_key?: string | null
          openai_keys_pool?: Json | null
          updated_at?: string
          user_identifier: string
          whisper_api_key?: string | null
          whisper_server_url?: string | null
        }
        Update: {
          assemblyai_key?: string | null
          assemblyai_keys_pool?: Json | null
          claude_key?: string | null
          created_at?: string
          deepgram_key?: string | null
          deepgram_keys_pool?: Json | null
          google_key?: string | null
          google_keys_pool?: Json | null
          groq_key?: string | null
          groq_keys_pool?: Json | null
          huggingface_key?: string | null
          id?: string
          ollama_base_url?: string | null
          openai_key?: string | null
          openai_keys_pool?: Json | null
          updated_at?: string
          user_identifier?: string
          whisper_api_key?: string | null
          whisper_server_url?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          active_pronunciation_profile: string
          compare_settings_json: Json | null
          created_at: string
          cuda_beam_size: number | null
          cuda_cloud_save: string | null
          cuda_compute_type: string | null
          cuda_fast_mode: boolean | null
          cuda_hotwords: string | null
          cuda_no_condition_prev: boolean | null
          cuda_paragraph_threshold: number | null
          cuda_preload_mode: string | null
          cuda_preset: string | null
          cuda_vad_aggressive: boolean | null
          custom_themes: Json | null
          dashboard_view_mode: string | null
          default_ai_model: string | null
          diarize_enabled: boolean
          draft_text: string | null
          editor_columns: number | null
          engine: string | null
          folder_sort_asc: boolean | null
          folder_sort_key: string | null
          folder_view_mode: string | null
          font_family: string | null
          font_size: number | null
          id: string
          line_height: number | null
          loshon_kodesh_enabled: boolean
          personal_pronunciation_enabled: boolean
          player_layout: string | null
          sidebar_pinned: boolean | null
          source_language: string | null
          tab_settings_json: Json | null
          text_color: string | null
          theme: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_pronunciation_profile?: string
          compare_settings_json?: Json | null
          created_at?: string
          cuda_beam_size?: number | null
          cuda_cloud_save?: string | null
          cuda_compute_type?: string | null
          cuda_fast_mode?: boolean | null
          cuda_hotwords?: string | null
          cuda_no_condition_prev?: boolean | null
          cuda_paragraph_threshold?: number | null
          cuda_preload_mode?: string | null
          cuda_preset?: string | null
          cuda_vad_aggressive?: boolean | null
          custom_themes?: Json | null
          dashboard_view_mode?: string | null
          default_ai_model?: string | null
          diarize_enabled?: boolean
          draft_text?: string | null
          editor_columns?: number | null
          engine?: string | null
          folder_sort_asc?: boolean | null
          folder_sort_key?: string | null
          folder_view_mode?: string | null
          font_family?: string | null
          font_size?: number | null
          id?: string
          line_height?: number | null
          loshon_kodesh_enabled?: boolean
          personal_pronunciation_enabled?: boolean
          player_layout?: string | null
          sidebar_pinned?: boolean | null
          source_language?: string | null
          tab_settings_json?: Json | null
          text_color?: string | null
          theme?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_pronunciation_profile?: string
          compare_settings_json?: Json | null
          created_at?: string
          cuda_beam_size?: number | null
          cuda_cloud_save?: string | null
          cuda_compute_type?: string | null
          cuda_fast_mode?: boolean | null
          cuda_hotwords?: string | null
          cuda_no_condition_prev?: boolean | null
          cuda_paragraph_threshold?: number | null
          cuda_preload_mode?: string | null
          cuda_preset?: string | null
          cuda_vad_aggressive?: boolean | null
          custom_themes?: Json | null
          dashboard_view_mode?: string | null
          default_ai_model?: string | null
          diarize_enabled?: boolean
          draft_text?: string | null
          editor_columns?: number | null
          engine?: string | null
          folder_sort_asc?: boolean | null
          folder_sort_key?: string | null
          folder_view_mode?: string | null
          font_family?: string | null
          font_size?: number | null
          id?: string
          line_height?: number | null
          loshon_kodesh_enabled?: boolean
          personal_pronunciation_enabled?: boolean
          player_layout?: string | null
          sidebar_pinned?: boolean | null
          source_language?: string | null
          tab_settings_json?: Json | null
          text_color?: string | null
          theme?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      youtube_jobs: {
        Row: {
          backend: string | null
          completed_at: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error: string | null
          id: string
          job_kind: string
          last_error: string | null
          mode: string
          output_files: Json
          overall_percent: number
          progress_pct: number
          resume_token: Json | null
          stages: Json
          status: string
          thumbnail_url: string | null
          title: string | null
          transcript_id: string | null
          updated_at: string
          url: string
          user_id: string
          video_title: string | null
        }
        Insert: {
          backend?: string | null
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          duration_sec?: number | null
          error?: string | null
          id?: string
          job_kind?: string
          last_error?: string | null
          mode?: string
          output_files?: Json
          overall_percent?: number
          progress_pct?: number
          resume_token?: Json | null
          stages?: Json
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          transcript_id?: string | null
          updated_at?: string
          url: string
          user_id: string
          video_title?: string | null
        }
        Update: {
          backend?: string | null
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          duration_sec?: number | null
          error?: string | null
          id?: string
          job_kind?: string
          last_error?: string | null
          mode?: string
          output_files?: Json
          overall_percent?: number
          progress_pct?: number
          resume_token?: Json | null
          stages?: Json
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          transcript_id?: string | null
          updated_at?: string
          url?: string
          user_id?: string
          video_title?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deploy_edge_fn: {
        Args: { p_slug: string; p_source_code: string }
        Returns: Json
      }
      edit_transcript_proxy: {
        Args: {
          p_action: string
          p_custom_prompt?: string
          p_model?: string
          p_target_language?: string
          p_text: string
          p_tone_style?: string
        }
        Returns: Json
      }
      exec_sql: { Args: { query: string }; Returns: Json }
      exec_sql_return: { Args: { query: string }; Returns: Json }
      execute_sql_admin: { Args: { sql_text: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
