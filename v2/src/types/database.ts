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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          booked_by: string
          booker_line_user_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          date: string
          id: string
          member_id: string | null
          name: string
          name2: string | null
          notify_line_user_id: string | null
          phone: string
          remark: string | null
          reminded_at: string | null
          seats: number
          start_time: string
          status: string
          store_id: string
          type: string
          updated_at: string
        }
        Insert: {
          booked_by?: string
          booker_line_user_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          date: string
          id?: string
          member_id?: string | null
          name: string
          name2?: string | null
          notify_line_user_id?: string | null
          phone: string
          remark?: string | null
          reminded_at?: string | null
          seats?: number
          start_time: string
          status?: string
          store_id: string
          type: string
          updated_at?: string
        }
        Update: {
          booked_by?: string
          booker_line_user_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          date?: string
          id?: string
          member_id?: string | null
          name?: string
          name2?: string | null
          notify_line_user_id?: string | null
          phone?: string
          remark?: string | null
          reminded_at?: string | null
          seats?: number
          start_time?: string
          status?: string
          store_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_batches: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          item_id: string
          note: string
          qty: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          item_id: string
          note?: string
          qty?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          item_id?: string
          note?: string
          qty?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_batches_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_batches_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          active: boolean
          category: string | null
          code: string
          created_at: string
          id: string
          member_price: number
          name: string
          note: string
          pv: number
          safety_stock: number | null
          sort_order: number | null
          store_id: string
          type: string
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          member_price?: number
          name: string
          note?: string
          pv?: number
          safety_stock?: number | null
          sort_order?: number | null
          store_id: string
          type: string
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          member_price?: number
          name?: string
          note?: string
          pv?: number
          safety_stock?: number | null
          sort_order?: number | null
          store_id?: string
          type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_series: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          store_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          store_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          store_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_series_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stocktakes: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          item_count: number
          items: Json
          store_id: string
          total_diff: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          item_count: number
          items: Json
          store_id: string
          total_diff: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          item_count?: number
          items?: Json
          store_id?: string
          total_diff?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stocktakes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          birthday: string | null
          created_at: string
          guardian_id: string | null
          id: string
          line_name: string | null
          line_user_id: string | null
          name: string
          note: string | null
          phone: string
          referrer: string | null
          role: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          guardian_id?: string | null
          id?: string
          line_name?: string | null
          line_user_id?: string | null
          name: string
          note?: string | null
          phone: string
          referrer?: string | null
          role?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          guardian_id?: string | null
          id?: string
          line_name?: string | null
          line_user_id?: string | null
          name?: string
          note?: string | null
          phone?: string
          referrer?: string | null
          role?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_days: {
        Row: {
          blocked_times: string[]
          date: string
          is_operating: boolean
          store_id: string
        }
        Insert: {
          blocked_times?: string[]
          date: string
          is_operating?: boolean
          store_id: string
        }
        Update: {
          blocked_times?: string[]
          date?: string
          is_operating?: boolean
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_days_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_admins: {
        Row: {
          created_at: string
          role: string
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_admins_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          business_hours: Json
          created_at: string
          id: string
          line_group_id: string | null
          name: string
          reminder_enabled: boolean
          reminder_time: string
          slug: string
          theme_bg: string | null
          theme_border: string | null
          theme_btn_border: string | null
          theme_btn2: string | null
          theme_btn2_border: string | null
          theme_btn2_ink: string | null
          theme_card: string | null
          theme_ink: string | null
          theme_ink_soft: string | null
          theme_primary: string | null
          theme_tabs: string | null
          timezone: string
        }
        Insert: {
          business_hours?: Json
          created_at?: string
          id?: string
          line_group_id?: string | null
          name: string
          reminder_enabled?: boolean
          reminder_time?: string
          slug: string
          theme_bg?: string | null
          theme_border?: string | null
          theme_btn_border?: string | null
          theme_btn2?: string | null
          theme_btn2_border?: string | null
          theme_btn2_ink?: string | null
          theme_card?: string | null
          theme_ink?: string | null
          theme_ink_soft?: string | null
          theme_primary?: string | null
          theme_tabs?: string | null
          timezone?: string
        }
        Update: {
          business_hours?: Json
          created_at?: string
          id?: string
          line_group_id?: string | null
          name?: string
          reminder_enabled?: boolean
          reminder_time?: string
          slug?: string
          theme_bg?: string | null
          theme_border?: string | null
          theme_btn_border?: string | null
          theme_btn2?: string | null
          theme_btn2_border?: string | null
          theme_btn2_ink?: string | null
          theme_card?: string | null
          theme_ink?: string | null
          theme_ink_soft?: string | null
          theme_primary?: string | null
          theme_tabs?: string | null
          timezone?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_store_admin: {
        Args: { p_email: string; p_role?: string; p_store_id: string }
        Returns: string
      }
      is_store_admin: { Args: { p_store_id: string }; Returns: boolean }
      is_store_owner: { Args: { p_store_id: string }; Returns: boolean }
      list_store_admins: {
        Args: { p_store_id: string }
        Returns: {
          created_at: string
          email: string
          role: string
          user_id: string
        }[]
      }
      remove_store_admin: {
        Args: { p_store_id: string; p_user_id: string }
        Returns: undefined
      }
      submit_stocktake: {
        Args: { p_date: string; p_items: Json; p_store_id: string }
        Returns: string
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
