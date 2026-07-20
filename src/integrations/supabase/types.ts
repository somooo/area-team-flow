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
      leave_requests: {
        Row: {
          approver_email: string | null
          area: string
          created_at: string
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason: string | null
          staff_email: string
          staff_name: string
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
        }
        Insert: {
          approver_email?: string | null
          area: string
          created_at?: string
          end_date: string
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          staff_email: string
          staff_name: string
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Update: {
          approver_email?: string | null
          area?: string
          created_at?: string
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          staff_email?: string
          staff_name?: string
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Relationships: []
      }
      schedule_change_requests: {
        Row: {
          approver_email: string | null
          area: string
          change_type: Database["public"]["Enums"]["change_type"]
          created_at: string
          details: string | null
          id: string
          requester_email: string
          requester_name: string
          source_shift_id: string
          staff_response: Database["public"]["Enums"]["staff_response"]
          status: Database["public"]["Enums"]["change_status"]
          supervisor_response: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id: string | null
          target_staff_email: string
          target_staff_name: string
        }
        Insert: {
          approver_email?: string | null
          area: string
          change_type: Database["public"]["Enums"]["change_type"]
          created_at?: string
          details?: string | null
          id?: string
          requester_email: string
          requester_name: string
          source_shift_id: string
          staff_response?: Database["public"]["Enums"]["staff_response"]
          status?: Database["public"]["Enums"]["change_status"]
          supervisor_response?: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id?: string | null
          target_staff_email: string
          target_staff_name: string
        }
        Update: {
          approver_email?: string | null
          area?: string
          change_type?: Database["public"]["Enums"]["change_type"]
          created_at?: string
          details?: string | null
          id?: string
          requester_email?: string
          requester_name?: string
          source_shift_id?: string
          staff_response?: Database["public"]["Enums"]["staff_response"]
          status?: Database["public"]["Enums"]["change_status"]
          supervisor_response?: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id?: string | null
          target_staff_email?: string
          target_staff_name?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          area: string
          created_at: string
          date: string
          duty: Database["public"]["Enums"]["duty_type"]
          hours: number
          id: string
          is_overtime: boolean
          notes: string | null
          ot_type: Database["public"]["Enums"]["ot_type"]
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_email: string
          staff_name: string
          unit_code: string | null
        }
        Insert: {
          area: string
          created_at?: string
          date: string
          duty?: Database["public"]["Enums"]["duty_type"]
          hours?: number
          id?: string
          is_overtime?: boolean
          notes?: string | null
          ot_type?: Database["public"]["Enums"]["ot_type"]
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_email: string
          staff_name: string
          unit_code?: string | null
        }
        Update: {
          area?: string
          created_at?: string
          date?: string
          duty?: Database["public"]["Enums"]["duty_type"]
          hours?: number
          id?: string
          is_overtime?: boolean
          notes?: string | null
          ot_type?: Database["public"]["Enums"]["ot_type"]
          shift_type?: Database["public"]["Enums"]["shift_type"]
          staff_email?: string
          staff_name?: string
          unit_code?: string | null
        }
        Relationships: []
      }
      staff: {
        Row: {
          area: string | null
          created_at: string
          delegated_to_email: string | null
          delegation_active: boolean
          department: string | null
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
          supervisor_email: string | null
        }
        Insert: {
          area?: string | null
          created_at?: string
          delegated_to_email?: string | null
          delegation_active?: boolean
          department?: string | null
          email: string
          id?: string
          name: string
          role?: Database["public"]["Enums"]["app_role"]
          supervisor_email?: string | null
        }
        Update: {
          area?: string | null
          created_at?: string
          delegated_to_email?: string | null
          delegation_active?: boolean
          department?: string | null
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["app_role"]
          supervisor_email?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_email: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_supervisor_of: { Args: { _area: string }; Returns: boolean }
      my_area: { Args: never; Returns: string }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] }
    }
    Enums: {
      app_role: "staff" | "supervisor" | "admin"
      change_status:
        | "Pending Staff"
        | "Pending Supervisor"
        | "Approved"
        | "Rejected"
      change_type: "give_ot" | "switch_area" | "switch_date"
      duty_type: "Day" | "Night" | "Off" | "Vacation" | "Sick" | "Paternity"
      leave_status: "Pending" | "Approved" | "Rejected"
      leave_type: "Vacation" | "Sick"
      ot_type: "None" | "BuiltIn" | "Additional" | "MedEvac"
      shift_type: "Morning" | "Evening" | "Night" | "Off"
      staff_response: "Pending" | "Accepted" | "Declined"
      supervisor_response: "Pending" | "Approved" | "Rejected"
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
      app_role: ["staff", "supervisor", "admin"],
      change_status: [
        "Pending Staff",
        "Pending Supervisor",
        "Approved",
        "Rejected",
      ],
      change_type: ["give_ot", "switch_area", "switch_date"],
      duty_type: ["Day", "Night", "Off", "Vacation", "Sick", "Paternity"],
      leave_status: ["Pending", "Approved", "Rejected"],
      leave_type: ["Vacation", "Sick"],
      ot_type: ["None", "BuiltIn", "Additional", "MedEvac"],
      shift_type: ["Morning", "Evening", "Night", "Off"],
      staff_response: ["Pending", "Accepted", "Declined"],
      supervisor_response: ["Pending", "Approved", "Rejected"],
    },
  },
} as const
