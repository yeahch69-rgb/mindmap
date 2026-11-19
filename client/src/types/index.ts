export type Language = 'ko' | 'ja' | 'en';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}
