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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      deal_metrics: {
        Row: {
          asking_price_php: number | null
          below_market_pct: number | null
          comp_p25: number | null
          comp_p50: number | null
          comp_p75: number | null
          comp_region_code: string | null
          comp_sample_size: number
          computed_at: string
          confidence: string
          deal_score: string
          est_profit_php: number | null
          listing_id: string
          reasons: Json
        }
        Insert: {
          asking_price_php?: number | null
          below_market_pct?: number | null
          comp_p25?: number | null
          comp_p50?: number | null
          comp_p75?: number | null
          comp_region_code?: string | null
          comp_sample_size?: number
          computed_at?: string
          confidence?: string
          deal_score?: string
          est_profit_php?: number | null
          listing_id: string
          reasons?: Json
        }
        Update: {
          asking_price_php?: number | null
          below_market_pct?: number | null
          comp_p25?: number | null
          comp_p50?: number | null
          comp_p75?: number | null
          comp_region_code?: string | null
          comp_sample_size?: number
          computed_at?: string
          confidence?: string
          deal_score?: string
          est_profit_php?: number | null
          listing_id?: string
          reasons?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deal_metrics_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      listing_features: {
        Row: {
          battery_health: number | null
          condition_text: string | null
          listing_id: string
          model_family: string
          openline: boolean | null
          region_code: string | null
          risk_flags: Json
          storage_gb: number | null
          updated_at: string
          variant: string
        }
        Insert: {
          battery_health?: number | null
          condition_text?: string | null
          listing_id: string
          model_family: string
          openline?: boolean | null
          region_code?: string | null
          risk_flags?: Json
          storage_gb?: number | null
          updated_at?: string
          variant: string
        }
        Update: {
          battery_health?: number | null
          condition_text?: string | null
          listing_id?: string
          model_family?: string
          openline?: boolean | null
          region_code?: string | null
          risk_flags?: Json
          storage_gb?: number | null
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_features_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      listing_versions: {
        Row: {
          changed_fields: Json
          description: string | null
          id: number
          listing_id: number
          posted_at: string | null
          price_php: number | null
          price_raw: string | null
          snapshot_at: string
          status: string | null
          title: string | null
        }
        Insert: {
          changed_fields?: Json
          description?: string | null
          id?: number
          listing_id: number
          posted_at?: string | null
          price_php?: number | null
          price_raw?: string | null
          snapshot_at?: string
          status?: string | null
          title?: string | null
        }
        Update: {
          changed_fields?: Json
          description?: string | null
          id?: number
          listing_id?: number
          posted_at?: string | null
          price_php?: number | null
          price_raw?: string | null
          snapshot_at?: string
          status?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_versions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          condition_raw: string | null
          created_at: string
          description: string | null
          first_seen_at: string
          id: number
          last_price_change_at: string | null
          last_seen_at: string
          listing_id: string
          location_raw: string | null
          posted_at: string | null
          price_php: number | null
          price_raw: string | null
          status: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          condition_raw?: string | null
          created_at?: string
          description?: string | null
          first_seen_at?: string
          id?: number
          last_price_change_at?: string | null
          last_seen_at?: string
          listing_id: string
          location_raw?: string | null
          posted_at?: string | null
          price_php?: number | null
          price_raw?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          condition_raw?: string | null
          created_at?: string
          description?: string | null
          first_seen_at?: string
          id?: number
          last_price_change_at?: string | null
          last_seen_at?: string
          listing_id?: string
          location_raw?: string | null
          posted_at?: string | null
          price_php?: number | null
          price_raw?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          url?: string
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
    Enums: {},
  },
} as const
