export type Role = 'student' | 'manager' | 'admin';
export type MealCode = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface Profile {
  id: string; full_name: string; roll_no: string | null; hostel: string | null; room_no: string | null;
  diet_type: string; role: Role; consented_at: string | null;
}
export interface MealType { id: string; code: MealCode; name: string }
export interface Semester { id: string; name: string; starts_on: string; ends_on: string; is_active: boolean }
export interface Balance {
  student_account_id: string; student_id: string; semester_id: string;
  amount_paid_paise: number; balance_paise: number; deducted_paise: number; meals_eaten: number;
}
export const MEAL_ORDER: MealCode[] = ['breakfast', 'lunch', 'snacks', 'dinner'];
