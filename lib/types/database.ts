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
      activity_logs: {
        Row: {
          actor_id: string
          after_value: Json | null
          before_value: Json | null
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          ip_address: unknown
          occurred_at: string
          target_id: string | null
          target_type: Database["public"]["Enums"]["target_type"] | null
          user_agent: string | null
        }
        Insert: {
          actor_id: string
          after_value?: Json | null
          before_value?: Json | null
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          ip_address?: unknown
          occurred_at?: string
          target_id?: string | null
          target_type?: Database["public"]["Enums"]["target_type"] | null
          user_agent?: string | null
        }
        Update: {
          actor_id?: string
          after_value?: Json | null
          before_value?: Json | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          ip_address?: unknown
          occurred_at?: string
          target_id?: string | null
          target_type?: Database["public"]["Enums"]["target_type"] | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_extensions: {
        Row: {
          contract_id: string
          extended_at: string
          extended_by: string
          id: string
          new_expiry_date: string
          previous_expiry_date: string
          reason: string | null
        }
        Insert: {
          contract_id: string
          extended_at?: string
          extended_by: string
          id?: string
          new_expiry_date: string
          previous_expiry_date: string
          reason?: string | null
        }
        Update: {
          contract_id?: string
          extended_at?: string
          extended_by?: string
          id?: string
          new_expiry_date?: string
          previous_expiry_date?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_extensions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_extensions_extended_by_fkey"
            columns: ["extended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_files: {
        Row: {
          checksum_sha256: string
          contract_id: string
          deleted_at: string | null
          file_size_bytes: number
          id: string
          is_latest: boolean
          mime_type: string
          original_filename: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string
          version_no: number
        }
        Insert: {
          checksum_sha256: string
          contract_id: string
          deleted_at?: string | null
          file_size_bytes: number
          id?: string
          is_latest?: boolean
          mime_type: string
          original_filename: string
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
          version_no: number
        }
        Update: {
          checksum_sha256?: string
          contract_id?: string
          deleted_at?: string | null
          file_size_bytes?: number
          id?: string
          is_latest?: boolean
          mime_type?: string
          original_filename?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_files_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_status_history: {
        Row: {
          changed_at: string
          changed_by: string
          contract_id: string
          corrected_history_id: string | null
          from_status: Database["public"]["Enums"]["contract_status"] | null
          id: string
          is_correction: boolean
          reason: string | null
          to_status: Database["public"]["Enums"]["contract_status"]
          transition_type: Database["public"]["Enums"]["transition_type"]
          trigger_event: string | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          contract_id: string
          corrected_history_id?: string | null
          from_status?: Database["public"]["Enums"]["contract_status"] | null
          id?: string
          is_correction?: boolean
          reason?: string | null
          to_status: Database["public"]["Enums"]["contract_status"]
          transition_type: Database["public"]["Enums"]["transition_type"]
          trigger_event?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          contract_id?: string
          corrected_history_id?: string | null
          from_status?: Database["public"]["Enums"]["contract_status"] | null
          id?: string
          is_correction?: boolean
          reason?: string | null
          to_status?: Database["public"]["Enums"]["contract_status"]
          transition_type?: Database["public"]["Enums"]["transition_type"]
          trigger_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_status_history_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_status_history_corrected_history_id_fkey"
            columns: ["corrected_history_id"]
            isOneToOne: false
            referencedRelation: "contract_status_history"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          contract_type: Database["public"]["Enums"]["contract_type"]
          contracting_party: Database["public"]["Enums"]["contracting_party"]
          created_at: string
          created_by: string
          deleted_at: string | null
          effective_date: string | null
          expiry_date: string | null
          extended_expiry_date: string | null
          id: string
          local_government_id: string
          master_contract_id: string | null
          memo: string | null
          parent_contract_id: string | null
          signed_date: string | null
          status: Database["public"]["Enums"]["contract_status"]
          termination_reason: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          contract_type?: Database["public"]["Enums"]["contract_type"]
          contracting_party?: Database["public"]["Enums"]["contracting_party"]
          created_at?: string
          created_by: string
          deleted_at?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          extended_expiry_date?: string | null
          id?: string
          local_government_id: string
          master_contract_id?: string | null
          memo?: string | null
          parent_contract_id?: string | null
          signed_date?: string | null
          status: Database["public"]["Enums"]["contract_status"]
          termination_reason?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          contract_type?: Database["public"]["Enums"]["contract_type"]
          contracting_party?: Database["public"]["Enums"]["contracting_party"]
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          extended_expiry_date?: string | null
          id?: string
          local_government_id?: string
          master_contract_id?: string | null
          memo?: string | null
          parent_contract_id?: string | null
          signed_date?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          termination_reason?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_local_government_id_fkey"
            columns: ["local_government_id"]
            isOneToOne: false
            referencedRelation: "local_governments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_parent_contract_id_fkey"
            columns: ["parent_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_master_contract_id_fkey"
            columns: ["master_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          filter_payload: Json | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          requested_at: string
          requested_by: string
          result_path: string | null
          scope_option: string | null
          status: Database["public"]["Enums"]["job_status"]
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          filter_payload?: Json | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          requested_at?: string
          requested_by: string
          result_path?: string | null
          scope_option?: string | null
          status?: Database["public"]["Enums"]["job_status"]
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          filter_payload?: Json | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          requested_at?: string
          requested_by?: string
          result_path?: string | null
          scope_option?: string | null
          status?: Database["public"]["Enums"]["job_status"]
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      local_governments: {
        Row: {
          classification: Database["public"]["Enums"]["lg_class"]
          created_at: string
          deleted_at: string | null
          full_name: string
          geo_code: string | null
          id: string
          memo: string | null
          sido: string
          sigungu: string
          updated_at: string
        }
        Insert: {
          classification: Database["public"]["Enums"]["lg_class"]
          created_at?: string
          deleted_at?: string | null
          full_name: string
          geo_code?: string | null
          id?: string
          memo?: string | null
          sido: string
          sigungu: string
          updated_at?: string
        }
        Update: {
          classification?: Database["public"]["Enums"]["lg_class"]
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          geo_code?: string | null
          id?: string
          memo?: string | null
          sido?: string
          sigungu?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_name: string
          email: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_name: string
          email: string
          id: string
          is_active?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          email?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_correction: {
        Args: {
          p_contract_id: string
          p_expected_version: number
          p_reason: string
          p_target_history_id: string
        }
        Returns: Json
      }
      current_user_role: {
        Args: Record<string, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_kpi_summary: {
        Args: Record<string, never>
        Returns: {
          completed_count: number
          expiring_30d: number
          expiring_60d: number
          expiring_7d: number
          in_progress_count: number
          total_active: number
          updating_count: number
        }[]
      }
      get_region_stats: {
        Args: Record<string, never>
        Returns: {
          classification: Database["public"]["Enums"]["lg_class"]
          completed: number
          completed_imcity: number
          completed_monoplatform: number
          full_name: string
          geo_code: string | null
          in_progress: number
          lg_id: string
          sido: string
          sigungu: string
          terminated: number
          total: number
          updating: number
        }[]
      }
      soft_delete_contract_file: {
        Args: { p_file_id: string; p_contract_id: string }
        Returns: Json
      }
      terminate_expired_contracts: {
        Args: { p_actor: string }
        Returns: number
      }
    }
    Enums: {
      contract_status: "in_progress" | "completed" | "updating" | "terminated"
      contracting_party: "monoplatform" | "imcity"
      contract_type:
        | "parking_enforcement"
        | "personal_info_outsourcing"
        | "mou"
        | "other"
      event_type:
        | "login"
        | "logout"
        | "contract_create"
        | "contract_update"
        | "contract_delete"
        | "status_change"
        | "extension"
        | "correction"
        | "file_upload"
        | "file_download"
        | "file_delete"
        | "zip_download"
        | "permission_change"
        | "meta_update"
        | "cascade_terminate"
      job_status: "queued" | "running" | "succeeded" | "failed"
      job_type: "zip_bundle" | "excel_export"
      lg_class: "si" | "gun" | "gu"
      target_type: "contract" | "file" | "user" | "local_government"
      transition_type:
        | "create"
        | "file_upload_confirm"
        | "extend"
        | "renew_start"
        | "terminate"
        | "correction"
      user_role: "master" | "accounting" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
