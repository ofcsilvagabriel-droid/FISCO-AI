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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      memoria_decisoes: {
        Row: {
          ativo: boolean
          atualizado_em: string
          calculo_aplicado: Json
          congelado: boolean
          criado_em: string
          descricao_ultima: string | null
          empresa_id: string
          faixa_interestadual: string
          fingerprint: string | null
          id: string
          legislacao: Json
          ncm: string
          origem_decisao: string
          parametros: Json
          regime_tributario_aplicado: string
          user_id: string
          versao: number
          vezes_aplicada: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          calculo_aplicado?: Json
          congelado?: boolean
          criado_em?: string
          descricao_ultima?: string | null
          empresa_id: string
          faixa_interestadual?: string
          fingerprint?: string | null
          id?: string
          legislacao?: Json
          ncm: string
          origem_decisao?: string
          parametros?: Json
          regime_tributario_aplicado: string
          user_id?: string
          versao?: number
          vezes_aplicada?: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          calculo_aplicado?: Json
          congelado?: boolean
          criado_em?: string
          descricao_ultima?: string | null
          empresa_id?: string
          faixa_interestadual?: string
          fingerprint?: string | null
          id?: string
          legislacao?: Json
          ncm?: string
          origem_decisao?: string
          parametros?: Json
          regime_tributario_aplicado?: string
          user_id?: string
          versao?: number
          vezes_aplicada?: number
        }
        Relationships: []
      }
      memoria_eventos: {
        Row: {
          antes: Json | null
          criado_em: string
          decisao_id: string | null
          depois: Json | null
          descricao: string | null
          empresa_id: string
          id: string
          ncm: string
          tipo: string
          user_id: string
        }
        Insert: {
          antes?: Json | null
          criado_em?: string
          decisao_id?: string | null
          depois?: Json | null
          descricao?: string | null
          empresa_id: string
          id?: string
          ncm: string
          tipo: string
          user_id?: string
        }
        Update: {
          antes?: Json | null
          criado_em?: string
          decisao_id?: string | null
          depois?: Json | null
          descricao?: string | null
          empresa_id?: string
          id?: string
          ncm?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memoria_eventos_decisao_id_fkey"
            columns: ["decisao_id"]
            isOneToOne: false
            referencedRelation: "memoria_decisoes"
            referencedColumns: ["id"]
          },
        ]
      }
      st_decisoes_validadas: {
        Row: {
          assinatura_descricao: string
          id: string
          ncm_prefixo: string
          observacao: string | null
          regra_id: string | null
          status_confirmado: string
          validado_em: string
        }
        Insert: {
          assinatura_descricao: string
          id?: string
          ncm_prefixo: string
          observacao?: string | null
          regra_id?: string | null
          status_confirmado: string
          validado_em?: string
        }
        Update: {
          assinatura_descricao?: string
          id?: string
          ncm_prefixo?: string
          observacao?: string | null
          regra_id?: string | null
          status_confirmado?: string
          validado_em?: string
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
