export type Language = 'ko' | 'ja' | 'en';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  fontSize?: string;
  mobileFontSize?: string;
  pushEnabled?: boolean;
}
