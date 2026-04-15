export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          created_at: string
          last_active: string | null
          preferences: Json
        }
        Insert: {
          id: string
          email?: string | null
          created_at?: string
          last_active?: string | null
          preferences?: Json
        }
        Update: {
          email?: string | null
          created_at?: string
          last_active?: string | null
          preferences?: Json
        }
      }
      chat_sessions: {
        Row: {
          id: string
          user_id: string | null
          client_id: string | null
          session_title: string | null
          created_at: string
          last_message_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          client_id?: string | null
          session_title?: string | null
          created_at?: string
          last_message_at?: string | null
        }
        Update: {
          user_id?: string | null
          client_id?: string | null
          session_title?: string | null
          created_at?: string
          last_message_at?: string | null
        }
      }
      chat_messages: {
        Row: {
          id: string
          session_id: string
          role: "user" | "assistant" | "system"
          content: string
          tool_calls: Json | null
          citations: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          role: "user" | "assistant" | "system"
          content: string
          tool_calls?: Json | null
          citations?: Json | null
          created_at?: string
        }
        Update: {
          session_id?: string
          role?: "user" | "assistant" | "system"
          content?: string
          tool_calls?: Json | null
          citations?: Json | null
          created_at?: string
        }
      }
      predictions_cache: {
        Row: {
          id: string
          latitude: number
          longitude: number
          depth_m: number
          pga_g: number
          vs_predicted: number | null
          vs_p10: number | null
          vs_p90: number | null
          sand_pct: number | null
          silt_pct: number | null
          clay_pct: number | null
          bulk_density: number | null
          water_content: number | null
          site_class: string | null
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          latitude: number
          longitude: number
          depth_m: number
          pga_g: number
          vs_predicted?: number | null
          vs_p10?: number | null
          vs_p90?: number | null
          sand_pct?: number | null
          silt_pct?: number | null
          clay_pct?: number | null
          bulk_density?: number | null
          water_content?: number | null
          site_class?: string | null
          created_at?: string
          expires_at?: string
        }
        Update: {
          latitude?: number
          longitude?: number
          depth_m?: number
          pga_g?: number
          vs_predicted?: number | null
          vs_p10?: number | null
          vs_p90?: number | null
          sand_pct?: number | null
          silt_pct?: number | null
          clay_pct?: number | null
          bulk_density?: number | null
          water_content?: number | null
          site_class?: string | null
          created_at?: string
          expires_at?: string
        }
      }
      reports: {
        Row: {
          id: string
          user_id: string | null
          client_id: string | null
          report_title: string | null
          location: Json | null
          pga_scenario: number | null
          building_type: string | null
          report_pdf_url: string | null
          report_summary: string | null
          created_at: string
          file_size_bytes: number | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          client_id?: string | null
          report_title?: string | null
          location?: Json | null
          pga_scenario?: number | null
          building_type?: string | null
          report_pdf_url?: string | null
          report_summary?: string | null
          created_at?: string
          file_size_bytes?: number | null
        }
        Update: {
          user_id?: string | null
          client_id?: string | null
          report_title?: string | null
          location?: Json | null
          pga_scenario?: number | null
          building_type?: string | null
          report_pdf_url?: string | null
          report_summary?: string | null
          created_at?: string
          file_size_bytes?: number | null
        }
      }
      ifc_analyses: {
        Row: {
          id: string
          user_id: string | null
          client_id: string | null
          original_filename: string | null
          building_height: number | null
          site_class: string | null
          inconsistencies: Json | null
          summary: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          client_id?: string | null
          original_filename?: string | null
          building_height?: number | null
          site_class?: string | null
          inconsistencies?: Json | null
          summary?: Json | null
          created_at?: string
        }
        Update: {
          user_id?: string | null
          client_id?: string | null
          original_filename?: string | null
          building_height?: number | null
          site_class?: string | null
          inconsistencies?: Json | null
          summary?: Json | null
          created_at?: string
        }
      }
    }
    Functions: {
      get_prediction: {
        Args: {
          p_lat: number
          p_lon: number
          p_depth: number
          p_pga: number
        }
        Returns: {
          vs_predicted: number | null
          vs_p10: number | null
          vs_p90: number | null
          site_class: string | null
          cached: boolean
        }[]
      }
    }
  }
}
