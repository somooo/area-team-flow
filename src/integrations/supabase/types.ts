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
      assignment_codes: {
        Row: {
          area: string
          code: string
          created_at: string
          duty: Database["public"]["Enums"]["duty_type"]
          id: string
          layer: string
          sort_order: number
          unit: string | null
          unit_code: string | null
          updated_at: string
        }
        Insert: {
          area: string
          code: string
          created_at?: string
          duty?: Database["public"]["Enums"]["duty_type"]
          id?: string
          layer?: string
          sort_order?: number
          unit?: string | null
          unit_code?: string | null
          updated_at?: string
        }
        Update: {
          area?: string
          code?: string
          created_at?: string
          duty?: Database["public"]["Enums"]["duty_type"]
          id?: string
          layer?: string
          sort_order?: number
          unit?: string | null
          unit_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_role: string | null
          area: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_role?: string | null
          area?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_role?: string | null
          area?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      badge_signin_attempts: {
        Row: {
          badge_id: string
          created_at: string
          id: string
          succeeded: boolean
        }
        Insert: {
          badge_id: string
          created_at?: string
          id?: string
          succeeded: boolean
        }
        Update: {
          badge_id?: string
          created_at?: string
          id?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          approver_email: string | null
          area: string
          auto_approve_at: string | null
          covering_supervisor_email: string | null
          created_at: string
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason: string | null
          staff_email: string
          staff_id: string | null
          staff_name: string
          stage: string | null
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
        }
        Insert: {
          approver_email?: string | null
          area: string
          auto_approve_at?: string | null
          covering_supervisor_email?: string | null
          created_at?: string
          end_date: string
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          staff_email: string
          staff_id?: string | null
          staff_name: string
          stage?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Update: {
          approver_email?: string | null
          area?: string
          auto_approve_at?: string | null
          covering_supervisor_email?: string | null
          created_at?: string
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          staff_email?: string
          staff_id?: string | null
          staff_name?: string
          stage?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          recipient_staff_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_staff_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_staff_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_staff_id_fkey"
            columns: ["recipient_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      preschedule_requests: {
        Row: {
          approver_email: string | null
          area: string
          auto_approve_at: string | null
          contacted_by: string | null
          created_at: string
          details: string | null
          id: string
          missed_ot_date: string | null
          request_type: string
          requested_dates: string[]
          requester_email: string
          requester_name: string
          staff_id: string | null
          status: string
          swap_with_email: string | null
          swap_with_name: string | null
          target_month: string
          unit_code: string | null
          updated_at: string
        }
        Insert: {
          approver_email?: string | null
          area: string
          auto_approve_at?: string | null
          contacted_by?: string | null
          created_at?: string
          details?: string | null
          id?: string
          missed_ot_date?: string | null
          request_type: string
          requested_dates?: string[]
          requester_email: string
          requester_name: string
          staff_id?: string | null
          status?: string
          swap_with_email?: string | null
          swap_with_name?: string | null
          target_month: string
          unit_code?: string | null
          updated_at?: string
        }
        Update: {
          approver_email?: string | null
          area?: string
          auto_approve_at?: string | null
          contacted_by?: string | null
          created_at?: string
          details?: string | null
          id?: string
          missed_ot_date?: string | null
          request_type?: string
          requested_dates?: string[]
          requester_email?: string
          requester_name?: string
          staff_id?: string | null
          status?: string
          swap_with_email?: string | null
          swap_with_name?: string | null
          target_month?: string
          unit_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preschedule_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_change_requests: {
        Row: {
          approver_email: string | null
          area: string
          auto_approve_at: string | null
          change_type: Database["public"]["Enums"]["change_type"]
          created_at: string
          details: string | null
          id: string
          requester_email: string
          requester_name: string
          requester_staff_id: string | null
          source_shift_id: string
          staff_response: Database["public"]["Enums"]["staff_response"]
          status: Database["public"]["Enums"]["change_status"]
          supervisor_response: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id: string | null
          target_staff_email: string
          target_staff_id: string | null
          target_staff_name: string
        }
        Insert: {
          approver_email?: string | null
          area: string
          auto_approve_at?: string | null
          change_type: Database["public"]["Enums"]["change_type"]
          created_at?: string
          details?: string | null
          id?: string
          requester_email: string
          requester_name: string
          requester_staff_id?: string | null
          source_shift_id: string
          staff_response?: Database["public"]["Enums"]["staff_response"]
          status?: Database["public"]["Enums"]["change_status"]
          supervisor_response?: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id?: string | null
          target_staff_email: string
          target_staff_id?: string | null
          target_staff_name: string
        }
        Update: {
          approver_email?: string | null
          area?: string
          auto_approve_at?: string | null
          change_type?: Database["public"]["Enums"]["change_type"]
          created_at?: string
          details?: string | null
          id?: string
          requester_email?: string
          requester_name?: string
          requester_staff_id?: string | null
          source_shift_id?: string
          staff_response?: Database["public"]["Enums"]["staff_response"]
          status?: Database["public"]["Enums"]["change_status"]
          supervisor_response?: Database["public"]["Enums"]["supervisor_response"]
          target_shift_id?: string | null
          target_staff_email?: string
          target_staff_id?: string | null
          target_staff_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_change_requests_requester_staff_id_fkey"
            columns: ["requester_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_requests_target_staff_id_fkey"
            columns: ["target_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
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
          origin: string
          origin_request_id: string | null
          ot_type: Database["public"]["Enums"]["ot_type"]
          prev_duty: Database["public"]["Enums"]["duty_type"] | null
          prev_hours: number | null
          prev_is_overtime: boolean | null
          prev_ot_type: Database["public"]["Enums"]["ot_type"] | null
          prev_shift_type: Database["public"]["Enums"]["shift_type"] | null
          prev_unit_code: string | null
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_email: string
          staff_id: string | null
          staff_name: string
          switched_with_name: string | null
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
          origin?: string
          origin_request_id?: string | null
          ot_type?: Database["public"]["Enums"]["ot_type"]
          prev_duty?: Database["public"]["Enums"]["duty_type"] | null
          prev_hours?: number | null
          prev_is_overtime?: boolean | null
          prev_ot_type?: Database["public"]["Enums"]["ot_type"] | null
          prev_shift_type?: Database["public"]["Enums"]["shift_type"] | null
          prev_unit_code?: string | null
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_email: string
          staff_id?: string | null
          staff_name: string
          switched_with_name?: string | null
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
          origin?: string
          origin_request_id?: string | null
          ot_type?: Database["public"]["Enums"]["ot_type"]
          prev_duty?: Database["public"]["Enums"]["duty_type"] | null
          prev_hours?: number | null
          prev_is_overtime?: boolean | null
          prev_ot_type?: Database["public"]["Enums"]["ot_type"] | null
          prev_shift_type?: Database["public"]["Enums"]["shift_type"] | null
          prev_unit_code?: string | null
          shift_type?: Database["public"]["Enums"]["shift_type"]
          staff_email?: string
          staff_id?: string | null
          staff_name?: string
          switched_with_name?: string | null
          unit_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          area: string | null
          badge_id: string | null
          created_at: string
          delegated_to_email: string | null
          delegation_active: boolean
          department: string | null
          email: string
          id: string
          name: string
          password_hash: string | null
          role: Database["public"]["Enums"]["app_role"]
          supervisor_email: string | null
        }
        Insert: {
          area?: string | null
          badge_id?: string | null
          created_at?: string
          delegated_to_email?: string | null
          delegation_active?: boolean
          department?: string | null
          email: string
          id?: string
          name: string
          password_hash?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          supervisor_email?: string | null
        }
        Update: {
          area?: string | null
          badge_id?: string | null
          created_at?: string
          delegated_to_email?: string | null
          delegation_active?: boolean
          department?: string | null
          email?: string
          id?: string
          name?: string
          password_hash?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          supervisor_email?: string | null
        }
        Relationships: []
      }
      system_rules: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      team_leader_reports: {
        Row: {
          approver_email: string | null
          area: string
          assignment_code: string | null
          comment: string | null
          created_at: string
          id: string
          layer: string
          reporter_email: string
          reporter_name: string
          shift_date: string
          sick_calls: Json
          status: string
          updated_at: string
        }
        Insert: {
          approver_email?: string | null
          area: string
          assignment_code?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          layer?: string
          reporter_email: string
          reporter_name: string
          shift_date: string
          sick_calls?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          approver_email?: string | null
          area?: string
          assignment_code?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          layer?: string
          reporter_email?: string
          reporter_name?: string
          shift_date?: string
          sick_calls?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      zone_reference: {
        Row: {
          area: string
          assignment_no: string | null
          coverage_weekday: string | null
          coverage_weekend: string | null
          created_at: string
          extension: string | null
          id: string
          label: string | null
          pager: string | null
          role: string | null
          sort_order: number
          unit: string | null
          updated_at: string
          zone: string | null
        }
        Insert: {
          area: string
          assignment_no?: string | null
          coverage_weekday?: string | null
          coverage_weekend?: string | null
          created_at?: string
          extension?: string | null
          id?: string
          label?: string | null
          pager?: string | null
          role?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          zone?: string | null
        }
        Update: {
          area?: string
          assignment_no?: string | null
          coverage_weekday?: string | null
          coverage_weekend?: string | null
          created_at?: string
          extension?: string | null
          id?: string
          label?: string | null
          pager?: string | null
          role?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          zone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_absence_to_shifts: {
        Args: {
          _area: string
          _dates: string[]
          _duty: Database["public"]["Enums"]["duty_type"]
          _email: string
          _name: string
          _origin: string
          _req: string
        }
        Returns: undefined
      }
      current_email: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_area_manager_of: { Args: { _area: string }; Returns: boolean }
      is_supervisor_of: { Args: { _area: string }; Returns: boolean }
      my_area: { Args: never; Returns: string }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] }
      revert_request_shifts: {
        Args: { _origin: string; _req: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "staff" | "supervisor" | "admin" | "team_leader"
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
      app_role: ["staff", "supervisor", "admin", "team_leader"],
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
