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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      library_revision: {
        Row: {
          id: boolean
          updated_at: string
          version: number
        }
        Insert: {
          id?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          id?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      play_bests: {
        Row: {
          best_accuracy: number
          best_combo: number
          best_progress: number
          best_score: number
          completed: boolean
          difficulty: string
          full_combo: boolean
          player_name: string | null
          plays: number
          song_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          best_accuracy?: number
          best_combo?: number
          best_progress?: number
          best_score?: number
          completed?: boolean
          difficulty: string
          full_combo?: boolean
          player_name?: string | null
          plays?: number
          song_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          best_accuracy?: number
          best_combo?: number
          best_progress?: number
          best_score?: number
          completed?: boolean
          difficulty?: string
          full_combo?: boolean
          player_name?: string | null
          plays?: number
          song_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      play_records: {
        Row: {
          accuracy: number
          completed: boolean
          difficulty: string
          full_combo: boolean
          id: string
          max_combo: number
          notes: number
          played_at: string
          progress: number
          score: number
          song_id: string
          speed: number
          title: string
          user_id: string
        }
        Insert: {
          accuracy?: number
          completed?: boolean
          difficulty: string
          full_combo?: boolean
          id?: string
          max_combo?: number
          notes?: number
          played_at?: string
          progress?: number
          score?: number
          song_id: string
          speed?: number
          title?: string
          user_id: string
        }
        Update: {
          accuracy?: number
          completed?: boolean
          difficulty?: string
          full_combo?: boolean
          id?: string
          max_combo?: number
          notes?: number
          played_at?: string
          progress?: number
          score?: number
          song_id?: string
          speed?: number
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      song_charts: {
        Row: {
          chart: Json
          created_at: string
          difficulty: string
          id: string
          midi_fingerprint: string
          song_id: string
        }
        Insert: {
          chart: Json
          created_at?: string
          difficulty: string
          id?: string
          midi_fingerprint: string
          song_id: string
        }
        Update: {
          chart?: Json
          created_at?: string
          difficulty?: string
          id?: string
          midi_fingerprint?: string
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "song_charts_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      song_favorites: {
        Row: {
          created_at: string
          song_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          song_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          song_id?: string
          user_id?: string
        }
        Relationships: []
      }
      song_tag_links: {
        Row: {
          song_id: string
          tag_id: string
        }
        Insert: {
          song_id: string
          tag_id: string
        }
        Update: {
          song_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "song_tag_links_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "song_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      song_tags: {
        Row: {
          background_path: string | null
          created_at: string
          id: string
          name: string
          name_en: string | null
          sort_order: number
        }
        Insert: {
          background_path?: string | null
          created_at?: string
          id?: string
          name: string
          name_en?: string | null
          sort_order?: number
        }
        Update: {
          background_path?: string | null
          created_at?: string
          id?: string
          name?: string
          name_en?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      songs: {
        Row: {
          artist: string | null
          bass_path: string | null
          bpm: number
          created_at: string
          drums_path: string | null
          duration_ms: number
          id: string
          midi_fingerprint: string
          midi_path: string
          other_path: string | null
          published: boolean
          sizes: Json
          sort_order: number
          title: string
          ts_den: number
          ts_num: number
          vocals_path: string | null
        }
        Insert: {
          artist?: string | null
          bass_path?: string | null
          bpm?: number
          created_at?: string
          drums_path?: string | null
          duration_ms?: number
          id?: string
          midi_fingerprint?: string
          midi_path: string
          other_path?: string | null
          published?: boolean
          sizes?: Json
          sort_order?: number
          title: string
          ts_den?: number
          ts_num?: number
          vocals_path?: string | null
        }
        Update: {
          artist?: string | null
          bass_path?: string | null
          bpm?: number
          created_at?: string
          drums_path?: string | null
          duration_ms?: number
          id?: string
          midi_fingerprint?: string
          midi_path?: string
          other_path?: string | null
          published?: boolean
          sizes?: Json
          sort_order?: number
          title?: string
          ts_den?: number
          ts_num?: number
          vocals_path?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
